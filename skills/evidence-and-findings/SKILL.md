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
7. Consolidate symptoms with the same root cause. Do not infer missing authorization,
   retry limits or caller error handling from an out-of-scope fragment; request
   that evidence or state a conditional risk instead of a confirmed defect.
8. Distinguish missing operational evidence from an explicit unsupported claim
   that verification succeeded. Correct the claim when the supplied evidence
   contradicts it; do not infer the underlying recovery or security capability
   is absent. An honestly stated unverified scope is not the same defect.

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
