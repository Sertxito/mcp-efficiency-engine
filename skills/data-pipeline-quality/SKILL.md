---
name: data-pipeline-quality
description: "Design or review data pipeline correctness, lineage, quality, and replay behavior. Use for ingestion, transformation, ETL/ELT, or batch/stream processing."
---

# Data pipeline quality

## Procedure
1. Identify authoritative inputs, schema versions, owners, and downstream consumers.
2. Trace transformations and define lineage and expected invariants.
3. Specify freshness, completeness, uniqueness, validity, and reconciliation checks.
4. Define retry, idempotency, checkpoint, replay, and backfill behavior.
5. Add safe representative fixtures and report sensitive-data constraints.

## Operational data contract
Bound batch/backfill sizes, event-time/processing-time assumptions, late or
out-of-order records, deduplication keys and schema evolution across producers
and consumers. Specify reconciliation tolerances and a quarantine owner instead
of silently dropping invalid rows.
Record job/checkpoint ownership, retries, timeout/concurrency, dead-letter
retention and replay side effects. Use synthetic referentially valid fixtures;
verify recovery from a partial batch before claiming exactly-once behavior.

## Output
Source-target map, invariants, lineage, quality gates, recovery plan, and
observability signals. Do not copy production data into tests without approval.
