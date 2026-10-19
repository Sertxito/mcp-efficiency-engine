# Evaluate agent assets

**Trigger:** New or changed agent, skill, workflow, or proposed catalog mapping
needs review before adoption.

**Lead roles:** QA lead; team lead; relevant domain owner.

## Stages
1. Inventory the asset, intended users, triggers, scope, dependencies, and
   expected outputs; confirm the catalog remains unchanged unless requested.
2. Run `mcpee assets audit --json` for the local static checks; inspect coverage,
   skipped paths, and each heuristic finding. The audit is read-only and is not
   a proof of safety.
3. Check naming, frontmatter, discoverability, responsibility boundaries,
   tool/permission assumptions, and consistency with shared harness policies.
4. Trace every referenced role, skill, workflow, tool, template, and path to an
   existing target; flag unresolved or circular references.
5. Test representative happy path, ambiguity, unavailable-tool, failure, and
   approval-required scenarios with explicit expected outputs. Capture each
   response locally, then run its catalog case:
   `mcpee evaluate --case <case-id> --asset <asset-id> --response <project-relative-file>`.
   Literal assertions are smoke checks only; they are not semantic graders.
6. Verify evidence handling, error visibility, validation claims, and safeguards
   against unauthorized external or state-changing actions.
7. Report blocking findings, coverage, and adoption recommendation; require
   catalog-owner review before activating assets.
8. Use `mcpee skills health --json` to report observed workflow evaluation
   outcomes. Treat low/no sample size as insufficient evidence and never claim
   an individual skill caused an outcome.
9. A person records every scorecard criterion (0-2) with evidence in a local
   ratings JSON and reruns the same evaluation with `--ratings <file>` and
   `--reviewer <name>`. The report stores the response hash, not the response;
   only reviewed evaluations count as direct skill evidence.

## Outputs
Asset inventory, link/reference check, scenario results, evidence and
permission-boundary findings, coverage gaps, and adoption recommendation.
Evaluation does not automatically activate or publish the assets.
