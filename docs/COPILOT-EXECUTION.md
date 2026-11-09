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

Calling `mcpee_run` authorizes the task's selected project context to the
authenticated GitHub Copilot runtime and ordinary post-task local index sync.
MCPEE does not ask again for these internal steps. Its generated hook also
allows the exact task, status and cancellation tools without repeated prompts;
polling an existing run never starts another execution or requests approval.
This is not a blanket grant to the nested agent. Actions outside task-scoped
local edits still use MCP elicitation and fail closed if the host cannot show
the approval UI. Decline and cancel remain denials.

VS Code shows an MCP elicitation inside the chat only while a tool call of the
same server is open; otherwise it falls back to an easily missed notification.
MCPEE therefore sends an approval only while an `mcpee_run` or
`mcpee_run_status` call is open (waiting up to 60 seconds for the next status
poll, then sending it anyway), links it to that call, and keeps the call open
until the decision instead of returning `running`. A `running` response with a
pending approval has `poll_after_ms: 0`. `mcp.approval.requested` records
`host_tool_call_open`.

Run status persists execution activity (`starting`, `thinking`, `tool-running`,
`tool-completed`, `tool-failed`) and approval activity (`waiting-approval`,
`approval-approved`, `approval-denied`, `approval-error`) with timestamps.
An idle progress timestamp is not proof of a hung process. Approval requests
may wait up to ten minutes; request, result and channel errors are traced
separately. A channel error or timeout aborts the current SDK execution without
retrying it. SDK `policy-approved` hook permissions only delegate to MCPEE's
action hook; they do not mean the underlying command was authorized or passed.
MCP connection state `Running` is distinct from the task's persisted result.

Approval status includes the request ID and tool so a completed workflow-launch
approval is not confused with another pending request. Reading existing shell
output with `read_powershell` does not require another execution approval; sending
input, stopping a process and launching/repeating commands remain gated.

Workspace trust, MCP server enablement and the host's own tool-confirmation
policy remain in effect. MCPEE cannot override host-level confirmations:
enable the generated approval hook in hosts that support it, or use the
host's tool-specific “always allow” control for these three MCPEE tools only.
Do not enable global autoapproval to solve internal polling prompts.

MCPEE always registers its stdio server, including for documentation-only
Greenfield projects; CodeGraph is added only when application code and its
project-local tool are available. By default, the portable workspace
`.mcp.json` is used for Copilot harness sessions. `mcpee init --mcp-config
vscode` selects VS Code's `.vscode/mcp.json` format; `auto` reuses the sole
existing project MCP config and otherwise chooses portable format. Existing
MCP entries are preserved. If both files already contain MCPEE servers, or an
owned server name has a different command, arguments or environment, setup
stops rather than overwriting the entry or starting duplicates. Host-normalized
entries (`type: "stdio"`, equivalent absolute paths, host tool-selection
metadata) are accepted without rewriting.

The MCPEE server uses the package location recorded by `mcpee init`; it does
not download or install packages when Chat starts. The internal Copilot
executor uses built-in tools after routing; the instruction to invoke
`mcpee_run` applies only to the outer chat, not recursively to that executor.

## From the terminal

```sh
mcpee run --task "Add validation to the invoice endpoint" --project C:\path\to\project
```

`mcpee run` executes a routed request through the official
`@github/copilot-sdk` runtime for the Copilot CLI agent. The published package
bundles the pinned upstream JavaScript with its required JSON-RPC code, includes
third-party notices and build provenance, and avoids installing the SDK's
vulnerable Zod dependency. Native runtime assets remain npm-selected for the
consumer's operating system and architecture. Direct terminal runs
use an interactive terminal prompt for approvals. Options:

| Option | Effect |
|---|---|
| `--model <id>` | Choose the Copilot model. |
| `--context-tokens <128..32000>` | Approximate token budget for grounded context (default 4,000). |
| `--ground-context` | Default: retrieve a compact, cited evidence pack. |
| `--no-ground-context` | Send no retrieved context. |
| `--pack-context` | Package routing evidence with the local Repomix instead. |
| `--resume-session <uuid>` | Explicitly resume an interrupted SDK conversation for the same task, after the prior executor has exited. |

