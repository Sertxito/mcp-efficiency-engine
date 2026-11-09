# Command reference

All commands accept `--project <path>` (default: the current directory).
`mcpee help` prints the built-in summary. For explanations, follow the linked
guides.

## Setup and maintenance

| Command | Purpose |
|---|---|
| `mcpee init [--agents <id,...\|all\|none>] [--skip-tool-install] [--embeddings none\|light\|bge-m3] [--mcp-config auto\|portable\|vscode]` | Choose a capability preset or checkboxes in a new empty project, authorize the tool bundle once, sync knowledge and detect brownfield/greenfield. Always registers `mcpee`, including documentation-only projects; `auto` reuses the sole existing MCP config and otherwise selects portable `.mcp.json`. Embeddings default to off. Ends with an explicit complete/incomplete status. See [Getting started](GETTING-STARTED.md). |
| `mcpee status` | Show installation, source and telemetry state. |
| `mcpee doctor` | Validate required local artifacts and indexes. |
| `mcpee explain [--task <request>]` | Explain the installed catalog, tools, knowledge state, hooks and, with `--task`, the selected plan. |
| `mcpee update` | Refresh project integration from the installed MCPEE package. |
| `mcpee rebuild` | Reprocess sources and regenerate derived knowledge. |
| `mcpee clean` | Remove `.mcpee/cache/` only. |
| `mcpee help` | Show built-in help. |

## Working with Copilot

| Command | Purpose |
|---|---|
| `mcpee run --task <request> [--model <id>] [--resume-session <uuid>] [--pack-context \| --no-ground-context] [--context-tokens <128..32000>]` | Execute a routed task with GitHub Copilot under approvals, or explicitly resume an interrupted SDK session for the same task. See [Copilot execution](COPILOT-EXECUTION.md). |
| `mcpee run --task <request> --feature <slug> --through tasks\|verification` | Explicitly chain canonical authoring phases through tasks or implementation checks. Stops on decisions, drift, failed or non-advancing phases; never grants risky approvals or claims product acceptance. |
| `mcpee route --task <request> [--json]` | Create a deterministic local plan without executing it. |
| `mcpee plan init --slug <id> --title <title>` / `plan list [--json]` | Create or list delivery plans. |
| `mcpee specs discover \| list [--all] \| drift [--json]` | Review specification proposals and drift. See [Specification discovery](BROWNFIELD-SPECS.md). |
| `mcpee brownfield [--model <id>] [--concurrency <auto\|1..10>] [--last-domain <domain,...>] [--resume-session <uuid>]` | Sync RAG/graphs and author proposals. Default `auto` selects one session per ten pending units (rounded up, maximum ten), excluding reused/blocked units; explicit 1..10 overrides it. Large runs may take hours; progress reports actual counts and selected concurrency. Failures retain evidence and do not stop other units; incomplete runs return `partial` and nonzero exit. All domains use the same queue unless the owner requests `--last-domain`. Current proposals are reused; an interrupted session can resume only its unchanged context. |
| `mcpee init --prepare-only` | Explicitly prepare only local tools/indexes, without Copilot functional authoring; not complete brownfield. |
| `mcpee specs scopes [--json]` | Prepare bounded brownfield extraction units (4 primary files, 24 KiB, 12 sections; separate 12 KiB related-context budget). Exact primary ranges account for every planned source line once. Context does not require whole-document coverage in each unit. Read-only, no model execution; blocks/exclusions remain explicit. |
| `mcpee specs reconcile [--json]` | Persist a hash-linked post-authoring scope/case/source matrix with exact duplicate candidates, source conflicts and graph-derived technical links. Always requires owner review; does not approve product behavior. |
| `mcpee specs ratify --slug <id> --reviewer <name> --confirm-sha256 <digest>` | Approve a legacy inventory-based contract into `docs/specifications/approved/`. |
| `mcpee specs status [--slug <feature>] [--json]` | Start at `docs/README.md`; inspect each specification's physical state, authority, phase, drift and review hashes. |
| `mcpee specs review --slug <feature> --reviewer <owner> --confirm-sha256 <digest>` | Record exact review and move the bundle to `reviewed/`, without granting authority. |
| `mcpee specs decide --slug <feature> --id Q-001 --answer <decision> --reviewer <owner> --resolution resolved\|pending\|deferred` | Record an explicit owner answer without rewriting the question. Pending answers stay open and block approval; `deferred` means explicitly out of the current phase, remains visible and unresolved, but does not block current-phase approval. Later settlement preserves its history. |
| `mcpee specs revise-decision --slug <feature> --id Q-001 --answer <decision> --reviewer <owner> --confirm-sha256 <current-spec-digest>` | Revise a previously resolved owner answer only after confirming the current specification digest; appends the previous answer to history and invalidates digest-bound reviews. |
| `mcpee specs approve --slug <feature> --stage specification\|plan\|tasks --reviewer <owner> --confirm-sha256 <digest>` | Approve the exact reviewed artifacts in order; never marks implementation verified. |
| `mcpee specs drift-preview --slug <feature> --source <path>` | Preview an eligible out-of-scope source change and its exact review digest before or after specification approval, without recording a review. |
| `mcpee specs drift-review --slug <feature> --source <path> --reviewer <name> --findings <text> --confirm-sha256 <review-digest>` | Record an explicit human review of the exact change and its out-of-scope classification; does not change or approve the specification. |
| `mcpee specs manual-preview --slug <feature> --id CHECK-001` | Inspect a manual check and digest-bound planned evidence before human review. |
| `mcpee specs manual-review --slug <feature> --id CHECK-001 --reviewer <name> --outcome passed\|failed --findings <text> --confirm-sha256 <review-digest>` | Record an explicit human review without claiming product acceptance; failures remain pending. |
| `mcpee specs reconcile-lifecycle --report-id <uuid> --run-id <uuid>` | Preserve and mark an abandoned lifecycle interrupted only when its matching run is terminal and child process has exited. |
| `mcpee specs approve --all-current --reviewer <owner> --reason <explicit-approval-instruction>` | Approve the current canonical specification batch with digest-bound snapshots and state-transition history; no per-proposal confirmation. Stops on unresolved requirements or active runs. |
| `mcpee specs migrate [--json]` | Move legacy root specs and inventories under `docs/` with rebased links and audited provenance; preserve existing authority, never invent it. Older pre-workspace drafts are imported as unapproved copies. |
| `mcpee specs recover --candidate <project-relative-response.txt> [--source <original-path>] [--confirm-sha256 <revision-digest>]` | Validate a preserved authoring candidate and rebuild local indexes without calling a model. Requires the recorded response checksum and unchanged original source snapshot. Conflicting plan/task/specification revisions require the exact revision digest and are archived before replacement. |

