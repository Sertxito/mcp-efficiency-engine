---
name: test-strategy
description: "Choose risk-based tests and report validation evidence. Use for feature acceptance, regressions, release gates, or deciding what checks to run."
---

# Test strategy

## Procedure
1. Map acceptance criteria and changed boundaries to failure risks.
2. Select the lowest-cost test level that provides credible evidence.
3. Include relevant negative, boundary, compatibility, and recovery cases.
4. Run only project-declared checks; capture exact commands and outcomes.
5. Report untested scope, blocked checks, flakes, and evidence limitations.

## Output
Risk-to-check map, checks actually run, results, artifacts, and residual risk.
Do not mark the change complete when required evidence is missing or failing.
