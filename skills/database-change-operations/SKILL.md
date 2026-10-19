---
name: database-change-operations
description: "Assess operational risk for database changes, query tuning, and data operations. Use for performance regression, schema rollout, jobs, backfills, HA, or production database changes."
---

# Database change operations

## Procedure
1. Map affected tables, queries, jobs, consumers, dependencies, and data sensitivity.
2. Capture a reproducible baseline for latency, throughput, resource use, locks, and errors.
3. Explain expected effect and uncertainty; test on representative, non-sensitive data.
4. Plan an additive or staged rollout, bounded batches, idempotency, and stop conditions.
5. Define monitoring signals, backup/restore checks, rollback feasibility, and owner.
6. Obtain specific approval before any production query or state-changing operation.

## Output
Dependency map, baseline, proposed change, test evidence, rollout and monitoring
plan, recovery limitations, approval point, and residual risk. Never claim
performance improvement without comparable before/after measurements.
