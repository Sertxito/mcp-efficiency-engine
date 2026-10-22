# SQL engineering and query diagnosis

**Scope:** SQL schema, queries, procedures and migrations; SQL Server-specific
tools apply only when that engine is confirmed.
**Version boundary:** establish engine/version, compatibility level, ORM,
schema ownership, workload and deployment environment before recommendations.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Preserve keys, constraints, nullability, precision, collation and transaction
  semantics. Parameterize values; allowlist identifiers rather than concatenating
  untrusted SQL. Use the application's least-privilege identity.
- Use explicit projections, bounded result sets and deterministic pagination.
  Inspect N+1 patterns, joins, predicates, statistics and parameter sensitivity.
- Do not declare every scan a defect or every index beneficial. Measure actual
  versus estimated cardinality, logical reads, CPU, duration, waits and spills
  under representative parameters. Account for index write/storage costs.
- Review transaction length, isolation, blocking and deadlock evidence. Do not
  prescribe NOLOCK, broad hints, cache flushes or global settings as generic fixes.
- Use additive/staged schema changes where possible. Address compatible rollout,
  backfill size, locks, integrity checks and irreversible data transformations.
  A rollback script is not proof that lost data can be restored.

## Modeling, correctness and change safety
- Represent integrity with appropriate primary/foreign/unique/check constraints,
  not only application checks. Choose data types, decimal precision and timestamp
  semantics from the domain; implicit conversions can change both results and
  index access.
- Reason about NULL/three-valued logic, duplicate rows, join multiplicity and
  aggregation before optimizing. Test outer-join filters, empty sets and
  anti-joins, including nullable NOT IN inputs.
- Require deterministic ordering where callers depend on order; test page
  boundaries under concurrent writes. Do not assume TOP/LIMIT without ORDER BY
  or a table's physical layout gives a stable result.
- Keep predicates index-friendly where appropriate; inspect implicit casts and
  functions on indexed columns. Validate index selectivity, included columns
  and redundant indexes with real plans rather than generic recommendations.
- Handle errors, deadlock retries and partial failures at a defined transaction
  boundary. Batch large changes with checkpoints and integrity checks; never
  disable constraints or expand transaction scope as a shortcut.
- Verify old/new application compatibility and restore/forward-recovery limits
  for migrations. Generated schema ownership, data retention and approvals
  remain explicit even when an ORM creates the script.

## Verification and performance
Capture an execution plan appropriate to the environment and approved workload.
For SQL Server, use Query Store and STATISTICS IO/TIME where authorized.
An actual plan executes the query; do not run expensive or mutating queries on
shared systems just to collect it. Record parameters/data shape safely.
Compare before/after plans, reads, latency and correctness under equivalent
load, including concurrent callers and adverse parameter distributions.
Validate migration recovery on a disposable or approved representative database.
Use the SQL performance diagnosis procedure for source-first tuning, correlated
plan/wait evidence, reviewed golden-result regression and staged rollout.
Named collectors from an old boost are not installed tools or executed checks.

Official references:
- https://learn.microsoft.com/sql/relational-databases/performance/
- https://learn.microsoft.com/sql/relational-databases/performance/monitoring-performance-by-using-the-query-store
- https://learn.microsoft.com/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide
