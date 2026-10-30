# MCPEE — local-first engineering harness for GitHub Copilot

MCPEE turns any repository into a governed workspace for GitHub Copilot.
One command gives Copilot a specialist team, project-specific instructions,
local knowledge of your code and documents, approval gates for every risky
action, automatic validation after changes and a full local audit trail.

- **Works with what you have.** Existing codebase or empty folder: MCPEE
  detects which one it is and configures itself. There is no mode to choose.
- **Local-first.** Indexes, graphs, memory and telemetry stay in your project.
  Context is sent to Copilot only after you approve it.
- **Approvals where they matter.** Context transfer and risky actions require
  approval; ordinary task-scoped project edits do not prompt per file.
  Existing user files are never overwritten.

npm package: **`mcp-efficiency-engine`** · commands: `mcpee` (or
`mcp-efficiency-engine`) · license: MIT · status: pre-1.0 (0.1.39)

## Requirements

- **Node.js 24 or newer.** The latest LTS is recommended, not required.
  `init` checks tool compatibility; a newer patch does not block setup.
- **GitHub Copilot** with an authenticated session.
- **VS Code with Copilot Chat** (recommended).
- **Python 3.8+ with pip**, only on first setup, to bootstrap MCPEE's private
  Python runtime. Your global Python is never modified.

