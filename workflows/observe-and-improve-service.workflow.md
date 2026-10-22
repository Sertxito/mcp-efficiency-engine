# Observe and improve service

**Trigger:** Production readiness, reliability review, alert/dashboard improvement,
or recurring operational toil.

**Lead roles:** SRE; observability engineer.

## Stages
1. Identify critical user journeys, dependencies, current SLOs, and owners.
2. Inspect available metrics, logs, traces, alerts, runbooks, and privacy constraints.
3. Reproduce and localize reported failures or degradation using the available
   source and runtime evidence; do not confuse symptoms with causes.
4. For performance concerns, define the workload and baseline, locate bottlenecks
   using available approved measurements, and compare any proposed change under
   equivalent conditions.
5. Identify diagnostic gaps, noisy alerts, capacity/recovery risks, and missing runbooks.
6. Propose instrumenting or tuning signals with testable thresholds and owners.
7. Validate queries/alerts safely and request approval before external configuration writes.

## Reliability verification
Review queue retry/dead-letter/replay behavior, quotas/saturation, replica lag,
scheduled-job concurrency and missed runs where relevant. Document workload
growth, capacity headroom and threshold assumptions with owners.
For backup/restore/failover readiness, use recovery-rehearsal: obtain numeric
RTO/RPO and bounded action approvals, isolate the exercise, measure actual
recovery/data loss, check application integrity and separately authorize cleanup/
failback. Missing access, markers or measurements means inconclusive, not passed.

## Outputs
Observed reliability evidence, proposed SLI/SLO or signal changes, runbook gaps,
privacy considerations, owners, and validation results.
