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

## Job and maintenance contract
For each scheduled job record owner, timezone/DST behavior, dependencies,
expected duration, overlap lock, timeout, bounded retries/backoff and missed-run
handling. Verify idempotency, checkpoint/restart, dry-run support, concurrency
limits, failure alerts and safe disable/replay. A scheduler's success status
does not establish that downstream data is correct.
Plan maintenance from observed statistics, fragmentation/workload and available
windows, not blanket rebuilds or cache clearing. Bound log growth, temp space,
blocking and replication effects; define abort/escalation ownership.

## Capacity and recovery evidence
Record workload growth, storage/log utilization, CPU/IO saturation, concurrency,
replication/send/redo lag and leading indicators with time window and units.
State forecast assumptions, headroom and threshold rationale; extrapolation is
not a demonstrated capacity limit.
Use recovery-rehearsal for an isolated restore or authorized failover exercise:
measure elapsed recovery and observed data loss against RTO/RPO, validate
application/consumer integrity and record dated artifacts and repeat ownership.
Never infer recoverability from backup job success, replica count or configured
retention alone.

## Output
Evidence-backed operational findings, job inventory, HA/recovery gaps, baseline signals, and a safe validation proposal.

## Safety and limitations
- Never start, stop, reschedule, or alter production jobs or failover settings without explicit approval.
- Do not claim HA or recoverability from topology/configuration alone; require observed and dated test evidence.
- Avoid querying or exposing sensitive data when metadata or aggregate metrics suffice.
- Unknown RPO/RTO, ownership, or restore results remain explicit decision gaps.
