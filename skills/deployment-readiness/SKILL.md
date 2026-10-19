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

## Output
Readiness checklist, evidence, unresolved risks, exact approved action, rollout
and recovery steps, and post-deployment observations. A plan is not a deployment.
