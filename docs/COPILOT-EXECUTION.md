# Copilot execution and approvals

Ordinary project-local file creation and edits that directly implement the
user's task are authorized by that task; the executor must not request approval
for each generated document or code file. New files do not require indexed
impact evidence. Impact analysis informs changes to existing project files but
an unavailable or partial index is not, by itself, a risk finding or a reason
to block work. Explicit approval remains required for destructive actions,
dependency changes, sensitive or operational configuration, broad architectural
rewrites or migrations, permission changes, deployment, publication, and
external data transfer.

How MCPEE routes a request, what it sends to GitHub Copilot, which actions
require your approval, and what happens after a change. Start with the
[README](../README.md) if MCPEE is not installed yet.

- [From Copilot Chat](#from-copilot-chat)
- [From the terminal](#from-the-terminal)
- [Request lifecycle](#request-lifecycle)
- [Context sent to Copilot](#context-sent-to-copilot)
- [Approvals and hooks](#approvals-and-hooks)
- [After a change: sync, validation and documentation](#after-a-change-sync-validation-and-documentation)
- [Timeouts and long runs](#timeouts-and-long-runs)
- [Planning without execution](#planning-without-execution)

## From Copilot Chat

`mcpee init` registers a project-scoped `mcpee_run` MCP tool and generates
always-on Copilot instructions that route project engineering requests from
ordinary Copilot Chat through MCPEE. No VSIX and no `@mcpee` invocation are
needed. VS Code starts the MCP server automatically when Chat needs its tools
and may ask once to trust the workspace or start the server.

The server uses MCP elicitation for explicit approval before context transfer
and before each state-changing action. It fails closed when the host cannot
show that approval UI. An explicit host acceptance authorizes the requested
action even if the host omits the redundant form value; decline and cancel
remain denials. Workspace trust and normal Copilot tool confirmations remain
in effect.

MCPEE adds its own stdio server and the CodeGraph server to the portable
workspace `.mcp.json` read directly by Copilot harness sessions, without
running CodeGraph's global agent installer or changing user-level settings.
Existing MCP entries are preserved. Invalid configuration, or conflicting
`mcpee-codegraph` or `mcpee` entries, are reported rather than overwritten.
Host-normalized entries (`type: "stdio"`, equivalent absolute paths, host
tool-selection metadata) are accepted without rewriting. Different commands,
arguments or environment values still require you to resolve the conflict.
Projects that still have these servers in `.vscode/mcp.json` should run VS
Code's MCP migration once.

The MCPEE server uses the package location recorded by `mcpee init`; it does
not download or install packages when Chat starts. The internal Copilot
executor uses built-in tools after routing; the instruction to invoke
`mcpee_run` applies only to the outer chat, not recursively to that executor.

## From the terminal

```sh
mcpee run --task "Add validation to the invoice endpoint" --project C:\path\to\project
```

`mcpee run` executes a routed request through the official
`@github/copilot-sdk` runtime for the Copilot CLI agent. Direct terminal runs
use an interactive terminal prompt for approvals. Options:

| Option | Effect |
|---|---|
| `--model <id>` | Choose the Copilot model. |
| `--context-tokens <128..32000>` | Approximate token budget for grounded context (default 4,000). |
| `--ground-context` | Default: retrieve a compact, cited evidence pack. |
| `--no-ground-context` | Send no retrieved context. |
| `--pack-context` | Package routing evidence with the local Repomix instead. |

## Request lifecycle

1. **Route.** MCPEE selects a workflow and specialist using workflow and
   specialist rules, current memory, indexed source evidence and available
   tools. Routing is deterministic. Explicitly named, already indexed
   project-relative paths are prioritized ahead of lexical matches; tasks
   naming more than ten indexed files must be narrowed. Naming a path does not
   authorize a mutation or bypass checksum and approval checks.
2. **Impact preflight.** MCPEE shows the direct and transitive dependents of
   the routed evidence. If the preflight is unavailable, state-changing tool
   calls are denied.
3. **Context approval.** You approve sending the task and selected context to
   Copilot. That approval covers only this transfer.
4. **Execution.** The selected workflow's ordered lifecycle stages are passed
   to Copilot, which must report incomplete stages. Each state-changing tool
   call is checked against its exact target and a fresh source checksum and
   then requires your approval.
5. **Post-change maintenance.** See
   [After a change](#after-a-change-sync-validation-and-documentation).
6. **Lifecycle report.** An eight-stage report is written under
   `.mcpee/reports/runs/`. Stage status is derived from local routing, impact,
   session, validation, documentation and telemetry evidence, never from
   Copilot's self-reported checklist.

Approved specifications from `specs/approved/` are included before the
transfer approval in every context mode.

## Context sent to Copilot

- **Grounded context (default).** A compact set of original local excerpts
  selected with hybrid semantic/lexical retrieval when fresh embeddings exist,
  otherwise lexical retrieval. Each excerpt keeps its project-relative path and
  normalized line range. No model summarizes or rewrites the excerpts; the
  budget is an approximate character-based token estimate.
- **Packed context (`--pack-context`).** Repomix packages only current routing
  evidence (indexed sources, CodeGraph symbol files and current memory
  evidence). Out-of-project paths, symbolic links and sensitive paths are
  rejected; MCPEE's safe Repomix configuration keeps secret scanning enabled
  and enforces a 2 MiB limit. The confirmation lists the selected files and
  package size. Without an interactive terminal or approval broker, the
  transfer is denied.

See [Knowledge and context](KNOWLEDGE.md) for how evidence is indexed and
retrieved.

## Approvals and hooks

| Action | Approval |
|---|---|
| Sending task and context to Copilot | Required, once per transfer |
| File edits and other state-changing tool calls | Required, per call, with a fresh checksum |
| Runtime permissions requested by the SDK | Required |
| Post-change sync of indexes and graphs | Required |
| Non-read-only validation steps | Required, per step |
| Built-in `view`, `glob`, `grep` and `rg` | Not required (read-only) |
| Unknown tools | Required |

In VS Code, approval comes from Chat's host UI through a short-lived,
token-authenticated loopback broker. In the terminal, it comes from the
interactive prompt. Approval events record decision metadata; SDK and hook
events can contain redacted tool arguments and results (see
[Observability](OBSERVABILITY.md)).

The project `preToolUse` hook allows only recognized read-only tools and
commands. Other calls return `ask` in interactive CLI sessions and `deny` in
known non-interactive or CI sessions. The hook accepts Copilot and VS Code
Local harness input and emits both decision formats. Besides the read-only
search tools, the exact PowerShell listing forms `Get-ChildItem`, optionally
with `-Force` and `| Select-Object Name,Mode` (optionally `,Length`), are
treated as read-only; arbitrary paths, expressions, redirection and additional
commands are not.

In VS Code, the hook applies only when the Local harness, a trusted workspace
and hooks are enabled; VS Code documents hooks as Preview. Tool names vary by
harness, so keep the host's native permission controls enabled.

The hook gates tool calls; it does not enforce naming, formatting, analyzers or
test outcomes. Those become deterministic only when the project configures and
runs its own formatter, analyzers and tests. Generated policy instructions are
guidance, not a substitute for those controls.

## After a change: sync, validation and documentation

If Copilot changes files, MCPEE:

1. asks separately to refresh source indexes and both graphs;
2. runs the declared validation spec
   `.mcpee/workflows/<routed-workflow-id>.json`, asking for each non-read-only
   step;
3. refreshes generated documentation only if that workflow passes.

If the spec is missing or validation fails, MCPEE reports the incomplete state
and leaves generated documentation untouched. Failed or blocked checks create
approval-gated follow-up tasks (see
[Quality and evaluation](QUALITY-AND-EVALUATION.md#follow-up-tasks-and-learning)).

If the Copilot session fails after an approved file mutation, the failure event
retains the changed project-relative paths and MCPEE still offers the normal
sync and validation before reporting the run as failed.

## Timeouts and long runs

- The executor allows ten minutes of active execution for the full
  tool-and-response loop instead of the SDK's one-minute default. Time spent
  inside human approval callbacks is excluded; overlapping waits pause the
  budget only once. A separate thirty-minute total deadline includes all
  approval waits. When a limit expires, MCPEE requests cancellation and reports
  failure. A timeout is never evidence of a completed inspection.
- Each approval request expires after ten minutes. Denial or expiry never
  authorizes an action.
- MCP calls wait at most 20 seconds before returning `status: "running"` and a
  `run_id`. The chat agent retrieves the same run with the read-only
  `mcpee_run_status({run_id: "..."})` tool until the final response arrives,
  instead of starting the task again or repeatedly approving a mutating tool.
  `mcpee_run({run_id: "...", cancel: true})` cancels the run and pending
  approvals. Runs are held by the local MCP server; after a restart an unknown
  ID is reported, not replayed.
- Each routing plan includes the project stack detected from manifests and
  source files, plus code languages without a matching catalog guide. The
  executor performs one focused discovery pass, uses an installed specialist
  where available, and consults current official documentation for uncovered
  technology. If that lookup is unavailable, it must name the exact guidance
  gap and ask a focused question instead of guessing or repeating exploration.

See [Troubleshooting](TROUBLESHOOTING.md#approval-waits-fail-before-a-decision-is-returned)
for approval wait failures.

## Planning without execution

| Command | Result |
|---|---|
| `mcpee route --task "..."` | Inspectable local plan. Plan-only: it does not invoke Copilot or run the workflow. |
| `mcpee explain --task "..."` | Selected workflow, specialist, skills, patterns, playbooks, technical guidance, scorecards, evaluation cases, prompt examples, available tools and each policy's enforcement mode. |
| `mcpee explain` | Installed catalog, tool availability, knowledge state, approval hook status, execution flow and known capability gaps. |
| `mcpee plan init --slug <id> --title <title>` | Draft specification and delivery plan under `.mcpee/planning/<id>/`. |

Assets are selected by task keywords. Technical instructions also consider
explicitly named indexed paths; when no guide is identified, the installed
stack guides remain available with applicability metadata. The migration
playbook activates for migration and modernization requests; it does not
authorize execution.
