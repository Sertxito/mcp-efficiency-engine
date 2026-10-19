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

## Output
Current-state map, evidence register, verified behaviors, hypotheses, gaps, impact,
and staged options. Do not infer behavior from naming or propose a rewrite without
an evidenced baseline and migration strategy.
