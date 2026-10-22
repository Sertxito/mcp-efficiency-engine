---
name: system-forensics
description: "Reconstruct system architecture and real behavior from code, configuration, tests, dependencies, and runtime evidence. Use for unfamiliar or legacy systems, technical due diligence, and modernization planning."
---

# System forensics

## Procedure
1. Agree scope, critical user journeys, environments, constraints, and questions.
2. Inventory entry points, manifests, deployment files, configuration, tests, and data stores.
3. Trace representative runtime, API, event, persistence, and deployment paths end to end.
4. Compare code and executable tests with documentation; record disagreements.
5. Label findings as facts, hypotheses, unknowns, or recommendations with evidence and confidence.
6. Produce impact/risk register and verification plan before proposing target-state changes.

## Takeover evidence register
For each critical journey, map entry point, data owner, deployment path,
dependency, operational owner and available runtime/test evidence. Identify
documentation contradictions without treating every old statement as a defect.
Check for public endpoints without an evidenced exposure decision, secrets in
settings/pipeline references, manually configured infrastructure drift, missing
central logs/correlation, absent cost ownership and untested recovery/runbooks.
Inspect authorized source/metadata only; do not actively probe endpoints or
retrieve secret values. These are candidate smells until concrete evidence and
scope establish an actual risk.
Each finding records source/location/date, fact versus hypothesis, root-cause
evidence, business/technical impact, blast radius, severity, confidence, owner,
incremental recommendation and verification. Estimate effort/value only with
declared assumptions; do not convert an arbitrary score into business certainty.
Prioritize stabilization, access/ownership gaps and restore evidence before a
takeover rewrite. Use the existing debt register/ADR for accountable decisions.

## Output
Current-state map, evidence register, verified behaviors, hypotheses, gaps, impact,
and staged options. Do not infer behavior from naming or propose a rewrite without
an evidenced baseline and migration strategy.
