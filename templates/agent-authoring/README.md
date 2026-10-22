# Agent authoring kit

This kit standardizes the **source assets** for the project-agent blueprint in
`../../agents/`, `../../skills/`, and `../../workflows/`. It is not the runtime
catalog, does not activate assets, and does not change `../../catalog/catalog.json`.
The catalog owner decides which reviewed assets and relationships to adopt.

For organization/project conventions rather than new catalog capabilities, use
the [project conventions kit](../project-conventions/README.md). It includes
team-owned instruction templates and a scoped C# dependency-injection example.

## Blueprints

- `agent.template.md`: role boundary, authority, evidence, and handoff.
- `skill/SKILL.template.md`: on-demand procedure with optional supporting assets.
- `workflow.template.md`: lifecycle, roles, gates, and observable outputs.
- `prompt.template.md`: one-shot, parameterized task with a defined output.

## Reusable patterns

- `patterns/finding.md`: a sourced engineering finding with explicit uncertainty.
- `patterns/decision-record.md`: options, trade-offs, decision status, and consequences.
- `patterns/user-story.md`: outcome-oriented work item with testable acceptance.
- `patterns/vertical-slice.md`: independently reviewable end-to-end implementation slice.
- `patterns/test-plan.md`: risk-to-check mapping and honest results/coverage.
- `patterns/handoff.md`: bounded transfer between roles, including approvals.
- `patterns/change-and-rollout-plan.md`: staged implementation, deployment, and recovery.
- `patterns/incident-update.md`: timestamped, evidence-led incident communication.
- `patterns/asset-evaluation-case.md`: repeatable agent/skill/workflow behavior check.

Copy only the pattern needed for the task; templates are starting points, not
mandatory forms. Preserve user/project context and remove unused sections rather
than filling unknowns with assumptions.

## Authoring and review

1. Start with a concrete user or operator outcome and locate existing assets.
2. Reuse a role, skill, workflow, or pattern when its scope already fits; avoid
   cloning specialist roles for overlapping review domains.
3. Give each agent a narrow ownership boundary and only the tools it needs.
   State who owns product, security, architecture, and production decisions.
4. Make skill descriptions discoverable with specific task phrases. Keep
   procedures concise; move substantial reference material into `references/`,
   reusable files into `assets/`, and deterministic helpers into `scripts/`.
   Include only directories/files the procedure actually needs.
5. Write workflows with entry conditions, explicit gates, concrete outputs,
   failure paths, and specific approval points for external/state-changing work.
6. Link claims to sources. Separate observed facts, hypotheses, and
   recommendations; label checks as passed only when they actually ran.
7. Evaluate happy path, ambiguity, missing evidence/tool, failure, and
   approval-required cases. Report untested cases and do not treat an eval score
   as proof of safety or correctness.
8. Check all local references and role/skill/workflow relationships. Propose
   catalog changes separately for the catalog owner.

## Shared operating contract

- Prefer the smallest effective scope, minimal context, and least tool authority.
- Inspect before editing; plan impact and validate the exact requested outcome.
- Surface blockers and errors. Do not hide failures behind defaults or success-shaped
  output.
- Ask for decisions when authority, scope, or a consequential behavior is unclear.
- External writes, publication, deployment, production changes, and data transfer
  require explicit approval for the specific target and action.
- Report evidence, confidence, limitations, and the next owner when handing work off.

## Validation checklist

- [ ] Name/ID, description, path, and referenced asset names are consistent.
- [ ] Responsibility is distinct from neighboring roles and shared skills.
- [ ] Tool access and external-action authority are least-privilege and explicit.
- [ ] Every referenced path, skill, workflow, or tool exists or is marked proposed.
- [ ] Procedures produce observable, reviewable outputs.
- [ ] Evaluation cases cover success, failure, ambiguity, and approval boundaries.
- [ ] Checks run, skipped checks, coverage gaps, and residual risk are distinguished.
- [ ] No asset is treated as active until the catalog owner adopts it.
