---
name: sql-performance-diagnosis
description: "Diagnose SQL query or database bottlenecks using source, plans, waits, CPU, reads and blocking evidence. Use for slow queries, query tuning, index recommendations, deadlocks or SQL performance regressions."
---

# SQL performance diagnosis

## Scope and inputs
Confirm engine/version, schema and query source of truth, environment, ownership,
parameters/data distribution, workload window, numeric target and permitted
collectors. SQL Server DMVs and Query Store are not portable to other engines.
Use this procedure only for SQL, not every performance task.

## Procedure
1. Read the query/procedure, schema, dependencies and callers before interpreting
   telemetry. Identify parameter types, transactions, tenant boundaries and
   required result semantics. If the source or required evidence is unavailable,
   record the gap and propose collection; do not invent a root cause.
2. Capture repeated comparable baseline samples with units: elapsed/CPU time,
   logical reads, throughput, errors, concurrency, waits/blocking and plan
   identity. Record runtime/configuration, dataset, cache state and parameter
   distribution; use the shared performance-investigation evidence contract.
3. Select engine-supported evidence. On SQL Server, approved Query Store or
   `sys.dm_exec_query_stats`/`sys.dm_exec_sql_text` can identify costly queries;
   `sys.dm_exec_requests` can expose current waits/blockers and
   `sys.dm_os_wait_stats` cumulative waits. Capture observation windows/deltas,
   reset/restart boundaries and permission limits. Aggregates do not prove the
   current incident's cause; query text/plans may contain sensitive literals.
4. Correlate actual versus estimated cardinality, scans, key lookups, spills,
   memory grants, statistics, parameter sensitivity, locks and blocking with
   source. Review RBAR/cursors, row-by-row loops, non-sargable predicates,
   implicit conversion/decryption in filters, unbounded temp work and long
   transactions. These are hypotheses, not automatic defects.
5. Test one falsifiable hypothesis with a minimal candidate: set-based rewrite,
   corrected join/filter/projection, statistics or a justified index. Account
   for FK access, read/write cost, storage, maintenance and adverse parameters.
   Do not apply index recommendations, hints, NOLOCK or global settings blindly.
6. Compare functional output and transaction effects on an approved disposable
   representative database before comparing performance. Preserve null,
   duplicate, precision and ordering semantics; explicitly review golden-file
   differences. Test concurrency and adverse parameters where relevant.
7. Propose staging, a controlled rollout window, health/abort thresholds, owner
   and recovery/forward-fix limits. Changing SQL/indexes, running expensive or
   mutating diagnostics and any production query need exact approval. Measure
   after an authorized change and report pass/fail/inconclusive.

## Output
Use `Source:`, `Baseline:`, `Plan/wait evidence:`, `Hypothesis:`, `Candidate:`,
`Correctness:`, `Before/after:`, `Rollout/recovery:`, `Measurement limits:` and
`Outcome:`. Include artifact paths, commands, units, sample counts and checks
not run. Label proposed commands separately from observed results.

## Safety and availability
An actual execution plan executes the statement. Do not execute mutating SQL to
collect a plan, flush shared caches, kill sessions, enable collectors or change
permissions without explicit action-specific approval. Use least privilege and
redacted metadata/aggregates; never put sensitive query text in model context.
MCPEE does not bundle or auto-run the original boost's SQL/PowerShell collectors.
Use only verified project-installed tools; missing tools/access mean blocked
collection, not simulated diagnostic output.