## Knowledge

The MCP tools `mcpee_specs_status`, `mcpee_specs_decide`, `mcpee_specs_revise_decision` and `mcpee_specs_approve` expose the same
local specification approval flow. Use the approval tool only on an explicit
user approval instruction, never infer it from generation or implementation.
Tasks and implementation require real specification approval.
The decision tool requires `slug`, `id`, `answer`, `reviewer` and explicit
`resolution: resolved|pending|deferred`; a deferred decision is non-blocking for
the current phase, not resolved and not an approval. Inspect the existing
register before writing: an already deferred answer must not be re-recorded
without an explicit owner change. Repeating the same pending or deferred
answer, reviewer and resolution leaves the register, history and digest
unchanged. It records clarification
without calling a model, requiring CodeGraph or authorizing approval. `mcpee_run` authoring/clarification
uses `task` only, not `feature`/`through` (reserved for tasks/verification).
`mcpee_specs_revise_decision` appends the prior resolved answer to history and
requires the exact current specification digest. A changed functional
specification is first archived as a complete bundle in
`.mcpee/reports/specification-revisions/`; MCPEE verifies the archive file,
manifest digest, artifact inventory and decision history before asking for
explicit replacement confirmation. Denying replacement leaves the verified
archive in place and the current bundle unchanged. Replacement invalidates
dependent phase artifacts and requires a fresh specification review. Revision
confirmation is not product approval. Decisions omitted from a revised draft
remain in the register as historical records; their IDs and answer histories
are preserved, and new decisions receive unused IDs.

