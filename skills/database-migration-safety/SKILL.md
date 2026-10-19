---
name: database-migration-safety
description: "Assess schema and data migrations for compatibility, integrity, and recovery. Use for DDL, data backfills, indexes, or persistence changes."
---

# Database migration safety

## Procedure
1. Capture the current schema, dependent consumers/jobs, representative data
   volume, workload baseline, and availability constraints.
2. Prefer expand/contract sequencing and additive compatible changes.
3. Define constraints, backfill batching, idempotency, locks, and progress signals.
4. Test on representative non-sensitive data and measure query/lock/resource
   impact against a recorded baseline.
5. State rollback feasibility, data irreversibility, monitoring, and stop conditions.
6. Propose backup/restore validation and staged deployment checks.

## Output
Migration plan, compatibility window, validation queries/tests, operational
impact, rollback limits, and approval points. Never execute a destructive step
without explicit approval.
