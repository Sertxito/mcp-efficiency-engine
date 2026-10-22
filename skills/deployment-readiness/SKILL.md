---
name: deployment-readiness
description: "Prepare and validate a release or deployment plan. Use for production rollout, environment promotion, infrastructure release, or go/no-go review."
---

# Deployment readiness

## Procedure
1. Confirm target environment, version, change scope, owner, and authorization.
2. Verify build provenance, tests, security gates, configuration, migrations,
   dependencies, and environment parity.
3. Define rollout sequence, health checks, abort criteria, and rollback limits;
   state what is not reversible.
4. Confirm monitoring, runbook, on-call ownership, communication, and rollback
   signal thresholds.
5. Request explicit approval for the exact target/version/action.
6. After an approved deployment, verify observed health and report actual status.

## Progressive delivery contract
When the project supports canary/blue-green or feature flags, define cohort,
control population, observation window, minimum samples and explicit
health/error/latency/resource abort thresholds. Check cohort comparability
before attributing a difference to the release.
Record flag owner, default/failure behavior, access boundaries, expiry and
removal task. A flag is not a substitute for authorization or a reversible
database migration.
Choose rollback, forward fix or restore from actual reversibility and data
effects; do not assume old binaries can read newly transformed data. Confirm
operator/on-call and user communication, then separately authorize each action.
Observe the agreed post-release window and verify artifact/version, critical
journeys and dependency health. An upload/deployment success is not service
health; unavailable telemetry leaves the go/no-go decision unresolved.

## Output
Readiness checklist, evidence, unresolved risks, exact approved action, rollout
and recovery steps, and post-deployment observations. A plan is not a deployment.
