---
name: database-platform-migration
description: "Plan and validate stored-procedure, schema, and data transformations across database platforms."
---

# Database platform migration

## Use when
- Migrating stored procedures or database workloads between engines.
- Generating or reviewing migration scripts and cross-platform validation.

## Inputs
- Source/target engines and versions, schema and procedure sources, workload behavior, data constraints, and cutover requirements.

## Procedure
1. Inventory schema objects, procedures, SQL dialect features, transactions, collations, time semantics, dependencies, and consumers.
2. Classify each construct as compatible, transformable, unsupported, or unknown using authoritative engine/version evidence.
3. Generate a minimal script or rewrite proposal with explicit ordering, preconditions, idempotency, and rollback/forward-recovery limits.
4. Validate on representative synthetic or approved data with result comparisons, row counts/checksums, boundary cases, and performance baselines.
5. Define staged coexistence, ownership of writes, reconciliation, cutover checks, and an explicit end to dual-running.

## Output
Object compatibility matrix, reviewed transformation scripts, validation results, data-integrity checks, and cutover/recovery constraints.

## Safety and limitations
- Never execute migration scripts against production or modify source/target systems without exact approval.
- Do not assume equivalent transaction, date/time, null, collation, locking, or stored-procedure behavior across engines.
- Generated SQL is a draft until reviewed and tested against the exact engine versions.
- Do not use real sensitive data for tests unless explicitly approved; prefer synthetic fixtures.
