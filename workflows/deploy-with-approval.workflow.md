# Deploy with approval

**Trigger:** An authorized release is ready for an environment deployment.

**Lead roles:** Release manager; DevOps engineer; platform engineer.

## Stages
1. Confirm release scope, target environment, owner, and deployment authorization.
2. Verify gates, secrets/configuration references, migration ordering, and health checks.
3. Present exact deployment action, target, expected impact, and rollback limitations.
4. Obtain explicit approval for this deployment action.
5. Execute via the project-declared path and observe the actual deployment status.
6. Run post-deploy health checks; stop/rollback only under the approved plan.

## Progressive rollout gate
For supported canary/blue-green/feature-flag delivery, record cohort/control,
minimum samples, observation window and numeric abort thresholds. Name the flag
owner/expiry, on-call and recovery decision-maker. Verify artifact provenance,
irreversible data effects and whether rollback or forward fix is viable.
Do not infer service health from upload success or authorization from a green
pipeline. Missing gates or telemetry remain explicit go/no-go blockers.

## Outputs
Version, target, approval evidence, deployment result, health-check evidence,
and outstanding risks. Never deploy as a side effect of planning or validation.
