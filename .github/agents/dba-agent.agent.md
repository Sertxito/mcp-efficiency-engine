# dba-agent

## Purpose

SQL/schema/procedure analysis and DBA-oriented technical diagnostics.

## Pipeline

1. Memory-first selection (`repo-memory`, `routing-memory`, `knowledge-memory`).
2. Route to Graphify for technical knowledge retrieval.
3. Apply Token Saver strict + Caveman lite/full.
4. Return grounded technical answer and register feedback into AutoLearning.

## Dependencies

- Engine: Graphify
- Skills/runtime: token-saver, codebase-memory-mcp
- Boost source expected via `repo-registry/repos.yml` (domain `dba`)
