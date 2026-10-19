import json
import os
import re
import sys
import hashlib
import sqlite3
import time
from contextlib import redirect_stdout
from pathlib import Path


MODEL_ID = "BAAI/bge-m3"
BATCH_SIZE = 16
MAX_PADDED_BATCH_TOKENS = 4096
MAX_LENGTH = 8192
MAX_CHUNK_TOKENS = 4000
GENERATED_BY = "mcpee"


def read_request():
    try:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid request JSON: {error}") from error
    if not isinstance(request, dict):
        raise ValueError("Request must be a JSON object.")
    return request


def tokenise(text):
    return re.findall(r"[\w-]{2,}", text.casefold(), flags=re.UNICODE)


def token_count(text, tokenizer):
    return len(tokenizer(text, add_special_tokens=True, truncation=False)["input_ids"])


def split_oversize_line(line, tokenizer, budget):
    pieces = []
    remaining = line
    while remaining:
        low, high = 1, len(remaining)
        best = 0
        while low <= high:
            middle = (low + high) // 2
            if token_count(remaining[:middle], tokenizer) <= budget:
                best = middle
                low = middle + 1
            else:
                high = middle - 1
        if best == 0:
            raise ValueError("A tokenizer token cannot fit within the chunk budget.")
        pieces.append(remaining[:best])
        remaining = remaining[best:]
    return pieces


def split_chunk(chunk, tokenizer):
    text = chunk["text"]
    if token_count(text, tokenizer) <= MAX_CHUNK_TOKENS:
        return [chunk]
    lines = text.splitlines()
    table = (
        chunk.get("chunk_kind") == "table"
        and len(lines) >= 2
        and "|" in lines[0]
        and re.search(r"-{3,}", lines[1])
    )
    if table:
        header = lines[:2]
        header_text = "\n".join(header)
        header_tokens = token_count(header_text, tokenizer)
        if header_tokens > MAX_CHUNK_TOKENS:
            raise ValueError("Markdown table headers exceed the 4000-token chunk limit.")
        rows = lines[2:]
        source_row_start = chunk.get(
            "content_start_line",
            max(chunk["start_line"] + 2, chunk["end_line"] - len(rows) + 1),
        )
        output = []
        group = []

        def emit_table_group():
            if not group:
                return
            output.append({
                **chunk,
                "text": "\n".join([*header, *(item[0] for item in group)]),
                "content_start_line": group[0][1],
                "end_line": group[-1][1],
            })

        for row_index, row in enumerate(rows):
            row_line = source_row_start + row_index
            row_budget = MAX_CHUNK_TOKENS - header_tokens
            for piece in split_oversize_line(row, tokenizer, max(1, row_budget)):
                candidate = "\n".join([*header, *(item[0] for item in group), piece])
                if group and token_count(candidate, tokenizer) > MAX_CHUNK_TOKENS:
                    emit_table_group()
                    group = []
                group.append((piece, row_line))
        emit_table_group()
        return output

    output = []
    group = []
    for offset, line in enumerate(lines):
        pieces = split_oversize_line(line, tokenizer, MAX_CHUNK_TOKENS)
        for piece in pieces:
            if group and token_count("\n".join([*(item[0] for item in group), piece]), tokenizer) > MAX_CHUNK_TOKENS:
                output.append({
                    **chunk,
                    "text": "\n".join(item[0] for item in group),
                    "start_line": group[0][1],
                    "end_line": group[-1][1],
                })
                previous = list(group)
                group = []
                if chunk.get("chunk_kind") == "code":
                    budget = int(MAX_CHUNK_TOKENS * 0.15)
                    for previous_line in reversed(previous):
                        candidate = [previous_line, *group]
                        if token_count("\n".join(item[0] for item in candidate), tokenizer) > budget:
                            break
                        group = candidate
                while group and token_count("\n".join([*(item[0] for item in group), piece]), tokenizer) > MAX_CHUNK_TOKENS:
                    group.pop(0)
            group.append((piece, chunk["start_line"] + offset))
    if group:
        output.append({
            **chunk,
            "text": "\n".join(item[0] for item in group),
            "start_line": group[0][1],
            "end_line": min(chunk["end_line"], group[-1][1]),
        })
    return output


