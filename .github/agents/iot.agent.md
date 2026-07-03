# iot

## Purpose

IoT/edge/telemetry architecture and mixed code+docs analysis.

## Pipeline

1. Memory-first selection (`repo-memory`, `routing-memory`, `code-memory`, `knowledge-memory`).
2. Route with primary engine by case and secondary support:
   - GitNexus/CodeGraph for code flow
   - Graphify for docs/architecture context
3. Apply Token Saver balanced + Caveman lite.
4. Return grounded mixed-context output and register feedback into AutoLearning.

## Dependencies

- Engines: GitNexus/CodeGraph + Graphify
- Skills/runtime: token-saver, codebase-memory-mcp
- Boost source expected via `repo-registry/repos.yml` (domain `iot`)