An interrupted run prints its SDK session UUID. Recovery is an explicit new
command, not automatic: repeat the exact original `--task` and the same model
and context options. MCPEE re-routes and re-authorizes context transfer, then
checks the task, selected route and model against the local journal before
calling `resumeSession`. Structured authoring resumes (specification, plan,
tasks) also require the complete prompt/context fingerprint, because the
structured contract is resent. Other resumes send only the original task and
last failure to the existing session; the regenerated context normally differs
after a partial run (for example, the graph now includes the files the session
wrote), so the drift is recorded as `copilot.session.resume.context_drift`
instead of blocking. A task, route or model mismatch, a live
owner, a completed session, or an active recovery lock stops the operation.
Canonical implementation resumes repeat the instruction that MCPEE, not the
agent, runs `mcpee workflow run` and `mcpee sync`.
The resumed SDK session does not continue pending tool calls automatically;
MCPEE reinstalls the current hooks and permissions and asks Copilot to inspect
the current project state before continuing. Local files can be inspected, so
their state is not ambiguous; only uncertain external or irreversible effects
make the session stop for manual inspection rather than repeat them. An
unknown outcome of an MCPEE-owned verification or sync run is not ambiguity.
Resumption cannot establish whether an earlier external side effect succeeded;
inspect that system before authorizing a retry.

In MCP, explicitly call `mcpee_run` with `resume_session_id` and the exact
original `task`, without `feature` or `through`. The host launches the resumed
CLI directly with its authenticated approval broker and task-context
authorization; it does not start a fresh agent to run a nested recovery command.
Malformed IDs, changed tasks, completed sessions and live owners fail before
run admission or child execution. The SDK still enforces its original route,
model, structured-authoring prompt and recovery-lock guards; a mismatch never
falls back to a new session. If resumption is rejected before an SDK session
starts, MCPEE does not run post-change synchronization for an earlier attempt.
Direct terminal recovery still needs its own context-transfer approval.
Do not ask a nested MCPEE agent to resume or stop its own ancestor process.
Use `mcpee_run_status` and `mcpee_run_cancel` from the owning host instead.

## Request lifecycle

Git is optional for documentation and architecture work. Without a worktree,
review generated file contents instead of requiring a diff. MCPEE detects the
current project stack for every route: projects without application code do
not require CodeGraph queries or health checks. Harness-only package metadata
is not an application and is excluded from documentation-only impact targets.
Actual requirement changes still require synchronization; canonical phase
approvals remain mandatory. Adding application code restores code-index checks.

1. **Route.** MCPEE selects a workflow and specialist using workflow and
   specialist rules, current memory, indexed source evidence and available
   tools. Routing is deterministic. Explicitly named, already indexed
   project-relative paths are prioritized ahead of lexical matches; tasks
   naming more than ten indexed files must be narrowed. Naming a path does not
   authorize a mutation or bypass checksum and approval checks.
2. **Impact preflight.** MCPEE shows the direct and transitive dependents of
   the routed evidence. If the preflight is unavailable, state-changing tool
   calls are denied.
3. **Context authorization.** Calling the MCP task tool authorizes the selected
   context to Copilot. Direct terminal execution still requests transfer approval.
4. **Execution.** The selected workflow's ordered lifecycle stages are passed
   to Copilot, which must report incomplete stages. Each state-changing tool
   call is checked against its exact target and a fresh source checksum and
   then requires approval unless it is an ordinary task-scoped local edit.
