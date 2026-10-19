# Validate change

**Trigger:** A code, configuration, contract, infrastructure, or documentation
change needs evidence before merge or release.

**Lead roles:** QA lead; test automation engineer.

## Stages
1. Map each acceptance criterion and changed boundary to a risk and a concrete
   validation method; identify unsupported or untestable criteria.
2. Select repository-declared test, static-analysis, contract, and security checks.
3. Run authorized checks and preserve exact commands, environment, and results.
4. Triage failures without weakening meaningful coverage.
5. Report pass/fail, blocked/skipped checks, untested scope, and residual risk;
   never infer a result from a check that did not run.

## Outputs
Evidence-backed quality report and release-gate recommendation. No result is
inferred from a command that was not run.
