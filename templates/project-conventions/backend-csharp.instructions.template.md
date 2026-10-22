---
description: "Apply team-specific C# container, registration and component choices alongside MCPEE's technical baseline."
applyTo: "src/backend/**/*.cs,tests/backend/**/*.cs"
---

# {{project_name}} C# backend conventions

<!-- EXAMPLE ONLY: copy to .github/instructions/backend-csharp.instructions.md,
replace the sample component globs, and approve or replace every example rule.
Do not use this file unchanged as an organization-wide architecture mandate.
Keep only local choices; do not copy MCPEE's generic DI/lifetime practices. -->

Owner: {{backend_owner}}
Supported framework/DI container: {{target_framework_and_container}}
Approved decisions and code examples: {{decision_and_example_paths}}
Next review: {{review_date_or_trigger}}

## Team choices

<!-- Examples of decisions, not universal best practices:
container = built-in Microsoft DI;
registration = explicit Add{Feature}(IServiceCollection, ...) extension methods;
discovery = no assembly scanning.
Replace with approved choices; delete rows that add nothing to the baseline. -->

- Registration organization and discovery: {{registration_convention}}.
- Approved libraries/patterns and adoption constraints: {{approved_patterns_and_limits}}.
- Canonical implementation to follow: {{approved_example_path}}.

## Component particulars

- Composition root and module registration paths: {{composition_paths}}.
- Generated/legacy registrations that must be preserved: {{protected_paths_and_reason}}.
- Existing composition checks: {{test_paths_and_project_validation_reference}}.

Use MCPEE's C# technical baseline for generic DI, lifetime, ownership and
verification practices; do not redefine them here. This file adds local choices,
not functional requirements or permission to replace the existing architecture.
Link any approved exception to its rationale, scope, owner and review trigger.
Report unresolved mandatory conflicts; never relax approval or safety controls.
