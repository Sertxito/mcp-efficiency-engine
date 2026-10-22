# Database change with baseline

**Trigger:** A schema, query, index, job, backfill, or operational database
change can affect data integrity, availability, or performance.

**Lead roles:** Senior database engineer; SRE for production-impacting changes.

## Stages
1. Inventory schema and workload dependencies, consumers/jobs, data sensitivity,
   and availability constraints.
2. Capture a reproducible baseline for relevant latency, throughput, resources,
   locks, and errors; record sample and environment limitations.
3. Review correctness, integrity, access control, and query-plan implications;
   test on representative non-sensitive data.
4. Define staged rollout, compatibility window, bounded batches, idempotency,
   monitoring thresholds, stop conditions, and rollback/recovery limits.
5. Validate backup/restore assumptions and obtain explicit approval for the
   exact environment and state-changing action before execution.
6. Compare post-change measurements with the baseline and report actual results.

## Specialized gates
For query/index tuning, apply sql-performance-diagnosis: source-first evidence,
engine/version-aware plans/waits, comparable latency/CPU/reads and reviewed
functional golden-result differences before rollout. Do not apply a suggested
index directly or update expected results blindly.
For fixtures, apply database-test-data-protection with classification, synthetic
relationships, access/retention and re-identification checks.
For HA/restore claims, require a dated recovery-rehearsal result against RTO/RPO
or explicitly report that recovery remains untested. A plan is not an exercise.

## Outputs
Dependency map, baseline, change and test evidence, rollout/monitoring plan,
recovery limitations, approval record, and comparable outcome measurements.
Do not claim improvement without comparable measurements.
