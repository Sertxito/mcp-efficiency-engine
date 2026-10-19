# Build and promote

**Trigger:** A validated change is ready to produce and promote a build artifact.

**Lead roles:** DevOps engineer; release manager.

## Stages
1. Verify commit/change scope, pipeline definition, identity, and artifact provenance.
2. Run or inspect required build, test, security, and packaging gates.
3. Confirm target environment, approvals, configuration, and migration dependencies.
4. Prepare a promotion preview with version, environment, and rollback constraints.
5. Obtain explicit approval before promoting or changing remote pipeline state.

## Outputs
Artifact identity, pipeline evidence, promotion proposal/approval, and rollback
criteria. A green build alone does not authorize deployment.
