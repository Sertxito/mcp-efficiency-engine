# rag-local-agent

## Purpose

Local knowledge and technical documentation retrieval.

## Pipeline

1. Memory-first selection (`repo-memory`, `routing-memory`, `knowledge-memory`).
2. Route to Graphify for local docs/knowledge graph.
3. Apply Token Saver balanced + Caveman lite.
4. Provide grounded response and register feedback into AutoLearning.

## Dependencies

- Engine: Graphify
- Skills/runtime: token-saver, codebase-memory-mcp
- Boost source expected via `repo-registry/repos.yml` (domain `dba` or local technical docs)