5. **Post-change maintenance.** See
   [After a change](#after-a-change-sync-validation-and-documentation).
6. **Lifecycle report.** An eight-stage report is written under
   `.mcpee/reports/runs/`. Stage status is derived from local routing, impact,
   session, validation, documentation and telemetry evidence, never from
   Copilot's self-reported checklist.

Validated canonical specifications from `docs/specifications/<state>/<feature>/`, and compatible
historical contracts from `specs/approved/`, are included before context
authorization in every context mode. Canonical phase prerequisites are rechecked
before SDK construction. Specification, plan and task authors return structured
JSON in a read-only session; MCPEE validates, persists and indexes it. Routine
phase validation requires no human approval. Contradictions, open decisions and
risky actions still block explicitly. Invalid structured output has at most two
same-session repairs; candidates and diagnostics are persisted and the original
active/wall deadline remains in force.
While a structured task is running, MCP status exposes its elapsed time,
current authoring/repair/indexing phase and attempt number, with a polling delay.
An unchanged `running` status is not evidence that useful work is progressing.

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
| Sending task and context to Copilot | Authorized by `mcpee_run`; direct CLI still prompts |
| MCPEE task transport, status polling and cancellation | Internal; no MCPEE approval prompt |
| Ordinary task-scoped project-local file creation and edits | Authorized by the task; no per-file approval |
| Other state-changing tool calls | Required, per call, with a fresh impact check |
| SDK tool-hook permission | Delegated to MCPEE's `PreToolUse` policy; no duplicate prompt |
| Other runtime permissions requested by the SDK | Required |
| Post-change sync of indexes and graphs | Internal in MCP runs; direct CLI still prompts |
| Non-read-only validation steps | Required, per step |
| Built-in `view`, `glob`, `grep` and `rg` | Not required (read-only) |
| Unknown tools | Required |

In VS Code, approval comes from Chat's host UI through a short-lived,
token-authenticated loopback broker. In the terminal, it comes from the
interactive prompt. Approval events record decision metadata; SDK and hook
events can contain redacted tool arguments and results (see
[Observability](OBSERVABILITY.md)).

The project `preToolUse` hook allows recognized read-only tools and commands
and exact MCPEE transport/status/cancellation names (including supported host
prefixes). These transport tools are not falsely classified as read-only.
Other calls return `ask` in interactive CLI sessions and `deny` in
known non-interactive or CI sessions. The hook accepts Copilot and VS Code
Local harness input and emits both decision formats. Besides the read-only
search tools, the exact PowerShell listing forms `Get-ChildItem`, optionally
with `-Force` and `| Select-Object Name,Mode` (optionally `,Length`), are
treated as read-only; arbitrary paths, expressions, redirection and additional
commands are not. The SDK's matching `hook` permission is approved by policy
only to let this same `PreToolUse` hook make the action decision; it does not
authorize the requested tool call or replace any required human approval.

On Windows, generated project hooks use the initializing Node executable's
absolute path in their PowerShell command, so a runtime shell without Node on
its PATH can still enforce the policy. Repeated initialization upgrades legacy
MCPEE hook commands without replacing custom commands or PowerShell overrides.

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

Structured specification, plan and task authoring instead records source-bound
schema/provenance validation and refreshed canonical Markdown. It does not
require an application workflow or claim application tests ran.

Canonical implementation routes to `deliver-feature` and always uses the
canonical checks rather than an unrelated routed workflow. Without an explicit
canonical adapter, MCPEE builds a digest-bound validation workflow from the current
validated plan/tasks for exact `node --test <planned-path>.test.js|cjs|mjs`
commands. These task-linked local checks need no additional approval; shell
composition, unplanned files, sandbox bypass and other commands remain outside
this allowance. Other check commands use an explicit canonical adapter at
`.mcpee/workflows/spec-<feature>.json`, under the normal invocation approval
policy. .NET, PowerShell, cloud CLI and other catalog tools are not restricted
to node:test. Missing tools, credentials or remote permissions are reported
explicitly; MCPEE never installs tools or substitutes local doubles to claim a
remote check passed.

An absent adapter or a manual check does not prevent implementation from
starting. Plans can classify checks as `kind: "automated"` or `kind: "manual"`;
for older plans, the explicit `Manual review:` prefix identifies a manual
check. Manual checks cannot be mapped to executable adapter steps. Unmapped
automated checks and manual reviews remain pending; any runnable checks may run,
but their passing report does not constitute complete canonical verification.
Pending check IDs, descriptions and expected outcomes are retained in the run
report. After a human completes a manual check, inspect its exact criteria and
planned file hashes with `mcpee specs manual-preview --slug <feature> --id
CHECK-001`. Record their explicit findings with `mcpee specs manual-review
--slug <feature> --id CHECK-001 --reviewer "<name>" --outcome passed --findings "<what was
reviewed and the result>" --confirm-sha256 <review_sha256>`. The MCP tools
`mcpee_specs_manual_preview` and `mcpee_specs_manual_review` provide the same
operations. Never infer a human review from an agent or automated check.
Use `--outcome failed` when the review fails; the check remains pending and
the failed record is preserved. Only explicitly passed reviews count toward
verification.
All planned evidence files must exist; changes to any of them or to the
canonical phases invalidate the review. The review record is immutable and
retained under `.mcpee/reports/manual-reviews/`. Run the canonical workflow
again to combine current human reviews with actual automated results; a plan
containing only manual checks can be finalized by the same workflow command.
This is not product acceptance.

During canonical implementation, the nested agent changes the approved task
files and returns; the outer harness runs verification through its approval
broker. The implementation hooks and shell-permission policy deny recognizable
nested MCPEE CLI and MCP invocations without a human approval request; the
agent continues using the supplied context and canonical files. Other gated
actions still require their own approval. This is not a general shell sandbox
and does not authorize or execute unrecognized commands.
For a separately authorized manual invocation, `mcpee workflow run --spec
.mcpee/workflows/spec-<feature>.json` validates the adapter, builds a separate
digest-bound executable workflow with canonical evidence, requests each step's
approval, and records exact passing verification. The adapter is never
overwritten. Failure recovery also selects this canonical workflow rather than
an unrelated generic delivery workflow.

Plans and tasks authored while the bundle was `proposed` or `reviewed` may list
the bundle's own files under that earlier location. Canonical evidence resolves
those self-references to the bundle's current lifecycle directory (and former
`reviews` to `history`) without rewriting digest-bound phase files; bundle
directories are not evidence files. Every other planned path must exist before
the canonical workflow can run, so a partial implementation reports the first
missing planned file instead of running checks.

