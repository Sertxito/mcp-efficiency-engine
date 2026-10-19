---
name: debugging-and-recovery
description: "Reproduce, localize, fix, and guard against software failures. Use when behavior is unexpected, a test/build/check fails, or a regression needs diagnosis."
---

# Debugging and recovery

## Procedure
1. Capture the failing behavior, environment, exact command or interaction, and
   expected result; reproduce it before changing code when safe.
2. Trace the failure through relevant source, configuration, dependencies, and
   available logs or runtime evidence. Separate the observed symptom from the
   suspected cause.
3. Reduce the problem to the smallest failing boundary and test the leading
   cause with a discriminating check.
4. Fix the smallest responsible behavior and add a regression check that fails
   before the fix and passes afterward.
5. Run focused project-declared checks and report exact results, blocked checks,
   remaining uncertainty, and safe recovery options.

## Safety
Do not hide failures with broad exception handling, silent defaults, weakened
assertions, or unrelated test changes. Use fallbacks only when they preserve
the documented contract. Do not change production state or external services
without explicit approval.

## Output
Reproduction evidence, localized cause or unresolved hypotheses, corrective
change, regression evidence, checks/results, and remaining risks.
