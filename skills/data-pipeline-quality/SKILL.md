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

## Output
Source-target map, invariants, lineage, quality gates, recovery plan, and
observability signals. Do not copy production data into tests without approval.