Every canonical implementation prompt (fresh or resumed) states that MCPEE owns
verification and sync, lists the planned paths that do not exist yet, and tells
the agent to request gated actions (such as adding a planned dependency)
through the normal tool call so the approval hook asks the user; the agent
stops only if that request is denied.

The adapter has `workflow_id: "spec-<feature>"`, a `task` description and
`steps`. Each step binds one lowercase canonical check ID, the exact plan
`command` (for traceability), a `label`, catalog `tool` and `args` array.
Optional `cwd` stays project-relative; `timeout_ms` is bounded to 1000-900000.
Map automated plan checks exactly once, including operational checks without a
task link; these are not credited as per-use-case implementation evidence.
An incomplete adapter leaves unmapped checks pending; it does not mark them passed. Do not
silently omit pending Azure checks. Invocation approval remains required even
if the adapter says `requires_approval: false`. Commands are never parsed or
executed through a generic shell, and adapter commands are not autoauthorized
inside the Copilot session. For example:

```json
{
  "workflow_id": "spec-example-feature",
  "task": "Verify the canonical implementation checks",
  "steps": [{
    "id": "check-001",
    "label": "Run the application tests",
    "command": "dotnet test tests/App.Tests/App.Tests.csproj --no-build",
    "tool": "dotnet",
    "args": ["test", "tests/App.Tests/App.Tests.csproj", "--no-build"],
    "timeout_ms": 300000
  }]
}
```

