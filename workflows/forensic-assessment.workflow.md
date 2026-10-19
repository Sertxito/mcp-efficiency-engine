# Forensic assessment

**Trigger:** The system is unfamiliar, legacy, poorly documented, recently
transferred, or needs a trustworthy current-state baseline before change.

**Lead roles:** Forensic architect; relevant senior engineers.

## Stages
1. Set scope, critical journeys, environments, questions, and evidence limits.
2. Inventory entry points, source, dependencies, configuration, tests, data
   stores, integrations, deployment, and operational documentation.
3. Trace representative runtime, data, API/event, and deployment paths from
   evidence; distinguish static structure from verified runtime behavior.
4. Compare source and tests with documentation and record contradictions,
   hypotheses, confidence, and unknowns.
5. Assess business/technical impact and prioritized risks without proposing
   unsubstantiated remediation.
6. Present verification steps and only then hand target-state design to the
   principal architect.

## Outputs
Scope and evidence register, current-state map, verified facts, hypotheses,
unknowns, confidence, impact/risk register, coverage limits, and next checks.
Evidence reporting follows `evidence-and-findings`; no changes are performed
unless separately requested and approved.