Full details: [Getting started → Requirements](docs/GETTING-STARTED.md#requirements).

## Quick start

**1. Install**

```sh
npm install --global mcp-efficiency-engine@0.1.39
```

If npm blocks the native `koffi` dependency, add `--allow-scripts=koffi`
(only that dependency is allowed). Prefer no global install? Use
`npx --package=mcp-efficiency-engine@0.1.39 mcpee init --project <path>`.

**2. Initialize your project**

```sh
mcpee init --project C:\path\to\project
```

Approve the tool downloads when asked (CodeGraph is required; the others are
optional). The summary at the end shows the detected stack, the installed
capabilities and anything still incomplete.

**3. Work in Copilot Chat**

Before the first request, run **Chat: Open Customizations** in VS Code, select
the active Copilot harness and open **MCP Servers**. Enable `mcpee` and
`mcpee-codegraph` for the project and accept any trust prompts. Enablement is
separate from starting a server in `.mcp.json`; a previous global disablement
can keep an installed server unavailable. This is a setup check, not a step
to repeat before every request.

Open the project in VS Code and ask Copilot Chat as usual, for example
*"Add input validation to the orders endpoint"*. MCPEE routes the request,
asks before sending context, asks before each change, then offers to sync,
validate and refresh documentation.

Verify that the chat actually calls `mcpee_run` and receives a result or run ID.
Installed agents, a loaded skill or a "Thinking" indicator alone do not prove
the harness executed. See [first-use verification](docs/GETTING-STARTED.md#verify-the-installation).

**4. Keep knowledge current**

```sh
mcpee sync
```

Run it after editing code or documents outside Copilot.

## Existing code or empty project: automatic

`mcpee init` inspects the project and chooses the path itself:

| Your project | MCPEE treats it as | What you get |
|---|---|---|
| Has source code or an application `package.json` | **Brownfield** | Full local catalog, task-selected stack guidance, static evidence inventories and validation workflows built from existing checks. |
| Has no code yet | **Greenfield** | Full local catalog, with relevant specialists selected per task rather than every asset added to the prompt. Specifications start from your product sources; `--agents` can explicitly narrow installation. |

Installing MCPEE as the only dependency does not make an empty project brownfield.
Its configuration and generated instructions are not product evidence.

**Functional specifications:** ask Copilot to **"Draft functional specifications
from `<requirements document or application source paths>`; do not implement
yet."** The internal executor must deliver concrete actors, use cases, flows,
alternatives, business rules and acceptance criteria. MCPEE checks the structure,
exact source quotes and declared section coverage, then saves a readable draft
index and **one self-contained document per use case** under
`specs/<feature>/`. Start at **`specs/README.md`** rather than internal folders.
Each case states one actor goal, flows, rules, acceptance
criteria, source citations, prerequisite cases and unresolved decisions.
Empty templates do not count as success. These
checks do not certify semantic correctness or replace owner review.

**Brownfield next steps:** review the detected stack (`mcpee explain`), use the
evidence inventory to draft and review functional behavior in the same canonical
workspace (`mcpee specs status` / `specs approve`). `specs ratify` remains
available for historical static proposals; it is not an extra greenfield gate.
Check that a validation workflow
exists for your stack (`mcpee quality`).

**Greenfield next steps (any project, not a project-specific preset):** provide
product documents, run `mcpee sync`, and ask "Run the greenfield process using
the project documentation; stop at atomic use-case specifications, do not
implement." Without named source paths, all indexed product documents are
selected, not just keyword search matches. Missing conversion or exceeded
input limits block the request explicitly rather than dropping requirements.
Then use `mcpee specs status` to clarify decisions and explicitly approve the
specification, technical plan and tasks in order. All live together under
`specs/<feature>/`; old discovery proposals remain evidence, not a second
greenfield approval workflow. Implement with Copilot, add a
test script, and re-run `mcpee init` once code exists so MCPEE detects the new
stack and generates validation.

Step-by-step guide for both paths: [Getting started](docs/GETTING-STARTED.md).

## What makes the harness solid

| Layer | What MCPEE does | Guide |
|---|---|---|
| Context | Indexes code and documents locally, builds code and evidence graphs, and sends Copilot only cited excerpts. | [Knowledge](docs/KNOWLEDGE.md) |
| Specialists | Installs role agents, skills, workflows and stack-specific instructions selected from your project. | [Catalog](docs/CATALOG.md) |
| Specifications | One `specs/README.md` entry point, feature specifications/cases/decisions/plans/tasks together, explicit review gates; historical evidence and approvals preserved. | [Specifications](docs/BROWNFIELD-SPECS.md) |
| Permissions | Read-only tools run freely. Context transfer and every state-changing action need explicit approval, enforced by an MCP approval broker and a `preToolUse` hook. | [Copilot execution](docs/COPILOT-EXECUTION.md) |
| Verification | After a change, MCPEE syncs knowledge, runs your declared validation workflow and refreshes documentation only if it passes. | [Quality](docs/QUALITY-AND-EVALUATION.md) |
| Evidence | Records traces, approvals and outcomes locally, with JSON, OTLP and HTML review views. | [Observability](docs/OBSERVABILITY.md) |

## Everyday commands

| Goal | Command |
|---|---|
| Check the installation | `mcpee doctor` · `mcpee status` |
| See detected stack and capabilities | `mcpee explain` |
| Refresh knowledge after edits | `mcpee sync` |
| Search project knowledge | `mcpee knowledge search --query "..."` |
| See what a change would affect | `mcpee impact --path src/file.ts` |
| Run a task from the terminal | `mcpee run --task "..."` |
| Review specifications | `mcpee specs list` · `mcpee specs drift` |
| Check validation gates | `mcpee quality` |
| Review what happened | `mcpee view --html .mcpee/reports/evidence-view.html` |

All commands: [Command reference](docs/COMMANDS.md).

## Upgrade

```sh
npm install --global mcp-efficiency-engine@<new-version>
mcpee update --project C:\path\to\project
```

Then restart the MCPEE MCP server in VS Code (or reload the window). `update`
refreshes the project integration and catalog without touching your own files.
Details: [Getting started → Upgrade](docs/GETTING-STARTED.md#upgrade).

## Documentation

| Guide | Read it when you want to… |
|---|---|
| [Getting started](docs/GETTING-STARTED.md) | Install, initialize and take the first steps in a brownfield or greenfield project. |
| [Copilot execution and approvals](docs/COPILOT-EXECUTION.md) | Understand Chat routing, `mcpee run`, approvals, hooks and timeouts. |
| [Knowledge and context](docs/KNOWLEDGE.md) | Configure sync, search, embeddings, graphs, impact, drift and memory. |
| [Specification discovery](docs/BROWNFIELD-SPECS.md) | Review, ratify and track specifications. |
| [Quality and evaluation](docs/QUALITY-AND-EVALUATION.md) | Set up validation workflows, quality gates, evaluations, tasks and learning. |
| [Observability and evidence](docs/OBSERVABILITY.md) | Inspect traces, usage, retention and HTML review views. |
| [Catalog, capabilities and tools](docs/CATALOG.md) | Manage agents, skills, guides, policies, templates and local tools. |
| [Command reference](docs/COMMANDS.md) | Look up every command and option. |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Fix setup, approval, Python, indexing or Unicode problems. |
| [Specialist acceptance](docs/SPECIALIST-ACCEPTANCE.md) | Evaluate specialist roles and technical guides. |
| [Boost capability coverage](docs/BOOST-CAPABILITY-COVERAGE.md) | See which recovered capabilities are covered or excluded. |
| [Architecture](docs/ARCHITECTURE.md) | Understand the target product architecture (Spanish). |
| [Development](docs/DEVELOPMENT.md) | Contribute to MCPEE and learn the release acceptance boundaries. |
| [Releasing](docs/RELEASING.md) | Publish a new npm version. |

## License

[MIT](LICENSE)
