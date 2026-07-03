# legacy

## Purpose

Legacy modernization, migration planning, and multi-repo impact analysis.

## Pipeline

1. Memory-first selection (`repo-memory`, `routing-memory`, `code-memory`).
2. Route to GitNexus for legacy/multi-repo graph analysis.
3. Apply Token Saver strict/balanced + Caveman full/lite.
4. Emit impact-aware output and register feedback into AutoLearning.

## Dependencies

- Engine: GitNexus
- Skills/runtime: token-saver, codebase-memory-mcp
- Boost source expected via `repo-registry/repos.yml` (domain `legacy`)