Use `pwsh` with `-NoProfile -File <project-script>` for PowerShell and
`azure-cli` for `az` operations. On Windows the installed Azure CLI uses its
bundled Python module without launching `az.cmd` or a shell.
The adapter hash joins canonical execution evidence; changing it during checks
invalidates verification. A check that recovers or rewrites canonical phases
cannot provide stable verification: any resulting phase change is rejected,
not credited as implementation success.

Persisted evaluation and telemetry bind results to the
specification, plan and task digests; a phase change during checks rejects
verification. Passing these checks is not production or full product acceptance.

Plan risk gates must identify a concrete `approval_action` such as deployment,
publication, migration or a dependency/permission change. A disclaimer that
local tests do not prove production acceptance is not an approval gate.
Canonical JSON/Markdown reconciliation tolerates line-ending and final-newline
formatting only; substantive owner edits still block advancement.

### Explicit multi-phase execution

Use `mcpee run --task "<original request and constraints>" --feature <slug>
--through tasks|verification`, or the MCP `mcpee_run` arguments `feature`
and `through`, to request a bounded canonical lifecycle. Neither option is
enabled implicitly for ordinary single-phase tasks. MCPEE creates a missing
specification, then authors only missing plan/tasks phases and, when explicitly
requested, implements and verifies. Existing validated phases are not
regenerated. The same procedure works for document-led greenfield and
evidence-led brownfield sources.

The original constraints accompany every phase. Each phase has its own normal
bounded executor and approval policy; the chain has at most four phase
executions, with no repeated phase after failure or lack of advancement.
Decisions, manual drafts, drift, missing explicit specification approval and missing verification stop the chain.
Planning may run against structurally reviewed requirements, but tasks and implementation
require an explicit user approval instruction. Use `mcpee_specs_status` and
`mcpee_specs_approve` for selected specifications or a batch; no per-proposal
confirmation or paid model session is needed. Generating or implementing does not approve specs.
`.mcpee/reports/lifecycles/<id>.json` records phase outcomes and the endpoint,
without storing raw task text. Interrupted chains are not automatically resumed.

Successful canonical checks persist `docs/specifications/approved/<feature>/verification.json`
inside the already explicitly approved bundle, without granting requirement approval:
each use case links tasks, check IDs and implementation paths, with canonical
phase digests, evaluation report hash and all evaluated file hashes.
`specs status` reports implementation checks as verified only while those
hashes remain current; changes to code, requirements, tasks or report invalidate
the evidence. The graph/retrieval inventory includes this canonical record.
This proves execution of mapped technical checks, not semantic completeness
of every acceptance criterion. The next action becomes
`review-product-acceptance`, never an invented production approval.

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
  instead of starting the task again or repeatedly invoking a mutating tool.
  Polling is not accepted by `mcpee_run`; cancellation uses the separate
  `mcpee_run_cancel({run_id: "..."})` tool. The server atomically persists
  redacted results, task hashes, trace IDs, last authoring progress and owning
  process IDs under `.mcpee/state/runs/<run-id>.json`. Terminal results remain
  retrievable after restart and after later tasks; raw task text and broker
  credentials are not stored in these snapshots.
- A dead owning server without a persisted terminal result is reported as
  `interrupted`, never completed or automatically replayed. Inspect its trace,
  changed files and saved candidates; `mcpee specs recover` can restore a
  validated candidate. A recorded SDK session can be resumed only with the
  explicit `mcpee run --resume-session <uuid> --task "<same request>"` command
  described above. A child
  process may still be running: the new server reports that possibility and
  refuses duplicate work while either recorded process is live. It cannot
  safely cancel a process owned by another server, so it never kills that PID.
  PID liveness is conservative, not proof of process identity or ownership.
  Status retrieval does not rewrite snapshots. IDs from before this journal
  existed still report unknown; MCPEE does not invent their results.
- Independent servers use an exclusive project-local `admission.lock` while
  checking live journals and persisting the initial run state, before spawning.
  A crash during that short admission window may leave a lock; inspect its
  owner and journals before explicitly removing it. MCPEE never steals a lock
  or kills a recorded PID to conceal uncertain state.
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
