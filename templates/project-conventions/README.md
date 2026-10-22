# Organization and project conventions

Use this kit to decide how **your team** works without forking MCPEE's general
engineering guidance. These are examples, not approved organizational policy.
They are packaged with MCPEE and registered as templates, not activated rules.

## Four distinct layers

| Layer | Responsibility | Example |
|---|---|---|
| MCPEE technical baseline | Reusable language/framework practices in scoped guides | DI lifetimes, EF query inspection, version-aware Angular signals |
| MCPEE skills | Procedures to apply knowledge and verify a task | Implement a backend change or diagnose a SQL bottleneck |
| Organization/project conventions | Only local choices and component particulars | Approved DI container, registration naming, composition-root path |
| Project specifications | Required system behavior and measurable acceptance | Stock reservation rules or a latency target under a defined workload |

Users do not need to rewrite the technical baseline to start a project.
Use the applicable bundled guide and local code first; consult official sources
for gaps, uncertainty or version-sensitive behavior, not to rediscover every
covered practice. The baseline is maintained knowledge, not an exhaustive manual
or a promise that its examples apply to every runtime version.
Conventions are a small supplement, not another best-practice catalog or a
requirements document. Keep specs in the project's existing authoritative
sources and link them rather than copying business rules or numeric targets
into instructions. Skills consult those sources for task acceptance.

## Choose the right source

| Need | Starting point | Destination in the consuming repository |
|---|---|---|
| Rules shared across an organization | [Organization template](organization.instructions.template.md) | `.github/instructions/organization.instructions.md` |
| Project boundaries, commands and decisions | [Project template](project.instructions.template.md) | `.github/instructions/project.instructions.md` |
| Specific stack/component conventions | [C# DI example](backend-csharp.instructions.template.md) | `.github/instructions/backend-csharp.instructions.md` |
| A task-specific multi-step procedure | [Skill blueprint](../agent-authoring/skill/SKILL.template.md) | `.github/skills/<team-skill-id>/SKILL.md` |

Organization and project instructions use a broad scope because they contain
cross-cutting constraints. Keep them short. Language/framework instructions must
use narrow file patterns. A skill is appropriate for a procedure such as
"review DI registrations", not for a convention needed on every C# change.
For Python, Angular, React, Vue, SQL or IaC, use the same scoped-instruction
structure and replace the C# example with approved decisions for that stack.

## Adoption

1. Identify the organization policy owner and project/component owners. Record
   approved versions and source decisions; do not put secrets in instructions.
2. Find these sources in the installed package's `templates/project-conventions`
   directory or copy their bodies from the project's
   `.mcpee/generated/catalog-templates.md`. Do not copy the catalog wrapper,
   Markdown fences or MCPEE generated marker into your destination.
3. Copy only relevant templates to the destinations above. If a destination
   already exists, review and merge it; never overwrite existing instructions
   or create a competing copy of the same rule.
4. Replace every `{{...}}` placeholder, remove unused sections and approve the
   local choices. Do not duplicate generic guidance. The DI example illustrates
   optional container/registration choices, not rules every project must adopt.
   Replace its sample `src/backend` and `tests/backend` globs with real paths.
5. Commit the completed files in **your project's Git repository** and verify
   they are not ignored. Use names without the `mcpee-` prefix, never edit
   `.mcpee/generated/*` or generated `.github/*/mcpee-*` files.
6. Refresh MCPEE capabilities after updating MCPEE. Team-owned files without
   the generated marker are preserved; they are not overwritten or merged
   with newer template examples. Your team reviews template improvements.
7. Verify applicability and behavior using the checks below before adoption.

There is no organization-policy sync service here: each consuming repository
must version the applicable organization rules or explicitly use a host-supported
organization mechanism. Assign an owner to propagate and review changes.

## Decisions to fill in

- Organization: privacy/data boundaries, permitted dependencies and licenses,
  review/approval owners, shared quality requirements and exception process.
- Project: authoritative version manifests, component paths, architecture
  boundaries, contract ownership, exact commands and links to existing specs.
- Stack/component: approved choices for container/registration, state ownership,
  persistence libraries or naming where the team has a particular convention;
  component paths and links to approved examples, not generic DI/EF/signals rules.
- Procedure: trigger, inputs, steps, expected evidence and failure/approval
  paths. Reuse existing MCPEE skills instead of cloning their entire content.
- Exceptions: affected rule, rationale, scope, approver, review date and
  compatibility consequences. An exception never grants tool authority.

Local conventions refine generic style and design recommendations; they cannot
relax MCPEE approval, security, privacy or evidence requirements. Instruction
file order and filenames do not establish an automatic precedence system.
For conflicting mandatory rules, report the conflict and get an authorized
decision before the affected change; do not silently choose one.
If no local choice is specified, use the technical baseline and compatible
existing repository patterns. Do not require a completed template for every
task or invent a team policy; ask only for unresolved consequential decisions.

## Verification and limits

- Confirm the host discovers the completed instruction files and that `applyTo`
  matches a real target file but not an unrelated language/component.
- In ordinary Copilot Chat, request a C# change and require the response to cite
  the applicable convention path and demonstrate the chosen DI pattern.
- Separately test `mcpee run`/`mcpee_run`: ask the executor to inspect the exact
  team-owned instruction files before editing and report the applied rules.
  MCPEE's route/explain technical-guidance list describes bundled catalog
  guidance, not proof that custom files were loaded. These templates add no new
  SDK instruction loader, merge algorithm or deterministic enforcement.
- Test a conflict, missing decision and wrong-stack task. Expect clarification
  for conflicts/unknowns and no C# DI pattern imposed on Python or frontend code.
- Refresh capabilities and verify your completed files remain byte-for-byte
  unchanged. Test a clean clone as well, not just one developer's editor.
- Run the declared analyzers/tests and review the actual diff. Instruction text
  alone cannot enforce architecture or guarantee that the model follows it.
  Automate important constraints in existing analyzers, tests and CI.

Use the [asset evaluation pattern](../agent-authoring/patterns/asset-evaluation-case.md)
to record scenarios, observed behavior, unrun checks and remaining gaps.
