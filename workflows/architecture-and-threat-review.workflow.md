# Architecture and threat review

**Trigger:** A feature crosses service boundaries, changes a contract, handles
sensitive data, or introduces a platform/model integration.

**Lead roles:** Principal architect; security architect.

## Stages
1. Define scope, stakeholders, constraints, decision owner, and critical journeys.
2. Reconstruct current behavior and data flows from source-linked code,
   configuration, tests, and runtime evidence; label gaps and hypotheses.
3. Trace dependencies, consumers, trust boundaries, and failure paths with
   source-linked evidence.
4. Compare design options for compatibility, security, reliability, performance,
   operability, migration effort, and cost; state assumptions and confidence.
5. Draft ADR, threat scenarios, mitigations, and verification requirements.
6. Obtain decisions from authorized product/security/platform owners; a review
   does not authorize implementation or deployment.

## Outputs
Impact assessment, ADR proposal, threat model, acceptance/verification criteria,
and unresolved risks. A draft is not an approved architecture decision.
