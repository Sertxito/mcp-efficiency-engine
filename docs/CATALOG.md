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

During `init`, MCPEE detects stack signals from project/configuration files and
dependency manifests and, separately, code-file signals. VCS, dependency,
generated and build directories are skipped. Evidence and selected assets are
recorded in `.mcpee/generated/project-capabilities.{json,md}`.

- **Existing code (brownfield)**: supported code and stack evidence selects
  matching agents, skills, workflows, patterns, playbooks, technical guidance,
  scorecards, evaluation cases, prompt examples and templates automatically.
- **No code (greenfield)**: the first interactive `init` asks which agents to
  install. Their skills, workflows and patterns come along as dependencies.
  Non-interactive `init` without `--agents` uses the general-purpose default
  and does not guess a stack.

Re-run `mcpee init` after the stack changes (for example, once a greenfield
project has its first code) to refresh detected assets. `mcpee explain` shows
the detected stack and selection. See
[Getting started](GETTING-STARTED.md#how-mcpee-chooses-brownfield-or-greenfield).

## Manage capabilities

| Command | Effect |
|---|---|
| `mcpee capabilities list [--type <type>] [--json]` | Shows detected/installed, available and non-removable core entries. |
| `mcpee capabilities install <id> [--type <type>]` | Installs an asset and restores its agent/workflow/playbook dependencies. |
| `mcpee capabilities remove <id> [--type <type>]` | Removes an asset. It refuses to break another installed capability and keeps shared dependencies. |
| `mcpee capabilities update [<id>] [--type <type>]` | Refreshes one or all installed assets from the package's current catalog. |

Types: agents, skills, workflows, patterns, templates, playbooks, technical
guides, scorecards, evaluation cases and prompt examples. The selection is
stored in `.mcpee/state/catalog-capabilities.json`. User-owned files at
generated paths are always preserved.

## Roles and technical guidance

- **Roles are responsibilities**, not language experts: product,
  architecture, engineering (backend, frontend/UX-UI, database/data,
  infrastructure/DevOps/observability), quality, security, AI, delivery,
  operations and documentation. Editable blueprints live in `agents/`,
  `skills/` and `workflows/`; they become active only when mapped in
  `catalog/catalog.json`.
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

- **Node.js**: a complete tool installation needs the latest patch of the
  official Node.js LTS. `init` checks the official release index and reports the
  required update without touching the system Node. If Node is not exactly the
  latest LTS, Repomix installation is blocked and `init` reports incomplete
  setup.
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
