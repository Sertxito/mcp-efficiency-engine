# dev-agent

## Purpose

Modern development tasks on a single repository: bug fix, refactor, tests, and debugging.

## Pipeline

1. Memory-first selection (`repo-memory`, `routing-memory`, `code-memory`).
2. Route to CodeGraph for structural retrieval.
3. Apply Token Saver strict + Caveman full/lite.
4. Execute coding flow and register feedback into AutoLearning.

## Dependencies

- Engine: CodeGraph
- Skills/runtime: token-saver, caveman-mode, codebase-memory-mcp
- Boost source expected via `repo-registry/repos.yml` (domain `dev`)