| Command | Purpose |
|---|---|
| `mcpee sync` | Incrementally ingest, normalize and index project knowledge. |
| `mcpee knowledge search\|graph --query <text> [--mode lexical\|vector] [--limit <n>] [--json]` | Search sources or graphs. |
| `mcpee knowledge context --query <text> [--max-tokens <128..32000>] [--json]` | Build a cited evidence pack. |
| `mcpee knowledge embeddings status\|setup\|index [--profile light\|bge-m3]` | Manage optional semantic embeddings. |
| `mcpee impact --path <project-relative-path> [--json]` | Show dependents and linked documents. |
| `mcpee drift [--json]` | Review broken references and contradictory statements. |
| `mcpee memory add --kind <kind> --text <text> [--source <path>]` / `memory list [--kind <kind>]` / `memory search --query <text> [--limit <n>]` | Manage explicit project memory. |

Details: [Knowledge and context](KNOWLEDGE.md).

## Quality and evaluation

| Command | Purpose |
|---|---|
| `mcpee workflow run --spec <project-relative-json>` | Run a declared sequence of allowlisted checks. |
| `mcpee evaluate --run <project-relative-json>` | Execute local checks and record the evidence. |
| `mcpee evaluate --case <id> --asset <id> --response <file> [--ratings <json> --reviewer <name>]` | Evaluate an agent-asset response. |
| `mcpee evaluate --suite specialist-core [--scenario <id> --variant normal\|failure\|boundary \| --results <json>] [--json]` | Specialist acceptance with supported automatic oracles or sufficient technical review. Node JSON task exports include ready baseline/candidate evaluation specs. |
| `mcpee evaluate --suite specialist-audit [--scenario <id> --variant positive\|negative\|insufficient \| --results <json>] [--json]` | Paired static audit trials; safe negative controls can verify automatically, semantic cases remain unverified without sufficient evidence. |
| `mcpee evaluate --suite technology-runtime [--scenario <oracle-id> --variant baseline\|candidate \| --results <json>] [--json]` | Inventory native behavioral fixtures separately from static probes; export exact evaluation specs or verify retained baseline/candidate evaluations. Does not execute a model or confer specialist/product acceptance; inspection returns exit 2. |
| `mcpee evaluate --suite workflow-catalog [--json]` | Inspect all catalogue workflows against this project's run, telemetry and current hashed evaluation evidence. Reports gaps and not-run flows; does not execute or certify them. Exit 2 means catalogue acceptance is incomplete. |
| `mcpee quality [--strict] [--json]` | Report validation gates for the detected stack. |
| `mcpee coverage [--json]` | Report the mapped catalog baseline per technology. |
| `mcpee skills health [--json]` | Correlate workflow outcomes with skills. |
| `mcpee tasks list \| approve\|reject\|start <task-id> \| complete <task-id> --evaluation <id>` | Manage follow-up tasks. |
| `mcpee learn propose --evaluation <id> --kind pattern\|insight --text <text>` / `learn list` / `learn approve\|reject <proposal-id>` | Propose and review learning. |

Details: [Quality and evaluation](QUALITY-AND-EVALUATION.md).

## Observability

| Command | Purpose |
|---|---|
| `mcpee trace [--trace-id <id> \| --session <id>] [--event <name>] [--limit <n>] [--show <id>] [--json] [--export <json>]` | Inspect or export recorded events. |
| `mcpee trace [--trace-id <id>] --otlp <json>` | Write local OpenTelemetry spans (no content, no network). |
| `mcpee observe [--json] [--export <json>] [--html <html>]` | Summarize telemetry or generate the validation view. |
| `mcpee view --html <html> [--report <json>]` | Generate the evidence library. |
| `mcpee telemetry validate [--json]` | Validate event schema and redaction. |

Details: [Observability](OBSERVABILITY.md).

## Catalog, tools and audits

| Command | Purpose |
|---|---|
| `mcpee capabilities list [--type <type>] [--json]` | List catalog assets. |
| `mcpee capabilities install\|update\|remove <id> [--type <type>]` | Manage one asset; `capabilities update` alone refreshes all. |
| `mcpee tools list` / `tools validate [--tool <id> ...]` | Discover or check local tools without installing. |
| `mcpee assets audit [--json]` | Read-only audit of agent, skill, hook and MCP configuration. |
| `mcpee cloud inventory --provider azure\|aws [--json]` | Read-only aggregate cloud inventory through local CLIs. |

Details: [Catalog, capabilities and tools](CATALOG.md).
