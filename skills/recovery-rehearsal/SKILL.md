---
name: recovery-rehearsal
description: "Plan and validate a bounded disaster recovery, backup restore or failover rehearsal against RTO/RPO. Use for recovery readiness, PITR validation, replica failover or service restoration exercises."
---

# Recovery rehearsal

## Inputs and scope
Identify service/data owner, critical journeys and dependencies, approved
environment, numeric RTO/RPO, restore point/backup provenance, topology and
failure domains. Distinguish availability failover from recovery after data
corruption or deletion. Neither replicas nor backup job success proves recovery.

## Procedure
1. Inventory restore dependencies: identity/keys, configuration, DNS/routing,
   artifacts, data/backup chain, retention/PITR window, encryption access and
   downstream consumers. Verify metadata without exposing credentials or data.
2. Agree a bounded scenario, isolated target, exact commands, allowed data,
   time/cost cap, responsible operator, communication and abort/cleanup plan.
   A readiness review is plan-only; every restore, routing or failover mutation
   requires action-specific approval. Do not switch live traffic implicitly.
3. Before an approved exercise, capture baseline health, known recovery marker,
   timestamps and expected application/consumer integrity checks. Ensure replay
   or restored integrations cannot send emails, payments or other real effects.
4. Perform only approved actions using verified installed tools. Record start,
   service-ready time, recovered marker and observed data gap with units and
   clock assumptions. Measure RTO and RPO independently; unknown markers mean
   unverified data loss, not zero loss.
5. Verify restored schema/content integrity, critical application journeys,
   authorization, replication/queue checkpoints and duplicate/replay behavior.
   Test the relevant dependency, not merely that the database accepts a socket.
6. Compare measured recovery time/data loss against objectives. Capture artifacts,
   failed/unrun checks, irreversibility and environment differences; report
   pass/fail/inconclusive. Simulation cannot certify production failover.
7. Obtain approval for cleanup, traffic restoration or failback separately as
   required; retain only permitted evidence. Record owner, next rehearsal date
   and remediation for unmet objectives.

## Output
`Scenario:`, `RTO/RPO targets:`, `Authorization boundary:`, `Recovery evidence:`,
`Measured RTO/RPO:`, `Integrity checks:`, `Cleanup/failback:`, `Outcome:` and
`Unverified scope:`. Clearly distinguish proposed steps from executed actions.

## Stop conditions
Stop on uncertain target/ownership, missing keys/backup evidence, exposed
production data, unexpected external effects, loss of isolation, budget
exceedance or a failed safety gate. Do not resolve these by widening privileges,
disabling encryption, overwriting production or pretending recovery succeeded.
