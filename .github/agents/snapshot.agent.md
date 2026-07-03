# snapshot

## Purpose

Portable context export with scoped/safe packaging.

## Pipeline

1. Memory-first selection (`repo-memory`, `routing-memory`).
2. Route to Repomix for snapshot generation.
3. Apply Token Saver strict scope + Caveman lite.
4. Emit portable artifact and register feedback into AutoLearning.

## Dependencies

- Engine: Repomix
- Skills/runtime: token-saver, codebase-memory-mcp
- Boost source expected via approved repos in `repo-registry/repos.yml`
