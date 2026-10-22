---
name: cloud-review
description: "Review a declared cloud environment for identity, networking, reliability, recovery, observability, and cost using provider-specific evidence."
---

# Cloud review

## Procedure
1. Confirm provider, services, region, deployment identity, versions, and review
   boundary from project evidence.
2. Trace network exposure, identity, secrets, data, and service dependencies.
3. Assess reliability, backup/recovery, observability, capacity, and cost only
   against stated objectives and current evidence.
4. Run provider-native static validation only when locally configured and
   approved; distinguish validation from deployment approval.
5. Record unknowns, owner decisions, mitigations, and safe verification steps.

## Reliability and resource evidence
- Verify failure domains and real service configuration: zonal/regional
  isolation, dependency health checks, routing/DNS failover, backup retention
  and supported PITR window. Configured redundancy is not a tested recovery.
- For messaging, inspect retry budgets/backoff, poison messages, dead-letter
  queues, acknowledgement/visibility semantics, duplicate handling and bounded
  replay with an owner. Never redrive a queue or change retention implicitly.
- Check concurrency/throttling limits, noisy-neighbor isolation, quotas and
  saturation against workload growth and numeric objectives. For AWS serverless
  workloads, reserved concurrency may be relevant, but is not a universal fix.
- Review private/public endpoints, least-privilege identities, TLS/encryption,
  key/secret rotation and logging/cost ownership using approved metadata.
  Verify provider-specific security controls against the actual deployed service,
  not a copied cross-provider checklist.
- Use recovery-rehearsal for an approved isolated restore/failover exercise.
  Backup success and infrastructure declarations are insufficient evidence of
  achieved RTO/RPO.

## Output
Provider-specific findings with sources, impact, assumptions, checks, and
recovery constraints. Do not assume a cloud, region, or availability target.
