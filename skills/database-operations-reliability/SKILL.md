---
name: database-operations-reliability
description: "Assess database jobs, high availability, recovery, and monitoring baselines without changing live systems."
---

# Database operations and reliability

## Use when
- Reviewing scheduled database jobs, maintenance automation, high-availability design, or monitoring readiness.
- Establishing an operational baseline before a database change.

## Inputs
- Database engine/version, environment, workload objectives, topology, job definitions, and approved monitoring evidence.

## Procedure
1. Establish engine/version, critical workload, ownership, topology, recovery objectives, and current operational boundaries.
2. Trace scheduled jobs and dependencies; identify overlap, retries, idempotency, ownership, failure alerts, and downstream effects.
3. Compare HA and recovery design with stated RPO/RTO, failure domains, backup evidence, and tested restore/failover results.
4. Define a baseline for availability, latency, errors, locks, capacity, replication lag, and job outcomes where measurements exist.
5. Propose bounded checks, alert ownership, stop conditions, and recovery exercises; distinguish configured controls from tested controls.

## Output
Evidence-backed operational findings, job inventory, HA/recovery gaps, baseline signals, and a safe validation proposal.

## Safety and limitations
- Never start, stop, reschedule, or alter production jobs or failover settings without explicit approval.
- Do not claim HA or recoverability from topology/configuration alone; require observed and dated test evidence.
- Avoid querying or exposing sensitive data when metadata or aggregate metrics suffice.
- Unknown RPO/RTO, ownership, or restore results remain explicit decision gaps.
