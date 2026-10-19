---
name: evidence-and-findings
description: "Produce evidence-backed engineering findings with confidence and explicit uncertainty. Use for architecture, security, quality, incident, code, or operational reviews."
---

# Evidence and findings

## Procedure
1. Define scope, evidence window, sources available, and material not inspected.
2. Label each statement as an observed fact, hypothesis, or recommendation.
3. Attach source path/location, command/output, query/window, or other reproducible evidence.
4. Record confidence and distinguish root cause from correlation or speculation.
5. Describe business impact, technical impact, severity/priority, and affected boundary.
6. State checks actually run, results, coverage limits, unknowns, and next verification.

## Finding format
- **Finding:** concise, actionable statement.
- **Kind:** fact, hypothesis, or recommendation.
- **Evidence:** source and reproducible location/result.
- **Confidence:** high/medium/low with a short reason.
- **Impact:** business and technical effects; mark unknown where not established.
- **Priority:** rationale and relevant severity, without false precision.
- **Validation:** performed checks and results, or explicitly “not run”.
- **Unknowns / next step:** what evidence could change the conclusion.

Do not force every field onto a lightweight task. Never report an unrun or skipped
check as passed, or use confidence as a substitute for evidence.
