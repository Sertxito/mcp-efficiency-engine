# Getting started with MCPEE

This guide expands the [README quick start](../README.md#quick-start). It covers
every installation option, what `mcpee init` does, and the first steps for an
existing codebase (brownfield) and for an empty project (greenfield).

- [Requirements](#requirements)
- [Install](#install)
- [Initialize a project](#initialize-a-project)
- [How MCPEE chooses brownfield or greenfield](#how-mcpee-chooses-brownfield-or-greenfield)
- [Brownfield: existing code](#brownfield-existing-code)
- [Greenfield: empty project](#greenfield-empty-project)
- [Verify the installation](#verify-the-installation)
- [Scripted and CI setup](#scripted-and-ci-setup)
- [Upgrade](#upgrade)
- [What MCPEE writes in your project](#what-mcpee-writes-in-your-project)

## Requirements

| Requirement | Why |
|---|---|
| Node.js 24 or newer | Runs the CLI. Tools check their minimum compatible Node version. The official latest-LTS check is advisory: a newer patch or an unavailable release index does not block compatible installations. MCPEE never modifies the system Node runtime. |
| GitHub Copilot with an authenticated session | Needed only for approved model execution (`mcpee run` or Copilot Chat routing). |
| VS Code with Copilot Chat (recommended) | Chat uses the project MCP server automatically. The host must support MCP elicitation so MCPEE can ask for approvals. |
| Python 3.8+ with pip (first setup only) | Bootstraps the pinned project-local `uv` executable. `uv` then installs the latest stable Python under `.mcpee/tools/` for Graphify and MarkItDown. The global Python is never modified. |
| Network access during `init` | One confirmation authorizes the displayed project-local tool bundle. Optional model downloads require separate approval when explicitly requested. Normal use is local. |

Python has no official LTS designation
([Python release lifecycle](https://devguide.python.org/versions/)), which is
why MCPEE manages its own isolated Python runtime instead of requiring one.

## Install

Global installation (recommended):

```sh
npm install --global mcp-efficiency-engine@0.1.40
```

Run a pinned version without installing globally:

```sh
npx --package=mcp-efficiency-engine@0.1.40 mcpee init --project C:\path\to\project
```

The npm package is `mcp-efficiency-engine`. It installs two equivalent
commands: `mcpee` and `mcp-efficiency-engine`.

If npm reports that the Copilot SDK's native `koffi` dependency has a blocked
install script, allow only that dependency:

```sh
npm install --global mcp-efficiency-engine@0.1.40 --allow-scripts=koffi
```

This does not enable install scripts globally. A successful `mcpee help`
proves that the CLI entrypoint works, not that native SDK execution or Copilot
authentication works.

Installing the package changes nothing in your projects: it does not run
project setup, install tools or change Copilot settings. No migration from
another implementation is required.

## Initialize a project

```sh
mcpee init --project C:\path\to\project
```

`--project` defaults to the current directory. `init` is safe to repeat: it
never overwrites user-owned files. In one run it:

1. Creates the MCPEE project directories, configuration, Copilot instructions
   and the approval hook. An older MCPEE hook is replaced, or a missing
   `preToolUse` registration added, only after you approve it; other configured
   hooks are preserved.
2. Detects the project's stack and decides between **brownfield** and
   **greenfield** (see the next section).
3. Installs the full catalog locally by default for new projects: agents, skills, workflows, patterns,
   playbooks, technical guidance, scorecards, evaluation cases, prompt examples
   and templates. The selection and its evidence are recorded in
   `.mcpee/generated/project-capabilities.{json,md}`. Matching technical
   guidance is rendered as file-scoped Copilot instructions under
   `.github/instructions/`. Installation does not execute specialists or inject
   every skill into each prompt; routing selects relevant assets per task.
   Explicit `--agents` selections and existing project selections/removals
   are preserved.
4. Checks tool requirements and asks **once** to authorize the displayed
   tool bundle in `.mcpee/tools/`: MarkItDown (PDF, Word, PowerPoint
   and Excel extras), CodeGraph, Graphify and Repomix. Pinned versions are
   installed in isolated directories; your package manifest and `node_modules`
   are not touched. Use Up/Down and Enter to choose Yes or No; no typed
   approval keywords are needed. Required tools are included, not separate
   questions. Declining the bundle leaves required tools pending.
   **CodeGraph is required**: setup and routing fail closed without its package
   and index. GitNexus is never installed because its PolyForm Noncommercial
   license is not suitable for general business use. A newer Node LTS patch
   is an advisory, not a blocker. Incompatible Node versions or a missing
   npm CLI are reported before requesting installation approval.
5. Performs the first local knowledge sync: source index, unified evidence
   graph, CodeGraph index and, when installed, the Graphify AST graph. It also
   writes evidence maps to `docs/generated/`.
6. Creates brownfield specification proposals when there is source evidence.
7. Generates validation workflow specs from the checks it can find (see
   [Quality and evaluation](QUALITY-AND-EVALUATION.md#generated-validation-workflows)).
   No check is executed during setup.
8. Leaves optional semantic embeddings off by default, without another setup
   question. Opt in with `--embeddings bge-m3|light` or enable them later using
   `mcpee knowledge embeddings setup --profile bge-m3|light`.
   Each model download still requires its own approval. See
   [Knowledge and context](KNOWLEDGE.md#optional-semantic-embeddings).
9. Registers the `mcpee_run` MCP tool and the CodeGraph MCP server in the
   project `.mcp.json`, so ordinary Copilot Chat requests are routed through
   MCPEE. No VSIX and no `@mcpee` mention are needed.

The summary printed at the end reports the detected stack, provisioned
capabilities, each tool's status, sync counts, brownfield proposals, generated
validation checks and graph sizes. Read any warning: it names exactly what is
incomplete. Capability configuration is reported separately from harness
readiness. The last status is `SETUP COMPLETE` or `SETUP INCOMPLETE`; the latter
returns a nonzero exit code and tells you to resolve blockers and rerun `init`.
Existing capability selections and user-owned files are preserved on retry.

Long-running steps print an activity heartbeat to stderr every ten seconds with
the elapsed time. During `init` it is prefixed with the setup step, for example
`Step 4/5: Building CodeGraph index` (`/6` when embeddings are selected). It
shows that the command is alive, not a percentage of progress. It pauses while
a setup menu awaits your response, names the current installation or indexing
phase, and is disabled for non-terminal output, `--json` and `--chat-json`.
The terminal prompt returns as soon as the final status is printed.

## How MCPEE chooses brownfield or greenfield

You do not choose a mode. `init` scans the project (skipping VCS, dependency,
generated and build directories) and decides automatically:

| Project contains | Mode | What `init` does |
|---|---|---|
| Source-code files (for example `.cs`, `.ts`, `.js`, `.py`, `.java`, `.go`, `.vue`) or a `package.json` | **Brownfield** | Installs the full local catalog for new projects, detects the stack for task context, extracts specification proposals from the existing code and tests, and generates validation workflows from the project's checks. |
| No code files and no `package.json` (for example an empty folder or only documents) | **Greenfield** | Installs the full local catalog for new projects, without a capability preset menu or an invented stack. Use `--agents` to limit agents explicitly. Specifications start from the requirements you write. |

Supported stack signals include C#/.NET, Python, Node.js, TypeScript, Angular,
React, Vue, SQL, Cosmos DB, Azure, Bicep, AWS, Terraform and YAML pipelines.
Code in another language still counts as code (brownfield); it does not limit
which catalog assets are available locally.

The decision is not permanent. When a greenfield project gains code, run
`mcpee init` again to detect the new stack, or add assets with
`mcpee capabilities install <id>`. `mcpee explain` shows the detected stack and
selected capabilities at any time.

## Brownfield: existing code

1. **Initialize.** Run `mcpee init --project <path>` and approve the tool
   downloads. One run performs the full extraction; no extra discovery command
   is needed.
2. **Review what was detected.** Check the stack line in the summary, or run
   `mcpee explain`. Adjust the selection with `mcpee capabilities list` and
   `mcpee capabilities install|remove <id>`.
3. **Read the specification proposals.** `init` prints the review index under
   `.mcpee/specs/reviews/<snapshot>/index.md`. Proposals are grouped by
   candidate domain, cite their sources and list positive, negative and
   boundary test-case candidates. They are evidence, **not approved
   requirements**.
4. **Ratify what is correct.** After reviewing a proposal, approve its exact
   content:

   ```sh
   mcpee specs ratify --slug <id> --reviewer <name> --confirm-sha256 <digest>
   ```

   The approved specification is written under `specs/approved/` and is
   included in every later Copilot request. See
   [Brownfield specification discovery](BROWNFIELD-SPECS.md).
5. **Check validation.** Review the generated specs under `.mcpee/workflows/`.
   If `init` reported that no supported check was found, add one (see
   [Quality and evaluation](QUALITY-AND-EVALUATION.md)); otherwise MCPEE cannot
   validate changes or refresh generated documentation.
6. **Work in Copilot Chat** as usual. See [Daily use](#daily-use).

## Greenfield: empty project

An empty project has no behavior to reverse-engineer, so MCPEE never invents
business intent. Requirements come first:

1. **Initialize.** Run `mcpee init --project <path>`. The full catalog is
   available locally; in an interactive terminal, authorize the displayed tool
   bundle once. Use `--agents <id,...|all|none>` for a narrower agent selection.
2. **Provide requirements** as project documents, for example Markdown files
   under `knowledge/sources/business/`, or Office/PDF sources supported by the
   configured local converter. No project-specific names or templates are
   required. Missing rules remain questions, not invented requirements.
3. **Synchronize and draft.** Run `mcpee sync --project <path>`, then ask
   Copilot: "Draft functional specifications from `docs/requirements.md`;
   do not implement yet." The executor produces actors, concrete use cases,
   flows, alternatives, rules, acceptance criteria and open decisions.
   MCPEE validates structure, source quotes and declared section coverage,
   then saves a human-readable product index and one independent specification
   per use case under `specs/<feature>/`. Open `specs/README.md` as the single
   entry point. Each case includes one goal,
   actor, trigger, preconditions, main flow, alternatives, postconditions,
   rules, Given/When/Then criteria, source references, prerequisite cases and
   its unresolved decisions.
   An empty template, an inventory or an unsupported citation fails the run.
   To process all product documentation, ask "Run the greenfield process using
   the project documentation; stop at atomic use-case specifications."
   Retrieval does not silently stop at five files; unprocessed documents or
   limits (100 documents / 2 MiB source text) block before paid execution.
   A documentation-only run does not require querying an application code graph.
4. **Clarify and approve.** `mcpee specs status --slug <feature>` shows pending
   decisions, drift and the review digest. Record owner decisions with
   `mcpee specs decide --slug <feature> --id Q-001 --answer "<decision>" --reviewer "<owner>"`.
   Review the specification and every case, then use
   `mcpee specs approve --slug <feature> --stage specification --reviewer "<owner>" --confirm-sha256 <digest>`.
   Open decisions and deferred requirements block approval; explicit
   out-of-scope sections remain visible. Draft creation never approves requirements.
5. **Plan and decompose.** Author `specs/<feature>/plan.md` against the approved
   specification and case IDs; `mcpee plan init --slug <feature> --title "<title>"`
   can create an explicitly unreviewed template without replacing the spec.
   Review it using `specs approve --stage plan`, then author dependency-ordered,
   checkable `tasks.md` linked to `spec.md`, `plan.md` and case IDs, and review
   using `--stage tasks`. These are explicit, persistent phases; not an
   assertion that independent specialist agents ran. Routed requests recheck
   the prerequisite approval before spending model quota.
6. **Implement the first slice and its tests** through Copilot Chat, approving
   each change.
7. **Add validation.** As soon as the project has a test, lint or build script,
   run `mcpee init` again: it detects the stack, adds matching guidance and
   generates the validation workflow. Until a workflow exists, post-change
   validation and documentation refresh stay blocked.
8. **Keep it current** with `mcpee sync` after changes. Implementation
   evidence is discovered automatically; approved requirements remain
   untouched.

MCPEE-only package metadata, configuration and generated instructions do not
count as application code or product evidence. Old scaffolding-only proposals
remain archived for provenance; synchronization excludes them from new reviews.

## Daily use

Open the project in VS Code and use Copilot Chat normally. The generated
instructions route engineering requests to the project `mcpee_run` MCP tool.
VS Code may ask once to trust the workspace or start the MCP server.

Before the first request, run **Chat: Open Customizations**, select the active
Copilot harness and open **MCP Servers**. Enable both `mcpee` and
`mcpee-codegraph` for the intended project/workspace where that scope is
available. A previous global disablement can apply to a newly initialized
project. Starting a server from `.mcp.json` does not clear that preference.
This is a first-use check, not a command to repeat for every request.

After upgrading MCPEE and running `mcpee update`, cancel a previously stalled
turn and start a fresh chat so it uses the refreshed integration. Attach or
reference the requirements again. Do not send duplicate requests while an
earlier run is still executing.

For each request MCPEE selects a workflow and specialist, retrieves cited local
evidence and shows the impact of the files involved. Calling `mcpee_run`
authorizes its selected context to the authenticated Copilot runtime and local
post-task index sync. The generated hook automatically allows MCPEE task,
status and cancellation calls; repeated status checks do not ask for approval.
Ordinary task-scoped local edits are also covered by the requested task.
Destructive actions, installations, deployment, other external transfers,
sensitive runtime permissions and non-read-only validation still require
explicit approval. Direct CLI execution still asks before context transfer.
Workspace trust, server enablement and the host's own confirmation policy
are separate: enable the generated approval hook, or use the host's
tool-specific “always allow” for the three MCPEE tools, not global autoapproval.

Generated documentation is refreshed only when validation passes. Details are
in [Copilot execution and approvals](COPILOT-EXECUTION.md).

After editing documents or code outside a Copilot run, refresh the local
knowledge (several edits can share one sync):

```sh
mcpee sync --project C:\path\to\project
```

## Verify the installation

```sh
mcpee doctor --project C:\path\to\project
mcpee status --project C:\path\to\project
mcpee explain --project C:\path\to\project
```

`doctor` validates required artifacts and indexes, `status` shows installation,
source and telemetry state, and `explain` describes the catalog, tools,
knowledge state, approval hook and known capability gaps. If something fails,
see [Troubleshooting](TROUBLESHOOTING.md).

Then verify the actual chat path: submit a scoped task and check that Copilot
calls the project `mcpee_run` tool. Review any approval for nested risky actions. A
long-running call can return a run ID; subsequent checks must use
`mcpee_run_status` for that same ID, not start the task again. Installed agents,
a loaded skill, a connected MCP transport and a "Thinking" indicator are not
proof that the task completed.

The generated `.mcpee/generated/project-capabilities.json` lists exactly which
agents, skills and workflows were provisioned. New projects get the full local
catalog unless agents were explicitly limited. Existing installations retain
their selections; use `mcpee capabilities install all --project <path>` to
expand one after maintenance approval. Installed availability is not task
execution: each task selects its specialist and relevant supporting assets.

## Scripted and CI setup

Non-interactive `init` never guesses and never downloads without approval:

| Option | Effect |
|---|---|
| `--agents <id,...\|all\|none>` | Choose specialist agents and their dependencies explicitly; the core `orchestrator` is always installed. Omit this option for the full local catalog in new projects. `all` selects all agents, not independent catalog assets. |
| `--embeddings none\|light\|bge-m3` | Choose embeddings explicitly. Default in all terminals: `none`. |
| `--skip-tool-install` | Use already installed tools. Without it, non-interactive tool installation is denied. Mandatory readiness checks (such as CodeGraph) still apply. |

Example:

```sh
mcpee init --project C:\path\to\project --agents all --embeddings none --skip-tool-install
```

Available agent IDs: `orchestrator`, `business`, `product`, `architecture`,
`frontend`, `backend`, `data`, `ai`, `database`, `qa`, `security`, `devops`,
`infrastructure`, `ux-ui`, `documentation`, `observability`, `legacy`,
`architect-challenger`, `technical-debt-assessor`, `technical-due-diligence`
and `performance-forensics`. Their skills, workflows and patterns are included
as dependencies.

## Upgrade

1. Install the new package version globally (see [Install](#install)).
2. In each project run `mcpee update --project <path>`. It refreshes the
   project integration and rendered catalog from the installed package after
   approval; it does not download npm packages or install tools.
3. Restart the project's MCP server in VS Code.

Run `mcpee init` again instead when you want to retry failed tool
installations or re-detect a changed stack. `mcpee capabilities update`
refreshes all installed catalog assets. User-owned files are always preserved.
Neither operation silently expands existing selections. To install the full
catalog locally, run `mcpee capabilities install all --project <path>` and
approve the maintenance request. An optional `--type agents|skills|workflows`
limits the requested type (dependencies are included); see [Catalog](CATALOG.md#manage-capabilities).
No agents, workflows, tool downloads or model calls are executed by this command.

## What MCPEE writes in your project

| Path | Content |
|---|---|
| `mcpee.config.yml` | Project configuration, including `knowledge.sourceRoots` |
| `.mcpee/` | Runtime, state, tools, indexes, graphs, reports, telemetry, memory, workflow specs and specification proposals. Its own `.mcpee/.gitignore` excludes the cache, tools, indexes, graphs, specs, reports, telemetry and logs. |
| `.codegraph/` | Required local CodeGraph symbol index |
| `.github/agents/`, `.github/skills/` | Rendered agent profiles, skill procedures and workflow skills (`/mcpee-<workflow>`, explicit invocation only; works in the Local and Copilot harnesses) |
| `.github/instructions/` | Always-on policies and file-scoped technical guidance |
| `.github/hooks/` | Approval and observability hook registration |
| `.mcp.json` | Project MCP servers (`mcpee`, `mcpee-codegraph`); existing entries are preserved |
| `knowledge/` | Optional extra source folders by category plus normalized, extracted and traceability artifacts |
| `docs/generated/` | Source-linked evidence maps refreshed by `sync` |
| `specs/README.md` | Single human entry point: features, status, next step and links to sources/maps/history |
| `specs/<feature>/` | Functional `spec.md`, `UC-###.md`, decisions and reviews; technical `plan.md` and `tasks.md` in the same workspace |
| `docs/specifications/`, `specs/approved/`, `.mcpee/planning/` | Historical drafts/approvals/plans, preserved for compatibility; `specs migrate` safely copies supported drafts without approving them |

Existing user files at generated paths are never overwritten. Stale generated
files are removed only when MCPEE's manifest and ownership marker prove that it
created them.
If `specs/README.md` already has owner content, navigation uses `specs/MCPEE.md`
and the CLI prints that path instead.
