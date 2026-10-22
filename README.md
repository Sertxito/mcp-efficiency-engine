# MCPEE — local-first engineering harness for GitHub Copilot

MCPEE turns any repository into a governed workspace for GitHub Copilot.
One command gives Copilot a specialist team, project-specific instructions,
local knowledge of your code and documents, approval gates for every risky
action, automatic validation after changes and a full local audit trail.

- **Works with what you have.** Existing codebase or empty folder: MCPEE
  detects which one it is and configures itself. There is no mode to choose.
- **Local-first.** Indexes, graphs, memory and telemetry stay in your project.
  Context is sent to Copilot only after you approve it.
- **Nothing silent.** Every download, transfer and state-changing action asks
  first. Existing user files are never overwritten.

npm package: **`mcp-efficiency-engine`** · commands: `mcpee` (or
`mcp-efficiency-engine`) · license: MIT · status: pre-1.0 (0.1.26)

## Requirements

- **Node.js 24 or newer.** A complete tool install also needs the latest
  Node.js LTS patch; `init` tells you if an update is required.
- **GitHub Copilot** with an authenticated session.
- **VS Code with Copilot Chat** (recommended).
- **Python 3.8+ with pip**, only on first setup, to bootstrap MCPEE's private
  Python runtime. Your global Python is never modified.

Full details: [Getting started → Requirements](docs/GETTING-STARTED.md#requirements).

## Quick start

**1. Install**

```sh
npm install --global mcp-efficiency-engine@0.1.26
```

If npm blocks the native `koffi` dependency, add `--allow-scripts=koffi`
(only that dependency is allowed). Prefer no global install? Use
`npx --package=mcp-efficiency-engine@0.1.26 mcpee init --project <path>`.

**2. Initialize your project**

```sh
mcpee init --project C:\path\to\project
```

Approve the tool downloads when asked (CodeGraph is required; the others are
optional). The summary at the end shows the detected stack, the installed
capabilities and anything still incomplete.

**3. Work in Copilot Chat**

Open the project in VS Code and ask Copilot Chat as usual, for example
*"Add input validation to the orders endpoint"*. MCPEE routes the request,
asks before sending context, asks before each change, then offers to sync,
validate and refresh documentation.

**4. Keep knowledge current**

```sh
mcpee sync
```

Run it after editing code or documents outside Copilot.

## Existing code or empty project: automatic

`mcpee init` inspects the project and chooses the path itself:

| Your project | MCPEE treats it as | What you get |
|---|---|---|
| Has source code or a `package.json` | **Brownfield** | Agents and guides for your detected stack, specification proposals extracted from your code and tests, and validation workflows built from your existing checks. |
| Has no code yet | **Greenfield** | A general-purpose team (orchestrator, product, architecture, QA, security, AI, documentation). Interactive setup lets you accept it or pick other agents. Specifications start from the requirements you write. |

**Brownfield next steps:** review the detected stack (`mcpee explain`), read
the specification proposals, ratify the ones that are correct
(`mcpee specs ratify`) and check that a validation workflow exists for your
stack (`mcpee quality`).

**Greenfield next steps:** write requirements in a project document, run
`mcpee sync`, review and ratify the proposal, implement with Copilot, add a
test script, and re-run `mcpee init` once code exists so MCPEE detects the new
stack and generates validation.

Step-by-step guide for both paths: [Getting started](docs/GETTING-STARTED.md).

## What makes the harness solid

| Layer | What MCPEE does | Guide |
|---|---|---|
| Context | Indexes code and documents locally, builds code and evidence graphs, and sends Copilot only cited excerpts. | [Knowledge](docs/KNOWLEDGE.md) |
| Specialists | Installs role agents, skills, workflows and stack-specific instructions selected from your project. | [Catalog](docs/CATALOG.md) |
| Specifications | Extracts behavior proposals from existing code, or starts from your requirements, and keeps approved specs under `specs/approved/`. | [Specifications](docs/BROWNFIELD-SPECS.md) |
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
