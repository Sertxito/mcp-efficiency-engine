# Knowledge and context

How MCPEE turns project files into local, cited evidence for Copilot. All
ingestion, indexing, embedding and queries run locally; source content is not
sent to remote services.

- [Keep knowledge current](#keep-knowledge-current)
- [What sync processes](#what-sync-processes)
- [Search and context](#search-and-context)
- [Optional semantic embeddings](#optional-semantic-embeddings)
- [Graphs](#graphs)
- [Impact and drift](#impact-and-drift)
- [Project memory](#project-memory)
- [Generated documentation](#generated-documentation)
- [Rebuild and clean](#rebuild-and-clean)

## Keep knowledge current

After adding, editing or removing project sources, run:

```sh
mcpee sync --project C:\path\to\project
```

There is no automatic sync on save; several edits can share one sync. Normal
updates do not require reinstalling MCPEE, repeating embedding setup or
downloading a model again. Copilot runs that change files offer the same sync
automatically after approval.

`sync` incrementally refreshes the source index, graphs, specification
proposals and the enabled embedding profile. When the impact preflight reports
missing or stale evidence, run `sync` first; state-changing steps stay blocked
until the preflight is ready.

## What sync processes

- Discovers supported text sources and classifies them with the processor
  categories in `catalog/source-processors/processors.json`. Normalized content
  and extracted metadata are checksum-linked in traceability records.
- Processes UTF-8 text files up to 2 MiB, ignores common generated/dependency
  folders and secret files, and never follows symbolic links.
- Rebuilds derived files whose checksums no longer match when they are
  recognized as MCPEE-owned; unrecognized artifacts are preserved.
- Indexes plain-text logs and JSONL/NDJSON sources as log evidence.
- Converts PDF and Office files with the isolated MarkItDown installation. If
  it is missing, those files are inventoried as requiring the tool, never
  silently discarded.
- Applies heuristic redaction to normalized content; treat it as project data.

**Multiple repositories.** One MCPEE workspace can include several nested
repositories or applications. List their project-relative directories under
`knowledge.sourceRoots` in `mcpee.config.yml`; one shared index and graph keep
workspace-relative paths. All indexed repositories must stay beneath the MCPEE
project root.

## Search and context

| Command | Result |
|---|---|
| `mcpee knowledge search --query "..."` | Lexical search over the local index, returning source paths and normalized artifacts. |
| `mcpee knowledge search --query "..." --mode vector` | Sparse TF-IDF cosine ranking of the same evidence. Local vector retrieval over lexical terms, not embedding search; no download or service. |
| `mcpee knowledge context --query "..." --max-tokens 4000` | Compact, source-cited evidence pack for a downstream agent. Uses hybrid semantic/lexical retrieval when fresh embeddings exist, otherwise lexical. Excerpts are original text, never summarized. |
| `mcpee knowledge graph --query "..."` | Matches from the unified evidence graph, CodeGraph and, when available, Graphify, with graph type, path and symbol line. |

`mcpee run` uses the same grounded retrieval by default (see
[Copilot execution](COPILOT-EXECUTION.md#context-sent-to-copilot)). The token
limit is an approximate character-based budget.

## Optional semantic embeddings

The base index is lexical. Embeddings add local semantic retrieval and are
chosen during interactive `init`, or later with:

```sh
mcpee knowledge embeddings setup --profile bge-m3
mcpee knowledge embeddings status --profile bge-m3
mcpee knowledge embeddings index --profile bge-m3
```

| Profile | Requirements | Storage |
|---|---|---|
| `bge-m3` (recommended for CPU) | Approves installing pinned packages into an isolated project-local Python 3.12 environment and downloading `BAAI/bge-m3`. | `.mcpee/models/` |
| `light` (setup-command default) | An existing loopback Ollama service. Downloads `embeddinggemma` (about 0.6 GB) after approval. MCPEE does not install Ollama. | Ollama's user cache |

Non-interactive `init` defaults to `none`; choose with
`--embeddings bge-m3|light|none`. Package and model downloads occur only
during approved setup; Hub telemetry is disabled.

**BGE-M3 details.** It runs on CPU with a pinned compatibility stack
(`transformers==4.44.2`, `sentence-transformers==3.0.1`, `peft==0.12.0`).
Rerun setup to repair an older environment; owned model weights are reused.
Chunks are tokenizer-checked and capped at 4,000 tokens, Markdown table headers
are repeated when a table is split, and adjacent code chunks overlap by 15%.
Inference uses at most 16 texts and 4,096 padded tokens per batch, so long
chunks run separately instead of padding every short text. MCPEE persists a
FAISS dense index plus BM25 token data and fuses rankings with Reciprocal Rank
Fusion. The index is ignored by Git.

**Progress and interruption.** CPU indexing reports tokenizer progress and
encoded chunks with completed/total counts and reused cached vectors to stderr,
including redirected logs (not with `--json` or `--chat-json`). The timeout is
thirty minutes without a progress event, not for the whole corpus. Completed
batches are committed to an owned local SQLite cache; rerun the same command to
resume. A partial cache is not a usable or enabled index. Concurrent indexing
of the same destination fails explicitly. Node/Python exchanges use strict
UTF-8 regardless of the Windows console code page.

**Refresh cost.** Sync reuses matching cached vectors but still traverses and
tokenizes the corpus and rebuilds the final FAISS/BM25 artifacts. Cache keys
include the source checksum and chunk metadata, so editing one document can
recompute all its chunks. This is incremental inference, not a per-paragraph
update. For an embeddings-only retry after sources are synced, use
`mcpee knowledge embeddings index --profile bge-m3`. Do not delete the model or
cache to retry.

An enabled profile alone does not prove that a later refresh succeeded. Check
`embeddings status`, the completion output and any sync warning. See
[Troubleshooting](TROUBLESHOOTING.md#indexing-is-slow-or-interrupted).

## Graphs

| Graph | Source | Location |
|---|---|---|
| Unified evidence graph | MCPEE, from sources, categories, artifacts, headings and code symbols with line/checksum evidence | `.mcpee/graphs/unified/` |
| CodeGraph (required) | Pinned local CodeGraph package; built by `init`, updated by `sync` | `.codegraph/` |
| Graphify AST graph (optional) | Project-local Graphify in `--code-only` mode; no remote model | `.mcpee/graphs/graphify/` |

CodeGraph 1.6.2 accepts only a single directory name in `CODEGRAPH_DIR`, so
MCPEE uses its project-local directory instead of nesting it under `.mcpee/`.
Its platform-specific optional npm package must be present. CodeGraph and
Graphify run with telemetry, update checks, runtime fallback downloads and file
watching disabled. When Graphify is absent, sync reports it unavailable without
installing it; Graphify failures make sync incomplete. MCPEE does not install
Graphify's global agent integration or use its model-based extraction.

**Unified graph edges** are deliberately conservative and source-derived:

- explicit relative Markdown links to another discovered source, including
  headers from every detected Markdown table;
- static local JavaScript/TypeScript imports and exports, and uniquely
  resolved Python imports (ambiguous module names are omitted);
- Terraform/Bicep modules, API `$ref` values, pipeline action paths and
  configuration `$ref` values that resolve to discovered sources;
- .NET solution membership, `ProjectReference` entries and MSBuild imports;
- explicit `workspace:`, `file:` and `link:` dependencies in `package.json`
  (ambiguous or missing workspace names are reported, not guessed);
- SQL `CREATE TABLE`/`REFERENCES` table and foreign-key edges (ambiguous
  unqualified references are omitted);
- `tests_imports_symbol` for unambiguous named JS/TS test imports. It proves an
  import binding, not that a test executes or covers the symbol.

Dynamic imports, runtime-generated dependencies, test names, assertions and
inferred semantic relationships do not create edges. External package imports
are not treated as missing workspace files.

## Impact and drift

- `mcpee impact --path src/example.ts` lists direct and transitive dependents
  from indexed source, .NET build, infrastructure, API, pipeline, schema and
  database references, plus Markdown documents linking to the target. Each
  relationship includes its source path and line. It is a static view, not a
  runtime guarantee.
- `mcpee drift` reports in-project Markdown links with missing targets, missing
  explicit local references from supported schemas and configuration, and
  broken relative JS/TS imports. It also compares explicitly anchored Markdown
  statements with opposing requirement, availability, support or permission
  language, and correlates boolean configuration values, JS/TS capability
  flags, simple test assertions and the latest CodeGraph health event. These
  are checksummed review candidates, not semantic conclusions.
- `mcpee specs drift` checks approved specifications against their bound
  sources (see [Brownfield specification discovery](BROWNFIELD-SPECS.md)).

## Project memory

| Command | Result |
|---|---|
| `mcpee memory add --kind <kind> --text <text> [--source <path>]` | Stores an explicit memory linked to an existing project-relative file. |
| `mcpee memory list [--kind <kind>]` | Lists memories. |
| `mcpee memory search --query <text>` | Retrieves relevant memories and reports whether each source still matches its recorded checksum. |

MCPEE never infers or promotes prompts into durable memory. Learning proposals
become memory only after explicit human approval (see
[Quality and evaluation](QUALITY-AND-EVALUATION.md#follow-up-tasks-and-learning)).

## Generated documentation

`sync` writes source-linked overview, component, architecture, API/data,
infrastructure, testing, operations and decision maps, a source catalog and a
quality/operations summary to `docs/generated/`. They include extracted
headings, symbols and structured-data headers. They are evidence inventories
and do not claim runtime topology, test results, deployment health or
undocumented decisions. After a Copilot change they are refreshed only when
validation passes.

## Rebuild and clean

| Command | Effect |
|---|---|
| `mcpee rebuild` | After approval, force-reprocesses supported sources and regenerates derived indexes and documentation. Sources and memory are kept. |
| `mcpee clean` | After approval, removes only `.mcpee/cache/`. Indexes, graphs, reports, memory, tasks, logs and tools are kept. |
