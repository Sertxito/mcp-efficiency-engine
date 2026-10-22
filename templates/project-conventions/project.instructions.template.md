---
description: "Apply this project's approved boundaries, supported versions and validation requirements."
applyTo: "**"
---

# {{project_name}} project conventions

<!-- Copy to .github/instructions/project.instructions.md. Inspect the actual
repository to fill this in; do not guess commands, versions or ownership. -->

Owner: {{project_owner}}
Decision sources and revision: {{approved_decision_paths_and_revision}}
Next review: {{review_date_or_trigger}}

## Architecture and ownership

- Authoritative runtime/version manifests: {{version_manifest_paths}}.
- Components and permitted dependency directions: {{component_paths_and_boundaries}}.
- Public/serialized/database contract owners: {{contracts_and_owners}}.
- Applicable scoped instruction files: {{instruction_paths_and_component_scopes}}.
- Approved organization policy source: {{organization_policy_path_or_host_source}}.

## Validation

<!-- Replace with exact existing commands and working directories. Add only
checks this project actually supports. A declared command is not a passing run. -->

| Check | Working directory | Command | Required environment/evidence |
|---|---|---|---|
| Build/type check | {{build_directory}} | {{build_command}} | {{build_requirements}} |
| Tests | {{test_directory}} | {{test_command}} | {{fixtures_and_result_artifact}} |
| Lint/analyzers | {{lint_directory}} | {{lint_command}} | {{configuration_and_result}} |

## Specification sources

<!-- Link existing sources instead of copying business rules or acceptance
thresholds here. Conventions describe how to work, not what the system must do. -->

- Functional rules and acceptance criteria: {{functional_spec_paths}}.
- Performance budgets, workload and measurement method: {{performance_spec_paths}}.
- Data/test-environment restrictions: {{environment_policy_paths}}.
- Deployment, rollback and irreversible-change constraints: {{release_policy_paths}}.

Keep only project-specific choices and source locations in this file. Reuse
MCPEE's technical baseline and skills instead of duplicating their practices.
When no local preference is declared, follow compatible existing patterns;
do not invent requirements or require a new convention before routine work.

Use the smallest existing checks covering the change and report actual outcomes,
skipped checks and missing prerequisites. Do not run commands merely because
they are listed: retain the required action-specific approval.
Ask the responsible owner when a consequential decision is missing or conflicts
with an approved rule. Do not treat this file as permission to bypass policies.