def enforce_token_budget(chunks, tokenizer):
    result = []
    for offset, chunk in enumerate(chunks):
        result.extend(split_chunk(chunk, tokenizer))
        if offset % 50 == 0:
            progress("tokenizing", completed=offset + 1, total=len(chunks))
    return result


def progress(phase, **values):
    print("mcpee-bge-progress:" + json.dumps({"phase": phase, **values}),
          file=sys.stderr, flush=True)


def open_cache(file):
    if file.is_symlink():
        raise ValueError(f"Refusing linked BGE cache: {file}")
    existed = file.exists()
    connection = sqlite3.connect(file, timeout=1)
    try:
        if existed:
            owner = connection.execute("SELECT value FROM metadata WHERE key='owner'").fetchone()
            if owner != (GENERATED_BY,):
                raise ValueError(f"Refusing unowned BGE cache: {file}")
        else:
            connection.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)")
            connection.execute("INSERT INTO metadata VALUES ('owner', ?)", (GENERATED_BY,))
            connection.execute("CREATE TABLE vectors (key TEXT PRIMARY KEY, dimension INTEGER, data BLOB)")
            connection.commit()
        return connection
    except Exception:
        connection.close()
        raise


def vector_key(chunk, model_signature):
    value = json.dumps({"model": model_signature, "chunk": chunk},
                       sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def cpu_batches(chunks, positions, tokenizer):
    batch = []
    longest = 0
    for position in positions:
        length = token_count(chunks[position]["text"], tokenizer)
        if length > MAX_CHUNK_TOKENS:
            raise ValueError("CPU batch contains a chunk exceeding its token budget.")
        candidate_longest = max(longest, length)
        if batch and (len(batch) >= BATCH_SIZE
                      or candidate_longest * (len(batch) + 1) > MAX_PADDED_BATCH_TOKENS):
            yield batch, longest
            batch = []
            longest = 0
        batch.append(position)
        longest = max(longest, length)
    if batch:
        yield batch, longest


def load_model(model_path, offline=True):
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    os.environ["OMP_NUM_THREADS"] = "4"
    os.environ["MKL_NUM_THREADS"] = "4"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    import torch
    from FlagEmbedding import BGEM3FlagModel

    torch.set_num_threads(min(4, os.cpu_count() or 1))
    torch.set_num_interop_threads(1)
    return BGEM3FlagModel(
        str(model_path),
        use_fp16=False,
        devices="cpu",
        normalize_embeddings=True,
        trust_remote_code=False,
    )


def ensure_owned_json(path):
    if not path.exists():
        return
    try:
        existing = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Refusing to overwrite unrecognized index data: {path}") from error
    if existing.get("generated_by") != GENERATED_BY:
        raise ValueError(f"Refusing to overwrite non-MCPEE index data: {path}")


def write_json(path, value):
    ensure_owned_json(path)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def download_model(request):
    model_path = Path(request["model_path"]).resolve()
    model_path.mkdir(parents=True, exist_ok=True)
    marker = model_path / ".mcpee-owned"
    if marker.exists():
        if marker.read_text(encoding="utf-8") != "MCPEE BGE-M3 model\n":
            raise ValueError(f"Refusing to use invalid model ownership marker: {marker}")
    elif any(model_path.iterdir()):
        raise ValueError(f"Refusing to reuse a non-empty model directory: {model_path}")
    else:
        marker.write_text("MCPEE BGE-M3 model\n", encoding="utf-8", newline="\n")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=MODEL_ID, local_dir=str(model_path))
    return {"model": MODEL_ID, "model_path": str(model_path), "downloaded": True}


def index(request):
    index_path = Path(request["index_path"]).resolve()
    index_path.mkdir(parents=True, exist_ok=True)
    lock = open_cache(index_path / ".indexing.lock")
    try:
        lock.execute("BEGIN EXCLUSIVE")
        return index_locked(request)
    finally:
        lock.close()


