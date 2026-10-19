# Refactor code

1. Identify target boundary and establish behavior/API/data baselines.
2. Trace callers, dependencies, side effects, and relevant contracts.
3. Plan a bounded structural change that preserves observable behavior.
4. Refactor incrementally and retain or add regression coverage.
5. Compare behavior and run focused checks; report remaining risks and scope.

Do not bundle unrelated cleanup or claim equivalence without evidence.
