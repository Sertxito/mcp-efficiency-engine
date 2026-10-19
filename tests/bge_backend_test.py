import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "bge_backend", Path(__file__).resolve().parents[1]
    / "packages/source-engine/src/embeddings_bge.py"
)
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class CacheTests(unittest.TestCase):
    def test_completed_vector_survives_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "vectors.sqlite3"
            key = backend.vector_key({"text": "source", "source_sha256": "abc"}, "model")
            cache = backend.open_cache(file)
            with cache:
                cache.execute("INSERT INTO vectors VALUES (?,?,?)", (key, 2, b"vector"))
            cache.close()
            cache = backend.open_cache(file)
            self.assertEqual(cache.execute(
                "SELECT dimension,data FROM vectors WHERE key=?", (key,)
            ).fetchone(), (2, b"vector"))
            cache.close()
            self.assertNotEqual(key, backend.vector_key(
                {"text": "changed", "source_sha256": "abc"}, "model"))
            self.assertNotEqual(key, backend.vector_key(
                {"text": "source", "source_sha256": "abc"}, "changed-model"))

    def test_reject_unowned_cache_and_release_lock_on_close(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "cache"
            file.write_text("user file")
            with self.assertRaises(sqlite3.DatabaseError):
                backend.open_cache(file)
            self.assertEqual(file.read_text(), "user file")
            lock = Path(directory) / "lock"
            first = backend.open_cache(lock)
            first.execute("BEGIN EXCLUSIVE")
            with self.assertRaises(sqlite3.OperationalError):
                backend.open_cache(lock)
            first.close()
            second = backend.open_cache(lock)
            second.execute("BEGIN EXCLUSIVE")
            second.close()

    def test_tokenizer_progress_is_measured(self):
        original_split = backend.split_chunk
        original_progress = backend.progress
        events = []
        try:
            backend.split_chunk = lambda chunk, tokenizer: [chunk]
            backend.progress = lambda phase, **values: events.append((phase, values))
            chunks = [{"text": str(i)} for i in range(51)]
            self.assertEqual(backend.enforce_token_budget(chunks, None), chunks)
            self.assertEqual(events[-1], ("tokenizing", {"completed": 51, "total": 51}))
        finally:
            backend.split_chunk = original_split
            backend.progress = original_progress

    def test_cpu_batches_bound_padding_without_truncating_or_reordering(self):
        lengths = [28, 955, 95, 8, 83, 142, 15, 63, 3981, 796, 93, 11, 80, 82, 15, 33]
        tokenizer = lambda text, **options: {"input_ids": range(int(text))}
        chunks = [{"text": str(length)} for length in lengths]
        batches = list(backend.cpu_batches(chunks, range(len(chunks)), tokenizer))
        self.assertEqual([position for batch, _ in batches for position in batch],
                         list(range(len(chunks))))
        for positions, longest in batches:
            self.assertLessEqual(len(positions), backend.BATCH_SIZE)
            self.assertEqual(longest, max(lengths[position] for position in positions))
            self.assertLessEqual(longest * len(positions), backend.MAX_PADDED_BATCH_TOKENS)
        self.assertIn(([8], 3981), batches)
        self.assertEqual(list(backend.cpu_batches([], [], tokenizer)), [])
        with self.assertRaisesRegex(ValueError, "exceeding"):
            list(backend.cpu_batches([{"text": "4001"}], [0], tokenizer))
        short = [{"text": "2"} for _ in range(33)]
        self.assertEqual([len(batch) for batch, _ in
                          backend.cpu_batches(short, range(33), tokenizer)], [16, 16, 1])


if __name__ == "__main__":
    unittest.main()