def index_locked(request):
    import faiss
    import numpy as np

    model_path = Path(request["model_path"]).resolve(strict=True)
    index_path = Path(request["index_path"]).resolve()
    index_path.mkdir(parents=True, exist_ok=True)
    chunks = request.get("chunks")
    if not isinstance(chunks, list) or any(
        not isinstance(chunk, dict) or not isinstance(chunk.get("text"), str)
        for chunk in chunks
    ):
        raise ValueError("Index request requires chunks with text.")
    progress("loading_model")
    model = load_model(model_path)
    progress("tokenizing", completed=0, total=len(chunks))
    chunks = enforce_token_budget(chunks, model.tokenizer)
    model_files = [file for file in model_path.iterdir()
                   if file.is_file() and file.suffix in {".bin", ".safetensors", ".json", ".model", ".pt"}]
    signature = hashlib.sha256(json.dumps([
        (file.name, file.stat().st_size, file.stat().st_mtime_ns)
        for file in sorted(model_files)
    ]).encode("utf-8")).hexdigest()
    cache = open_cache(index_path / "vectors.sqlite3")
    try:
        return encode_index(request, chunks, model, signature, cache)
    finally:
        cache.close()


def encode_index(request, chunks, model, signature, cache):
    import faiss
    import numpy as np

    index_path = Path(request["index_path"]).resolve()
    faiss_index = None
    reused = 0
    started = time.monotonic()
    progress("encoding", completed=0, total=len(chunks), cached=0)
    for offset in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[offset : offset + BATCH_SIZE]
        keys = [vector_key(chunk, signature) for chunk in batch]
        rows = [cache.execute("SELECT dimension,data FROM vectors WHERE key=?", (key,)).fetchone()
                for key in keys]
        missing = [position for position, row in enumerate(rows) if row is None]
        reused += len(batch) - len(missing)
        completed = offset + len(batch) - len(missing)
        for positions, longest in cpu_batches(batch, missing, model.tokenizer):
            progress("inference", completed=completed, total=len(chunks), cached=reused,
                     batch_size=len(positions), max_tokens=longest)
            encoded = model.encode_corpus(
                [batch[position]["text"] for position in positions],
                batch_size=len(positions),
                max_length=MAX_CHUNK_TOKENS,
                return_dense=True,
                return_sparse=False,
                return_colbert_vecs=False,
            )
            new_vectors = np.asarray(encoded["dense_vecs"], dtype=np.float32)
            faiss.normalize_L2(new_vectors)
            with cache:
                for position, vector in zip(positions, new_vectors, strict=True):
                    cache.execute("INSERT OR REPLACE INTO vectors VALUES (?,?,?)",
                                  (keys[position], len(vector), vector.tobytes()))
                    rows[position] = (len(vector), vector.tobytes())
            completed += len(positions)
            progress("encoding", completed=completed, total=len(chunks), cached=reused,
                     elapsed_seconds=round(time.monotonic() - started, 1))
        matrix = np.stack([np.frombuffer(row[1], dtype=np.float32, count=row[0]) for row in rows])
        if faiss_index is None:
            faiss_index = faiss.IndexFlatIP(matrix.shape[1])
        faiss_index.add(matrix)
        progress("encoding", completed=offset + len(batch), total=len(chunks),
                 cached=reused, elapsed_seconds=round(time.monotonic() - started, 1))
    if faiss_index is None:
        dimension = model.encode_corpus(
            [" "], batch_size=1, max_length=MAX_LENGTH, return_dense=True
        )["dense_vecs"].shape[1]
        faiss_index = faiss.IndexFlatIP(dimension)

    progress("saving_index", completed=len(chunks), total=len(chunks), cached=reused)
    index_file = index_path / "bge-m3.index"
    chunks_file = index_path / "chunks.json"
    bm25_file = index_path / "bm25.json"
    ensure_owned_json(chunks_file)
    ensure_owned_json(bm25_file)
    if index_file.exists() and not chunks_file.exists():
        raise ValueError(f"Refusing to overwrite unowned FAISS index: {index_file}")
    temporary_index = index_file.with_name(f"{index_file.name}.{os.getpid()}.tmp")
    faiss.write_index(faiss_index, str(temporary_index))
    temporary_index.replace(index_file)
    write_json(
        chunks_file,
        {
            "schema_version": 1,
            "generated_by": GENERATED_BY,
            "model": MODEL_ID,
            "chunks": chunks,
        },
    )
    write_json(
        bm25_file,
        {
            "schema_version": 1,
            "generated_by": GENERATED_BY,
            "model": MODEL_ID,
            "tokens": [tokenise(chunk["text"]) for chunk in chunks],
        },
    )
    progress("completed", completed=len(chunks), total=len(chunks), cached=reused)
    return {"chunk_count": len(chunks), "dimension": faiss_index.d, "model": MODEL_ID,
            "cached_count": reused}


