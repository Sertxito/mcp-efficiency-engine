# Catalog, capabilities and tools

What MCPEE installs into a project: agents, skills, workflows, guidance,
policies and local tools, and how to manage them.

- [How capabilities are selected](#how-capabilities-are-selected)
- [Manage capabilities](#manage-capabilities)
- [Roles and technical guidance](#roles-and-technical-guidance)
- [Policies and enforcement](#policies-and-enforcement)
- [Specialized procedures](#specialized-procedures)
- [Templates and team conventions](#templates-and-team-conventions)
- [Local tools](#local-tools)
- [Runtime requirements for tools](#runtime-requirements-for-tools)
- [Audits and cloud inventory](#audits-and-cloud-inventory)
- [Catalog integrity](#catalog-integrity)

## How capabilities are selected

New projects install the **full catalog locally by default**, in both interactive
and non-interactive `init`: agents, skills, workflows, patterns, playbooks,
technical guidance, scorecards, evaluation cases, prompt examples and templates.
This is availability, not execution or permission to act. Task routing selects
the relevant specialist, workflow and supporting assets; it does not put every
installed skill's body in every prompt. Workflow skills remain explicit-invocation
only, and technical instructions retain their file-scoped globs.

`--agents <id,...|all|none>` explicitly limits the agent selection and includes
matching skills, workflows and patterns. `--agents all` means all agents and
their dependencies, not every independent catalog asset.

MCPEE still detects stack signals from project/configuration files, dependency
manifests and code files, skipping VCS, dependency, generated and build
directories. Detection informs task context and brownfield discovery, not the
default local catalog size. Evidence and installed assets are recorded in
`.mcpee/generated/project-capabilities.{json,md}`.

The `orchestrator` agent and its skills and patterns are core: they are always
installed, even with `--agents none`, because every workflow is coordinated by
it and `mcpee doctor` requires it. `mcpee capabilities` reports them as `core`
and does not remove them. Rendered agents and skills use `name: mcpee-<id>`,
matching their file or folder name.

Re-run `mcpee init` after the stack changes (for example, once a greenfield
project has its first code) to refresh detection. Existing selections and
removals are preserved; older projects are not silently expanded. `mcpee explain` shows
the detected stack and selection. See
[Getting started](GETTING-STARTED.md#how-mcpee-chooses-brownfield-or-greenfield).

## Manage capabilities

| Command | Effect |
|---|---|
| `mcpee capabilities list [--type <type>] [--json]` | Shows detected/installed, available and non-removable core entries. |
| `mcpee capabilities install <id> [--type <type>]` | Installs an asset and restores its agent/workflow/playbook dependencies. |
| `mcpee capabilities install all [--type <type>]` | After maintenance approval, installs all catalog assets, or all assets of one type, plus dependencies. Restores earlier removals in that scope. |
| `mcpee capabilities remove <id> [--type <type>]` | Removes an asset. It refuses to break another installed capability and keeps shared dependencies. |
| `mcpee capabilities update [<id>] [--type <type>]` | Refreshes one or all installed assets from the package's current catalog. |

Types: agents, skills, workflows, patterns, templates, playbooks, technical
guides, scorecards, evaluation cases and prompt examples. The selection is
stored in `.mcpee/state/catalog-capabilities.json`. User-owned files at
generated paths are always preserved.

For an existing project, run `mcpee capabilities install all --project <path>`
to opt into the full local catalog. With `--type skills`, for example, only
skills are added; with `--type agents`, associated workflows, skills and patterns
are also restored. Unrelated selections/removals are retained. Policies and tool
capabilities are core, not separately installable types. Approval uses the
existing maintenance broker or an interactive `install` confirmation;
unapproved non-interactive calls fail closed. Output reports the selected entry
count, newly installed entries including dependencies, and generated-file
created/updated/removed/preserved counts. Repeating the operation is safe.
It downloads nothing, runs no agent/workflow/model, and installs no local tools.

## Roles and technical guidance

- **Roles are responsibilities**, not language experts: product,
  architecture, engineering (backend, frontend/UX-UI, database/data,
  infrastructure/DevOps/observability), quality, security, AI, delivery,
  operations and documentation. Editable blueprints live in `agents/`,
  `skills/` and `workflows/`; they become active only when mapped in
  `catalog/catalog.json`.
- Next.js tasks use the existing frontend specialist with the
  `nextjs-app-router-development` skill; MCPEE does not create a duplicate
  framework-specific agent role.
- **Technical guides** are file-scoped Copilot instructions under
  `.github/instructions/` for C#/.NET, Python, Node.js, JavaScript/TypeScript,
  Angular, React, Vue, SQL, Cosmos DB, Bicep, Terraform, pipeline YAML and
  cloud. Each declares its technologies and `apply_to` globs, so mixed stacks
  get separate applicable guides. Framework-wide globs are advisory in
  monorepos.
- Each guide contains an authored working baseline (for C#: contracts and
  types, collections, async, errors, DI, EF Core, hosting and validation),
  cites official documentation and stays subordinate to the repository's real
  versions and conventions. Guides are not a full language manual. Longer
  procedures belong in skills.
- `mcpee explain --task "..."` shows which workflow, specialist, skills,
  patterns, playbooks, guides, scorecards, evaluation cases and prompt examples
  apply to a task.

## Policies and enforcement

- Common policies have one source in `catalog/catalog.json` and one always-on
  instruction, `mcpee-policies.instructions.md`. Every agent links to it and to
  the shared operating contract. SDK runs receive the same policies with their
  enforcement modes and evidence requirements.
- The `preToolUse` hook gates tool calls for approval. It does not enforce
  naming, formatting, analyzers or test results. Those become deterministic
  only when the project configures and runs its own formatter, analyzers and
  tests (see [Quality and evaluation](QUALITY-AND-EVALUATION.md)).

## Specialized procedures

- **Performance** is a controlled procedure, not an automatic optimization:
  a numeric target, reproducible baseline, stack-appropriate profiling,
  repeated measurements, correctness/resource checks and a
  pass/fail/inconclusive conclusion. Shared or production profiling needs
  exact, bounded approval.
- **Migration** requests activate the migration playbook in the plan and
  context. It does not authorize execution.
- **`sql-performance-diagnosis`** correlates source, plan and waits and requires
  functional regression before SQL tuning.
- **`recovery-rehearsal`** requires measured RTO/RPO and application integrity
  after separately approved, isolated restore/failover actions.
- The [boost capability coverage map](BOOST-CAPABILITY-COVERAGE.md) records
  recovered backend, frontend/UX, DBA, cloud and forensic capabilities and
  deliberate exclusions.

## Templates and team conventions

- `templates/agent-authoring/` has source templates for agents, skills,
  workflows, prompts, findings, decisions, work items, vertical slices, tests,
  handoffs, rollouts, incidents and asset evals. They do not activate assets or
  change the catalog.
- The [project conventions kit](../templates/project-conventions/README.md)
  explains how to add team choices on top of MCPEE's technical baseline:
  organization/project templates, conflict handling and post-update checks.
  Functional rules stay in project specifications.
- Templates appear in `.mcpee/generated/catalog-templates.md` but are never
  activated automatically. Team-owned instruction files live alongside generated
  guidance, and updates preserve them without merging new defaults or relaxing
  policies.

## Local tools

After per-package approval, `init` installs pinned versions into isolated
directories under `.mcpee/tools/`. It never modifies the project's manifest,
`node_modules`, global tools or user-level Copilot settings.

| Tool | Role | Required |
|---|---|---|
| CodeGraph | Local symbol graph in `.codegraph/`; also exposed as the `mcpee-codegraph` MCP server | Yes. Setup and routing fail closed without it. |
| MarkItDown (PDF, Word, PowerPoint, Excel extras) | Office/PDF ingestion | No |
| Graphify | Code-only AST graph | No |
| Repomix | Context packing for `mcpee run --pack-context` | No |

Declining an optional tool does not block initialization. Non-interactive
installs are denied unless `--skip-tool-install` is supplied. GitNexus is
discovery-only and never installed automatically: its PolyForm Noncommercial
license is not suitable for general business use without separate permission.

- `mcpee tools list` shows configured local executables.
- `mcpee tools validate --tool node` runs a bounded version check.

Discovery and invocation never install tools, and execution uses allowlisted
commands without a shell.

## Runtime requirements for tools

- **Node.js**: the CLI requires Node.js 24+; tools enforce their declared
  minimum versions. `init` checks the official latest LTS as an advisory,
  without touching system Node. A newer patch or an unavailable release index
  does not block compatible installations.
- **Python**: `init` uses `uv` to install the latest stable Python under
  `.mcpee/tools/` and builds the Graphify and MarkItDown environments from it.
  The global Python is never modified. On first setup, a Python 3.8+
  interpreter with pip is needed only to bootstrap the pinned `uv`. Setup
  reports an explicit blocker if it is unavailable.
- Installing tools downloads packages from npm/PyPI into the ignored tool
  directory.

## Audits and cloud inventory

- `mcpee assets audit [--json]` runs a bounded, read-only heuristic scan of
  project-local agent, skill, hook, instruction and MCP configuration paths.
  It reports path, line, severity and remediation without echoing matched
  values. High or critical findings exit non-zero. A clean result is not proof
  of harness security.
- `mcpee cloud inventory --provider azure|aws [--json]` makes an explicit,
  read-only query through your installed Azure CLI or AWS CLI with its existing
  login. It reports aggregate resource counts only, not IDs, names, tags or
  credentials. MCPEE never installs cloud CLIs, stores credentials, changes cloud
  state or exports the result.

## Catalog integrity

The central catalog validates unique IDs and cross-references across agents,
skills, workflows, policies, executable tools, tool capabilities, routing
rules, source processors, patterns and templates. The catalog lock covers
canonical catalogs and referenced sources. It renders Copilot profiles, skill
procedures, workflow contracts, policy guidance and pattern/template indexes.
Stale generated files are removed only when the manifest and MCPEE ownership
marker confirm that they are generated.

`mcpee update` refreshes project integration files and the rendered catalog from
the installed MCPEE package after approval. It does not update the npm package
or install tools.
