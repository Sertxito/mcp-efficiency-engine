# frontend-agent

## Purpose

Frontend development tasks on a single repository: UI feature implementation, bug fixes, refactors, and test support.

## Pipeline

1. Memory-first selection (`repo-memory`, `routing-memory`, `code-memory`).
2. Route to CodeGraph for structural retrieval in frontend code.
3. Apply Token Saver strict + Caveman full/lite.
4. Execute frontend coding flow and register feedback into AutoLearning.

## Dependencies

- Engine: CodeGraph
- Skills/runtime: token-saver, caveman-mode, codebase-memory-mcp
- Boost source expected via `repo-registry/repos.yml` (domain `frontend`)