def search(request):
    import faiss
    import numpy as np
    from rank_bm25 import BM25Okapi

    model_path = Path(request["model_path"]).resolve(strict=True)
    index_path = Path(request["index_path"]).resolve(strict=True)
    chunks_file = index_path / "chunks.json"
    ensure_owned_json(chunks_file)
    metadata = json.loads(chunks_file.read_text(encoding="utf-8"))
    if metadata.get("generated_by") != GENERATED_BY or metadata.get("model") != MODEL_ID:
        raise ValueError("BGE-M3 metadata is invalid or belongs to another model.")
    chunks = metadata.get("chunks")
    if not isinstance(chunks, list):
        raise ValueError("BGE-M3 chunk metadata is invalid.")
    bm25_file = index_path / "bm25.json"
    ensure_owned_json(bm25_file)
    sparse_index = json.loads(bm25_file.read_text(encoding="utf-8"))
    if sparse_index.get("generated_by") != GENERATED_BY or sparse_index.get("model") != MODEL_ID:
        raise ValueError("BGE-M3 BM25 index is invalid or belongs to another model.")
    tokenized_chunks = sparse_index.get("tokens")
    if not isinstance(tokenized_chunks, list) or len(tokenized_chunks) != len(chunks):
        raise ValueError("BGE-M3 BM25 index does not match its chunk metadata.")
    query = request.get("query")
    if not isinstance(query, str) or not query.strip():
        raise ValueError("Search query must not be empty.")
    if not chunks:
        return {"results": []}

    faiss_index = faiss.read_index(str(index_path / "bge-m3.index"))
    model = load_model(model_path)
    encoded = model.encode_queries(
        [query],
        batch_size=1,
        max_length=MAX_LENGTH,
        return_dense=True,
    )
    query_vector = np.asarray(encoded["dense_vecs"], dtype=np.float32)
    faiss.normalize_L2(query_vector)
    dense_scores, dense_ids = faiss_index.search(
        query_vector, min(len(chunks), max(1, int(request.get("limit", 50))))
    )
    dense_rank = {
        int(chunk_id): rank
        for rank, chunk_id in enumerate(dense_ids[0], start=1)
        if chunk_id >= 0
    }
    bm25 = BM25Okapi(tokenized_chunks)
    lexical_scores = bm25.get_scores(tokenise(query))
    lexical_ids = sorted(
        range(len(chunks)), key=lambda chunk_id: (-lexical_scores[chunk_id], chunk_id)
    )
    lexical_rank = {
        chunk_id: rank
        for rank, chunk_id in enumerate(lexical_ids[: max(1, int(request.get("limit", 50)))], start=1)
        if lexical_scores[chunk_id] > 0
    }
    ranks = set(dense_rank) | set(lexical_rank)
    results = []
    for chunk_id in ranks:
        dense_position = dense_rank.get(chunk_id)
        lexical_position = lexical_rank.get(chunk_id)
        rrf_score = (1 / (60 + dense_position) if dense_position else 0) + (
            1 / (60 + lexical_position) if lexical_position else 0
        )
        results.append(
            {
                "chunk_id": chunk_id,
                "dense_rank": dense_position,
                "lexical_rank": lexical_position,
                "score": rrf_score,
            }
        )
    results.sort(key=lambda item: (-item["score"], item["chunk_id"]))
    return {"results": results[: max(1, int(request.get("limit", 50)))]}


def main():
    request = read_request()
    action = request.get("action")
    with redirect_stdout(sys.stderr):
        if action == "download":
            result = download_model(request)
        elif action == "index":
            result = index(request)
        elif action == "search":
            result = search(request)
        else:
            raise ValueError(f"Unsupported BGE-M3 action: {action}")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"mcpee-bge-error: {error}", file=sys.stderr)
        sys.exit(1)
