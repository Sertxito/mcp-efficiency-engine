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

## Choose evidence, not a new testing stack
- Detect the installed runner/framework, version, configuration and CI matrix.
  For .NET, retain the existing MSTest/NUnit/xUnit/TUnit conventions and
  supported target frameworks; for Python, respect declared pytest/unittest
  fixtures and interpreter range; for JS/TS, retain the existing test runner,
  browser environment and package scripts. Do not mix assertion APIs or
  replace the framework as an incidental change.
- Cover async completion, cancellation, timeouts, disposal and race/failure
  behavior. Await assertions and isolate clocks, randomness and external I/O.
- Use integration tests for real provider/transaction/authentication behavior;
  mocks at owned boundaries should not merely repeat the implementation.
- Choose property-based checks for domain invariants, boundary generators and
  serialization round trips; record seeds and minimize failing cases.
- Consider bounded fuzzing for parsers/untrusted protocols and mutation testing
  for critical rules when existing tooling permits it. Define an oracle and
  resource cap first; do not install tooling or fuzz shared services implicitly.
- Version consumer contracts and check both producer and consumer compatibility.
  Use browser interaction tests for critical journeys, accessible behavior and
  lifecycle cleanup rather than relying only on snapshots.
- Map changed entry points and dependencies to selected tests. An import edge,
  line coverage percentage or test discovery is not proof that behavior is
  asserted. State what the selection misses.
- Treat flaky tests as defects: preserve failures, bound retries, assign owner
  and expiry to quarantine, and keep release-critical checks blocking. Never
  improve a pass rate by silently skipping failures or refreshing golden files.

## Output
Risk-to-check map, checks actually run, results, artifacts, and residual risk.
Do not mark the change complete when required evidence is missing or failing.
