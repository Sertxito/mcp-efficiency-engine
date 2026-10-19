# MCPEE

MCPEE is a local-first engineering harness for GitHub Copilot. Its product
architecture is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md);
the runnable CLI, catalog and local-first workflows are implemented in this
repository. The npm package remains **`mcp-efficiency-engine`** and both
`mcpee` and `mcp-efficiency-engine` invoke the new CLI.

## Install and upgrade

MCPEE 0.1.25 is a pre-1.0 replacement for the legacy implementation, not a
drop-in compatibility release. It requires Node.js 24 or newer; a complete
tool installation additionally checks the latest official Node.js LTS patch.
Existing Copilot authentication and a host supporting MCP elicitation are
needed for approved model execution.

```sh
npm install --global mcp-efficiency-engine@0.1.25
mcpee init --project C:\path\to\project
```

Alternatively run a pinned package without a global install:

```sh
npx --package=mcp-efficiency-engine@0.1.25 mcpee init --project C:\path\to\project
```

If npm reports that the Copilot SDK's native `koffi` dependency has a blocked
install script, authorize just that dependency for this installation:

```sh
npm install --global mcp-efficiency-engine@0.1.25 --allow-scripts=koffi
```

This does not enable scripts globally. A successful `mcpee help` checks the
CLI entrypoint, not native SDK execution or Copilot authentication.

Installing the package does not run project setup, install tools, or change
Copilot settings. Run `init` explicitly and approve each required download.
There is no legacy `postinstall` hook. Legacy commands, configuration, memory
and hooks are not automatically migrated; read the
[migration guide](docs/MIGRATION.md) before upgrading an existing workspace.
Release and npm deployment procedures are in [RELEASING.md](docs/RELEASING.md).

## Current implementation

Long-running terminal commands emit an activity heartbeat to stderr every ten
seconds, including elapsed time; BGE setup also names download and indexing
phases. The indicator remains active while synchronous subprocesses run and
does not claim a percentage or prove forward progress. It is disabled for
non-terminal output, `--json` and MCP `--chat-json` responses.
CPU BGE indexing additionally reports tokenizer progress and encoded chunks,
with a measured completed/total count and reused cached vectors, including in
redirected stderr logs (except `--json` and `--chat-json`). CPU inference uses
at most 16 texts and 4,096 padded tokens per batch: long chunks run separately
instead of padding every short text to the longest chunk. Chunk content and
the 4,000-token per-chunk limit are unchanged. Its timeout
is thirty minutes without a progress event, not thirty minutes for the entire
corpus. Completed batches are committed to a local owned SQLite cache; an
interrupted run reuses matching chunks and model files on the next index
command. A partial cache is not a usable or enabled index. Concurrent indexing
of the same destination fails explicitly instead of overwriting another run.
Node/Python requests and responses use strict UTF-8, independent of the
Windows console code page. See the migration guide for affected older caches.

- `mcpee init` creates the project-side directories, configuration, Copilot
  instructions and hooks, and renders the current catalog without overwriting
  existing user files. It discovers catalogued executables and asks for
  approval before downloading/installing each local tool package into
  `.mcpee/tools/`, then performs the initial local knowledge sync. Noninteractive
  installs are denied unless `--skip-tool-install` is supplied. GitNexus is
  excluded because its current license is non-commercial. When upgrading an
  older MCPEE hook, `init` asks before replacing its runtime or adding a missing
  `preToolUse` registration; other configured hooks are preserved.
- During initialization MCPEE detects repository-local stack signals from
  project/configuration files and dependency manifests while skipping VCS,
  dependency, generated, and build directories, and separately records code-file
  signals even when no supported stack is identified. It records evidence and selected
  agents, skills, workflows, patterns, playbooks, technical guidance, quality
  assets, prompt examples, and templates in
  `.mcpee/generated/project-capabilities.{json,md}`. Matching technical
  guidance is also rendered as file-scoped Copilot instructions under
  `.github/instructions/`; the complete template sources are bundled in the
  generated template catalog. Supported code/stack evidence selects matching
  defaults automatically. If no code-file signal exists, first-time interactive
  initialization asks which agents to install; their skills, workflows, and
  patterns are included as dependencies. `--agents <id,...|all|none>` makes
  that choice explicit in scripted setups. Non-interactive initialization
  without `--agents` uses the general-purpose default and does not guess a
  stack. Re-run `mcpee init` after changing the stack to refresh detected
  assets; manage any capability later with `mcpee capabilities`. `mcpee explain`
  reports the detected stack and selected capabilities.
- `mcpee capabilities list [--type <type>] [--json]` shows detected/installed,
  available, and non-removable core catalog entries. Use
  `mcpee capabilities install|update|remove <id> [--type <type>]` to manage
  agents, skills, workflows, patterns, templates, playbooks, technical guides,
  scorecards, evaluation cases, and prompt examples. Agent/workflow/playbook
  dependencies are restored on installation; removal refuses to break another
  installed capability and retains dependencies still shared by other assets.
  The per-project selection is recorded in
  `.mcpee/state/catalog-capabilities.json`; generated user-owned files are
  preserved. `mcpee capabilities update` refreshes all installed catalog
  assets from the package's current catalog.
- After sync, `init` creates a validation spec for each catalog workflow from
  supported npm scripts (`test:ci`, `test:unit:ci`, `test`, `lint`, `typecheck`, `check`, or
  `build`), explicitly configured pytest setups, and .NET solutions or standalone
  projects when the corresponding tool is invokable. Discovery covers nested
  monorepo packages, skips dependency/build directories and symbolic links, and
  records project-relative working directories and evidence. Declared CI test
  scripts take precedence over `test` to avoid starting watch mode. It does not execute
  checks during setup; each
  workflow step requires explicit approval. Existing specs are preserved. If
  discovery finds more than the runner's 20-step limit, it creates no generated
  specs and reports that workflows must be configured manually. If no supported
  check is found, `init` reports that post-change validation must be configured
  before generated documentation can be refreshed.
- Detailed routing, MCP, CLI, Copilot SDK, and hook events are stored locally
  in `.mcpee/telemetry/events/copilot.jsonl`. Traces correlate route selection,
  selected knowledge sources, prompt/context, SDK messages and usage, tool
  requests/results, `mcpee run` data-transfer approval decisions, and execution
  outcomes through `trace_id` and `parent_id`.
  The SDK's `parentId` denotes the chronologically preceding SDK event, not a
  causal parent. New events retain it as `sdk_previous_event_id`; SDK events
  belong to the MCPEE execution, with explicit tool completion linked to its
  matching tool start.
  Copilot's `assistant.usage` values are recorded only when the installed SDK
  emits them; missing usage is reported as unavailable, never estimated as
  actual token consumption. A real read-only Copilot session on 2026-10-13
  emitted usage with model, token, and cost fields; availability remains
  session- and SDK-dependent.
- `mcpee init` registers a project-scoped `mcpee_run` MCP tool and generates
  always-on Copilot instructions that route project engineering requests from
  ordinary Copilot Chat through MCPEE. No VSIX or `@mcpee` invocation is needed.
  VS Code starts the MCP server automatically when Chat needs its tools. The
  server uses MCP elicitation for explicit approval before context transfer and
  each state-changing action; it fails closed when the host cannot provide that
  approval UI. Workspace trust and normal Copilot tool confirmations remain in
  effect.
- `mcpee trace` lists, filters, and inspects captured events. Use
  `mcpee trace --trace-id <id> --export reports/trace.json` to export the
  detailed, versioned event envelope locally; `--session` and `--event` also
  filter the export. Downstream consumers can validate it with
  [telemetry-export.schema.json](./schemas/telemetry-export.schema.json), whose
  event items reference [telemetry-event.schema.json](./schemas/telemetry-event.schema.json).
  `mcpee trace --trace-id <id> --otlp reports/trace-otlp.json` uses the
  OpenTelemetry SDK to materialize recorded events as parented spans and writes
  standard OTLP JSON locally. It is an on-demand reconstruction, not live SDK
  auto-instrumentation. No collector, HTTP exporter, remote backend, or network
  transfer is configured. The OTLP export omits prompts, responses, source text,
  tool arguments/results, and reasoning; the detailed local event export is
  separate. Uncorrelated events are not silently joined into a single request.
- `mcpee memory add/list` stores explicit, source-linked project memories locally;
  it does not infer or promote prompts into durable memory.
- `mcpee memory search --query ...` retrieves relevant memories and reports
  whether each source's content still matches the recorded checksum.
- `mcpee observe` summarizes locally recorded routing fallbacks, impact
  preflight, selected-context size, Copilot outcomes/durations, actual model
  usage when emitted by the SDK, tool execution durations, human tool
  approvals, tool results, and evaluation/workflow pass/fail and check counts.
  It uses recorded events only and makes no claims about unobserved host
  activity. `mcpee observe --export reports/observe.json` optionally writes a
  redacted aggregate report inside the project and refuses to overwrite an
  existing file; no telemetry is sent over the network.
  JSON observations separate `outcomes.local_tools` (MCPEE CLI tools, including
  workflow checks and indexing, with failures/timeouts and durations) from
  `outcomes.tools` (SDK-reported tool timings), avoiding double-counting.
- `mcpee observe --html .mcpee/reports/validation-view.html` generates a
  standalone Spanish-language human review view, without a server, scripts, or
  external requests. Open the HTML locally to inspect declared quality gates,
  missing check results, the latest recorded attempt per workflow versus its
  history, check output/evidence, and chronological correlated event journeys.
  It reads live local telemetry and workflow reports, not a previously exported
  aggregate JSON. The snapshot refuses overwrite and does not record human
  approval, re-run checks, verify evidence freshness, or certify release readiness.
  Re-run validation and export to a new filename after changes. Redaction and
  retention limitations below also apply to the HTML; review before sharing.
- `mcpee view --html .mcpee/reports/evidence-view.html` uses the same viewer for
  the wider evidence library: run lifecycle stages, evaluation and asset-rating reports, other
  report snapshots, capability/tool/graph state, explicit memory, task decisions,
  and learning proposals. Nested JSON is presented as labelled human-readable
  records; unknown fields remain explicitly technical, not guessed.
  Request journeys appear newest first with the latest expanded: received task,
  selected route, context sources, recorded full prompt, approvals, tool calls,
  and final response. Missing evidence is explicit. A recorded response is not a
  quality assessment; historical check results do not establish global product
  correctness or current evidence freshness. Internal reasoning is not displayed
  in the request journey.
  Each request also shows SDK usage per call, cumulative input/output, cache
  read/write when available, and the last observed context window and limit.
  Cumulative input can repeat the same context across calls; it is neither a
  unique context size nor a verified bill. The SDK documents `assistant.usage.cost`
  as a premium-request multiplier, not tokens, AI credits or currency. The
  viewer preserves the reported value without claiming an account charge.
  Retrieved context and the MCPEE prompt have
  separate byte counts and character/4 token estimates, not tokenizer counts.
  Additional runtime instructions may not be included in those prompt estimates.
  New runs record consultations of the catalog, current evidence-linked memory,
  lexical knowledge, grounding/vector retrieval, and local graphs, including
  empty selections, unavailable indexes, explicit fallback, and failures.
  Selected asset IDs are distinguished from the manifest included in the
  executor prompt, runtime-discovered skills, and observed skill invocations.
  An agent's guidance in a prompt is not an independently executed subagent;
  an included memory is not proof of causal influence on a response.
  Historical runs without these events are labelled uninstrumented, not unused.
  Previously redacted measurements cannot be recovered as original observations.
  Add `--report path/to/evidence.json` to include another explicitly selected
  project-local JSON report through the same reader.
  Missing records are not treated as success. The library reads only known
  MCPEE locations, rejects symlinked or malformed JSON and files over 1 MiB,
  and stops above 500 JSON files. Long records have explicit display limits.
  "Completo" means all currently declared technology checks have recorded
  passing results; it does not cover unconfigured checks, model sessions,
  deployed infrastructure, response quality, or human release approval.
- Detailed event records, including prompts, responses, and available tool
  inputs/results, are retained locally for 30 days and pruned on telemetry
  reads and periodically on writes. Aggregated observations and explicitly exported reports
  are not automatically expired. Redaction removes common credential patterns
  and secret-like fields but cannot guarantee removal of every sensitive value;
  review local workspace access and exported files accordingly. MCPEE does not
  send telemetry to a third-party observability service.
- `mcpee telemetry validate [--json]` deterministically checks recorded JSONL
  event schema, including redacted Copilot SDK and hook payloads, and whether stored
  events still satisfy the telemetry redaction rules. It reports `no-evidence`
  when no events exist; it does not grade prompts, agent behavior, or unobserved
  host activity.
- `mcpee status` and `mcpee doctor` report installed artifacts and local state.
- `mcpee assets audit [--json]` performs a bounded, read-only heuristic scan of
  known project-local agent, skill, hook, instruction, and MCP configuration
  paths. It reports paths, line numbers, severity, and remediation guidance
  without echoing matched values. Symlinks and oversized files are skipped or
  reported; findings at high or critical severity produce a non-zero exit
  status, and a clean result is not proof of harness security.
- `mcpee coverage [--json]` validates and reports the versioned minimum catalog
  mapping for every detected technology: specialist, skill, workflows,
  technical guidance, pattern, scorecard, evaluation case, prompt, and a
  validation-discovery basis. `mapped` means those references exist; it is not
  a completeness, quality, compatibility, or release certification.
- `mcpee quality [--json]` reports validation checks explicitly tagged to the
  detected stack in workflow specs, with check-specific project evidence and
  the latest recorded outcome. Generated checks are tagged only when their
  source file is also direct evidence for a detected technology; add
  `covers_technologies` to a project workflow step to declare other relevant
  checks. `--strict` exits 0 only when all detected technologies have declared
  checks and every declared check has a latest passing workflow result, 1 on a
  recorded failure, and 2 when coverage is missing, blocked, or unrun. A pass
  proves only that those declared commands passed, not that they enforce every
  language convention or quality attribute.
- `mcpee skills health [--json]` correlates recorded MCPEE workflow evaluation
  reports with the skills assigned to those workflows, separately from direct
  asset evaluations. It exposes sample sizes and pass/fail counts; workflow
  outcomes remain proxies and cannot establish causality. Skills without
  direct, human-reviewed evaluations remain `no-direct-evidence` or
  `limited-evidence`.
- `mcpee evaluate --case <id> --asset <id> --response <file>` runs the catalog
  case's explicitly declared literal smoke assertions locally. A result is
  awaiting review until a person supplies a complete scorecard file using
  `--ratings <json> --reviewer <name>`; every criterion is rated 0-2 with
  evidence. Reports store the response hash and assertions, never the response
  content. Literal checks are not semantic grading, and submitted human ratings
  are recorded as attestations rather than independently verified facts.
- `mcpee plan init --slug <id> --title <title>` creates a versionable draft
  specification and delivery plan under `.mcpee/planning/<id>/`; it never
  overwrites existing files. `mcpee plan list [--json]` inventories those
  local plans. The scaffold includes measurable acceptance criteria, linked
  evidence, delivery slices, dependencies, validation, risks, approvals, and
  open decisions; creation is not approval to implement or deploy.
- `mcpee sync` discovers supported text sources, classifies them with the
  source-processor categories in `catalog/source-processors/processors.json`,
  incrementally
  extracts and normalizes local content, builds a lexical index, and records
  source checksums and derived-artifact traceability. A single MCPEE workspace
  can include multiple nested repositories or applications: list their
  project-relative directories under `knowledge.sourceRoots`; one shared index
  and graph retain their workspace-relative paths. All indexed repositories
  must remain beneath the MCPEE project root.
- `mcpee knowledge search --query ...` searches that local index and returns
  source paths with links to normalized evidence.
- `mcpee knowledge search --query ... --mode vector` ranks the same local
  source evidence with sparse TF-IDF cosine similarity. This is local vector
  retrieval over lexical terms, not embedding-based semantic search; it adds no
  model download or remote service.
- `mcpee knowledge embeddings setup [--profile light|bge-m3]` offers two
  explicitly selected local profiles. `light` (the setup-command default) uses an existing
  loopback Ollama service and downloads `embeddinggemma` (about 0.6 GB) only
  after approval; MCPEE does not install Ollama. `bge-m3` asks once for approval
  to install pinned packages into an isolated, project-local Python 3.12
  environment and download `BAAI/bge-m3` model weights. BGE-M3 runs on CPU with
  an explicitly pinned compatibility stack (`transformers==4.44.2`,
  `sentence-transformers==3.0.1`, `peft==0.12.0`) to avoid incompatible newer
  transitive releases. Rerun embeddings setup to repair an older environment;
  existing owned model weights are reused. It uses
  batches of 16, tokenizer-checked chunks capped at 4,000 tokens, complete
  Markdown table headers repeated when a table is split, and 15% overlap between
  adjacent code chunks. It persists a FAISS dense index and BM25 token data and
  fuses their rankings with Reciprocal Rank Fusion. Package and model downloads
  occur only during approved setup; Hub telemetry is disabled, and source
  ingestion, embedding, and queries run offline and stay local. `status` and
  `index` accept the same `--profile` option. `sync` refreshes whichever profile
  is enabled; model files stay in Ollama's user cache for `light` and in
  `.mcpee/models/` for `bge-m3`.
- Interactive `mcpee init` asks whether to enable optional local semantic
  embeddings (`bge-m3`, recommended for local CPU use; `light` for an existing
  Ollama service; or `none`). Each package/model download still requires its
  own approval. Non-interactive initialization defaults to `none`; pass
  `--embeddings bge-m3|light|none` to choose explicitly. Declining an optional
  tool installation does not block initialization; required CodeGraph setup
  remains a prerequisite.
- `mcpee knowledge context --query ... --max-tokens 4000` returns a compact,
  source-cited evidence pack for a downstream agent. It selects original
  excerpts using hybrid semantic/lexical retrieval when fresh local embeddings
  exist, otherwise falls back to lexical retrieval. It does not use a model to
  summarize or rewrite source evidence; the token limit is an approximate
  character-based budget. The embedding index is ignored by Git and remains
  local to the project.
- `mcpee run --task ...` retrieves a compact, grounded evidence pack by default
  and sends it to the Copilot session after explicit approval. This works with
  lexical retrieval even when local embeddings are not enabled; fresh local
  embeddings add semantic retrieval. `--no-ground-context` disables retrieval,
  `--ground-context` documents the default explicitly, and `--pack-context`
  selects Repomix instead.
- `mcpee knowledge graph --query ...` searches MCPEE's local unified evidence
  graph, the required project-local CodeGraph symbol graph, and the optional
  project-local Graphify AST graph when available. Results retain graph type,
  project-relative source path, and symbol line evidence when available.
  Routing combines matches from every ready graph.
- `mcpee impact --path <project-relative-path>` reports direct and transitive
  dependents from explicit indexed source, .NET build, infrastructure, API,
  pipeline, schema, and database references, plus Markdown documents linking to
  the target. Each relationship includes its source path and line; this is a
  static evidence view, not a runtime impact guarantee.
- `mcpee drift` reports in-project Markdown links whose targets are missing.
  It also compares explicitly anchored Markdown statements with opposing
  requirement, availability, support, or permission language, and correlates
  matching boolean configuration values, JS/TS capability-flag declarations,
  simple test assertions, and the latest CodeGraph health event. Those bounded matches are review candidates—not
  authoritative semantic conclusions—and carry checksummed source locations.
  It does not infer arbitrary code/test/runtime semantics or general runtime
  behavior. Run `mcpee sync` after source changes to incrementally refresh
  semantic vectors when embeddings are enabled.
- `mcpee run` includes impact analysis for routed evidence before asking to send
  context to Copilot. State-changing Copilot tool calls are denied when that
  preflight is unavailable; file mutations are checked against their exact
  target and a fresh source checksum, then require approval for that call. After
  successful file mutations, MCPEE asks separately before syncing indexes and
  graphs, runs the matching declared validation workflow, and refreshes
  generated documentation only if validation passes.
- `mcpee workflow run` presents impact analysis for its declared evidence before
  running checks. State-changing steps are blocked unless all workflow evidence
  is indexed and the impact preflight is ready; per-step human approval remains
  required.
- `mcpee tools list` discovers configured local executables, and
  `mcpee tools validate --tool node` checks a selected tool. Installation occurs
  only during `mcpee init`; ordinary discovery and invocation never install
  tools, and execution uses allowlisted commands without a shell.
- `mcpee cloud inventory --provider azure|aws [--json]` makes an explicit,
  read-only query through the locally installed Azure CLI or AWS CLI using its
  existing authentication context. It reports aggregate resource counts, not
  resource IDs, names, tags, or credentials; MCPEE does not install cloud CLIs,
  request/store credentials, change cloud state, or export the result.
- The central catalog validates unique IDs and cross-references across agents,
  skills, workflows, policies, executable tools, tool capabilities, routing
  rules, source processors, patterns, and templates. Executable tool IDs match
  the tool-manager inventory; capabilities such as test runners remain distinct
  from installed commands. It renders Copilot profiles, skill procedures,
  workflow contracts, policy guidance, plus generated pattern and template
  indexes. The catalog lock covers the canonical catalogs and referenced
  template, role, skill, workflow, and pattern sources.
  User-owned files at generated paths are preserved; stale files are removed
  only when the manifest and MCPEE ownership marker confirm they are generated
  artifacts.
- The editable role blueprints in `agents/`, shared-skill blueprints in `skills/`,
  and lifecycle proposals in `workflows/` are authoring sources, separate from
  the canonical catalog. Role blueprints for product, architecture, engineering,
  quality, security, delivery, operations, and technical writing are mapped to
  runtime specialists as primary or supporting guidance. Relevant reusable
  patterns are included in generated profiles and routed execution context.
  Skill and workflow-specific source assets are activated only when explicitly
  mapped and validated in `catalog/catalog.json`.
- `templates/agent-authoring/` contains reusable source templates and output
  patterns for agents, skills, workflows, prompts, findings, decisions, work
  items, vertical slices, tests, handoffs, rollouts, incidents, and asset evals.
  These authoring aids do not activate assets or alter the central catalog.
- `mcpee route --task ...` creates an inspectable local plan using workflow and
  specialist rules, relevant current memory, indexed source evidence, and
  available tools. Routing is deterministic and plan-only; it does not claim to
  invoke a Copilot agent or execute the recommended workflow. `mcpee run` now
  passes the selected workflow's ordered lifecycle stages to Copilot and asks it
  to report incomplete stages rather than treating the route as mere metadata.
- `mcpee explain --task ...` shows the selected workflow, specialist, skills,
  applicable patterns, playbooks, technical guidance, scorecards, evaluation cases,
  prompt examples, and each policy's declared enforcement mode. These assets
  are selected by task keywords and only pertinent guidance is sent to the
  runtime. Technical guides cite official/primary documentation and remain
  subordinate to the repository's actual versions and conventions.
- The migration playbook activates for migration/modernization requests and is
  included in the plan and runtime context; it does not authorize execution.
- Catalog scorecards are review rubrics, not automatic quality grades.
  Evaluation cases describe expected and forbidden behaviors; they are
  specifications for testing/evaluation, not evidence that an automated LLM
  grader ran. Prompt examples are references selected for relevant tasks.
- `mcpee explain` also reports whether the project approval hook is installed
  and describes the execution flow.
- The `preToolUse` hook gates supported tool calls for approval; it does not
  enforce naming, formatting, analyzers, or test outcomes. Style and quality
  rules become deterministic checks only when the project configures and runs
  its own formatter, analyzers, and tests. Generated policy instructions are
  guidance, not a substitute for those controls.
- `mcpee run --task ...` executes a routed request through the official
  `@github/copilot-sdk` runtime for the Copilot CLI agent. Before sending the
  task and selected routing context to GitHub Copilot, it requires explicit
  human approval. The project MCP server supplies that approval through a
  short-lived, token-authenticated loopback broker and the host's elicitation
  UI; direct terminal runs use the interactive terminal prompt. Each
  state-changing tool call,
  runtime permission, post-change sync, and validation step remains separately
  approval-gated. Approval events record decision metadata; separate SDK and
  hook events can contain redacted tool arguments and results, as described
  in the telemetry retention section.
  If the Copilot session fails after an approved file mutation, its failure
  event retains the changed project-relative paths and MCPEE still offers the
  normal separately approved sync and local validation before reporting the
  run as failed.
- `mcpee run --task ... --pack-context` packages only current
  routing evidence (indexed sources, CodeGraph symbol files, and current memory
  evidence) with the locally installed Repomix. It rejects out-of-project and
  symbolic-link paths, excludes sensitive paths, uses MCPEE's explicit safe
  Repomix configuration with secret scanning enabled, and enforces a 2 MiB
  package limit. The transfer confirmation lists the selected files and package
  size. In VS Code the approval appears in Chat's host UI; without an
  interactive terminal or approval broker, transfer is denied.
- Default grounded retrieval selects a compact set of original local evidence
  excerpts with semantic/lexical retrieval and includes
  project-relative source paths, normalized line ranges, and checksums. Its
  approximate token budget defaults to 4,000 and is configurable with
  `--context-tokens`. No model summarizes or rewrites the excerpts. Sources
  without fresh embeddings use lexical fallback; MCPEE still requires explicit
  human approval before sending the task and context to Copilot.
- `mcpee explain [--task ...]` reports the installed catalog, including patterns,
  playbooks, templates, technical guidance, scorecards, evaluation cases, and prompt
  examples, plus tool availability, knowledge state, and known capability gaps.
  With `--task`, it also reports the selected agent profile and available tools
  in the routing plan; it does not execute that plan.
- `mcpee rebuild` force-reprocesses supported local sources and regenerates
  derived indexes/documentation after interactive approval; it retains source
  files and persistent memory.
- `mcpee update` refreshes project integration files and the rendered catalog
  from the currently installed MCPEE package after interactive approval. It
  does not update the MCPEE npm package or install tools.
- `mcpee clean` removes only `.mcpee/cache/`, after interactive approval.
  Indexes, graphs, reports, memory, tasks, logs, and installed tools are kept.
- `mcpee sync` creates source-linked overview, component, architecture,
  API/data, infrastructure, testing, operations, and decision maps, plus a
  source catalog and a backward-compatible quality/operations summary in
  `docs/generated/`. These are evidence inventories; they do not claim runtime
  topology, test results, deployment health, or undocumented decisions.
- `mcpee evaluate --run <spec.json>` executes declared local checks from the
  tool allowlist and records their actual exit status with checksummed evidence.
  `mcpee learn propose` accepts only passing evaluations; a person must
  explicitly approve a proposal before it becomes persistent memory.
- `mcpee workflow run --spec <workflow.json>` runs a project-owned ordered list
  of allowlisted local checks, stops after the first failure by default, and
  writes a checksummed evidence report under `.mcpee/reports/workflows/`. The
  spec is executable configuration: review its tool names, arguments, and
  working directories before running it. Only verified read-only invocations
  run without a prompt; all other steps require an interactive, per-invocation
  approval and are blocked in noninteractive mode. This command does not invoke
  Copilot agents; use the generated `.github/prompts/` workflows in Copilot for
  that.
- `mcpee tasks list|approve|reject|start|complete` manages local follow-up
  tasks automatically proposed from failed or blocked evaluation checks.
  Proposals start pending; completion requires an approved and started task
  plus a fully passing evaluation over the same evidence paths and matching check.
- Copilot `preToolUse` hooks allow only recognized read-only tools/commands;
  other calls return `ask` in interactive CLI sessions and `deny` in known
  noninteractive/CI sessions. The hook accepts both Copilot and VS Code Local
  harness input and emits both decision formats. In VS Code, hook enforcement
  requires the Local harness, a trusted workspace, and hooks enabled; VS Code
  currently documents hooks as Preview. Tool names vary by harness, so unknown
  tools require approval. Keep the host's native permission controls enabled.

No remote trace exporter or external telemetry service is configured. MCPEE
records the events and payloads exposed by the active Copilot SDK and hooks,
with actual usage metrics only when emitted by the SDK; it does not fabricate
missing events or token counts. Detailed traces can be exported as local JSON
for later consumption by other tools.

The architecture describes the intended complete product, not a claim that all
of it is already implemented. After per-package approval, `init` installs pinned versions of MarkItDown (with
PDF, Word, PowerPoint, and Excel extras), CodeGraph, Graphify, and Repomix into isolated directories under
`.mcpee/tools/`; it does not modify the project's package manifest or
`node_modules`. MarkItDown is connected to document ingestion. CodeGraph is a
required part of the project installation: `init` must build its index and
`sync` must update it in `.codegraph/`. CodeGraph 1.6.2 accepts only a single
directory name in `CODEGRAPH_DIR`, so MCPEE uses its supported project-local
directory instead of nesting it under `.mcpee/`. Setup and routing fail closed
if the required package or index is unavailable. Both disable telemetry,
update checks, runtime fallback downloads, and background file watching. MCPEE adds
the CodeGraph and MCPEE stdio servers to the portable workspace `.mcp.json`
configuration read directly by Copilot harness sessions, without running
CodeGraph's global agent installer or changing user-level settings. Existing
MCP server entries are preserved; invalid config or conflicting
`mcpee-codegraph` or `mcpee` entries are reported rather than overwritten.
Host-normalized entries using `type: "stdio"`, equivalent absolute paths and
host tool-selection metadata are accepted without rewriting the configuration.
Different commands, arguments or environment values still require conflict
resolution; accepting equivalent paths does not authorize replacing user settings.
Existing projects with these servers still in `.vscode/mcp.json` should use
VS Code's MCP migration once. The MCPEE server uses the package location recorded locally by
`mcpee init`; it does not download or install packages when Chat starts.
The internal Copilot executor uses built-in tools after routing; the instruction
to invoke `mcpee_run` applies only to the outer chat, not recursively to that
executor. Context-transfer approval does not approve later actions or transfers.
The executor waits up to ten minutes for the complete tool-and-response loop,
rather than inheriting the SDK's one-minute default. If that limit expires,
MCPEE requests cancellation of the in-flight task and reports failure, including
any cancellation error; a timeout is not evidence of a completed inspection.
MCP calls wait at most 20 seconds before returning `status: "running"` and a
`run_id`. The chat agent must retrieve that same run using
`mcpee_run({run_id: "..."})` until the final response arrives, rather than start
the task again or ask the user to poll. This avoids depending on host-specific
long-request timeout settings. `cancel: true` with `run_id` cancels the run and
pending approval requests. Runs are held by the local MCP server; if it restarts,
an unknown ID is reported explicitly, not silently replayed.
The built-in `view`, `glob`, `grep`, and `rg` tools only read or search local files
and do not require per-file approval. Unknown tools and state-changing actions
still require approval. Inspection prefers these tools over a shell. The exact
PowerShell directory-listing forms `Get-ChildItem`, optionally with `-Force` and
`| Select-Object Name,Mode` (optionally `,Length`), are also read-only; arbitrary
paths, expressions, redirection, and additional commands are not allowed by this
exception.
CodeGraph's platform-specific optional npm package must be present locally.
When Graphify is installed in the project-local environment, `sync` invokes its
code-only extractor and records the local graph; an unavailable tool is reported
without being installed during sync. Repomix is used only when
`mcpee run --pack-context` is explicitly requested.
GitNexus is discovery-only and excluded from automatic installation: its
current PolyForm Noncommercial license is not suitable for general business
use without separate permission. The base MCPEE knowledge index is lexical;
optional local embedding profiles add semantic retrieval and remain separate
from CodeGraph's local symbol graph. MCPEE also builds a
unified evidence graph from source records, categories, normalized artifacts,
headings, and extracted code symbols with source line/checksum evidence. It also
records headers from every detected Markdown table, not just the first one. It
adds cross-source edges only
for explicit relative Markdown links whose target is another discovered source;
static local JavaScript/TypeScript imports and exports, plus uniquely resolved
Python imports (including backslash-continued statements). Each reference's
source line and checksum are retained as evidence. Ambiguous Python module names
are omitted. It also extracts explicit local
references from Terraform/Bicep modules, API `$ref` values, pipeline action
paths, configuration `$ref` values, and .NET solution/project/build-file
references when they resolve to discovered sources. Solution membership,
`ProjectReference` entries, and MSBuild imports retain source line and checksum
evidence. Explicit `workspace:`, `file:`, and `link:` dependencies in
`package.json` connect local packages and participate in transitive impact;
ambiguous or missing workspace package names are reported for review instead
of guessed. Missing explicit local references from supported schemas and
configuration, plus broken relative JavaScript/TypeScript imports, are also
exposed by `mcpee drift` with source line and checksum evidence. External
package imports are not treated as missing workspace files.
Test-file imports are labeled separately. For unambiguous, named JavaScript or
TypeScript imports in tests, `tests_imports_symbol` links the test file directly
to the uniquely declared symbol; it proves an import binding only, not that a
test executes or covers the symbol. Test names, assertions, dynamic loading,
and inferred semantic relationships do not create graph edges. SQL
`CREATE TABLE`/`REFERENCES` statements create evidence-linked table and foreign-key edges; ambiguous
unqualified table references are omitted. These are traceable source-derived
edges, not semantic inference; dynamic imports and unresolved references are
not inferred. Broader domain-specific extraction and semantic cross-source
graph edges remain unimplemented. Graph edges are deliberately conservative:
unresolved external imports and runtime-generated dependencies are not
presented as local relationships.

MCPEE requires the latest patch of the official Node.js LTS release to install
its Node tools. `init` checks the official release index and reports the
required global update; it does not replace or modify the system Node runtime.
If the current Node version is not exactly the latest LTS, Repomix installation
is blocked and `init` reports incomplete setup. Python has no official LTS
designation ([Python release lifecycle](https://devguide.python.org/versions/)),
so `init` uses `uv` to install and manage the latest stable Python
runtime under `.mcpee/tools/` and creates the isolated Graphify and MarkItDown
environments from it. The global Python is never modified. On first setup, a
Python 3.8+ interpreter with pip is needed only to bootstrap the pinned local
`uv` executable; setup reports an explicit blocker if that bootstrap runtime is
unavailable or incompatible.

`route` remains plan-only. `run` delegates an approved task to the Copilot SDK
and prioritizes explicitly named, already indexed project-relative source paths
ahead of lexical matches so their impact evidence is not lost in keyword noise.
Tasks naming more than ten indexed files must be narrowed; naming a path does
not authorize a mutation or bypass current-checksum and approval checks. `run`
gates tool actions through the session hook. If Copilot changes files, MCPEE
first asks separately to refresh source indexes and both graphs, then runs the
explicit validation spec at `.mcpee/workflows/<routed-workflow-id>.json`.
Every non-read-only validation step still requires per-call approval, and
generated documentation is refreshed only when that workflow passes. If the
spec is absent or validation fails, MCPEE reports the incomplete state and
leaves generated documentation untouched. The separate `workflow run` command
executes only its explicitly supplied local validation steps. SDK execution
also writes an eight-stage lifecycle report under `.mcpee/reports/runs/`; stage
status is derived from local routing, impact, session, validation, documentation,
and telemetry evidence, never from Copilot's self-reported checklist. In VS Code,
the hook policy applies only when its Local harness hooks are active; project
instructions and native host permissions remain important safeguards. `sync` generates evidence-bounded source maps for the target documentation
views, including extracted source headings, symbols, and structured-data headers
where available; these are source facts, not inferred
component descriptions or runtime relationships.
Failed/blocked checks create approval-gated follow-up
tasks. Repeated, identically evidenced passing workflow evaluations create a
review-only pattern proposal; other learning proposals can be authored
manually. No proposal enters durable memory until a human explicitly approves
it, and approval rechecks the source checksums.

Office/PDF conversion uses the isolated MarkItDown installation when available;
otherwise the source is reported as requiring that tool. Installing tools
downloads packages from npm/PyPI into the ignored MCPEE tool directory. `init`
does not install global tools, run global agent installers, or configure
user-level Copilot settings. When Graphify is installed in the project-local
tool environment, `sync` runs its `--code-only` extraction and stores the
owned graph under `.mcpee/graphs/graphify/`; it does not invoke a remote model.
When the tool is absent, sync reports Graphify as unavailable without installing
it. Graphify failures are reported and make sync/rebuild incomplete. Project-level CodeGraph MCP setup is
created only when its local package is available. Graphify's upstream
documentation describes optional model-based extraction and agent integrations;
MCPEE deliberately invokes only its local code-only mode and does not install
its global agent integration.

The current source pipeline is intentionally bounded: it processes UTF-8 text
files up to 2 MiB, ignores common generated/dependency folders and secret files,
never follows symbolic links, and does not install additional tools or send
source content to remote services. The processor catalog drives category
routing; normalized content and extracted metadata are checksum-linked in
traceability records, and sync rebuilds derived files whose checksums no longer
match when they are recognized as MCPEE-owned. Unrecognized artifacts are
preserved rather than overwritten. Plain-text logs and JSONL/NDJSON sources are
indexed as log evidence.
PDF and Office sources without the local
`markitdown` tool are inventoried as requiring it; they are not silently
discarded as processed content.
Generated normalized content contains heuristic redaction and must still be
handled as project data.

`init` performs a first local `sync` and builds the unified evidence graph and
required CodeGraph index, plus the Graphify AST graph when that approved,
project-local tool is available. Rerun `mcpee sync` after changing project sources, then use
`mcpee knowledge search --query "..."` for source-text evidence or
`mcpee knowledge graph --query "..."` for unified-graph, CodeGraph, and
available Graphify symbol evidence. Use `mcpee impact --path src/example.ts` to inspect indexed
source-code dependents and Markdown references before changing a file. Run
`mcpee sync` first when impact preflight reports missing or stale indexed
evidence; MCPEE blocks state-changing steps until the preflight is ready.
Run `mcpee tools list` to see local tool availability or
`mcpee tools validate --tool node` to execute a bounded version check.
Memory sources must be existing project-relative files. Evaluations require
project evidence and a JSON run specification, for example:

```json
{
  "task": "Verify the local Node runtime",
  "evidence": ["docs/runtime-requirements.md"],
  "checks": [
    { "label": "Node version", "tool": "node", "args": ["--version"] }
  ]
}
```

Local workflows use a similar project-owned specification, but name their
ordered steps explicitly. Run one with
`mcpee workflow run --spec .mcpee/workflows/verify-node.json`:

```json
{
  "workflow_id": "verify-node",
  "task": "Verify the local Node runtime",
  "evidence": ["docs/runtime-requirements.md"],
  "steps": [
    { "id": "node-version", "label": "Node version", "tool": "node", "args": ["--version"] }
  ]
}
```

The runner uses no shell, restricts working directories to the project, runs
steps in order, and stops on the first failure unless
`"continue_on_failure": true` is set. Review each workflow spec before running:
allowlisting a CLI does not make its arguments side-effect-free. To request
approval explicitly even for a recognized read-only check, set
`"requires_approval": true` on that check or workflow step.
Checks and workflow steps may set `timeout_ms` to an integer from 1000 to
900000 (15 minutes), for example `300000` for a build. The default remains
30000 (30 seconds). Executed check reports record the effective timeout;
exceeding it is a failure, never a passing validation.

## Development

Requires the latest Node.js LTS release for a complete tool installation. From
this directory:

```sh
npm test
npm run pack:check
npm run docs:check-links
npm run docs:check-official-links
npm run init
```

`pack:check` installs the packed tarball in a temporary offline consumer and
seeds its dependency lock from the project's exact lockfile, rather than
relying on cached registry metadata. It
exercises the installed CLI and initialization path with a deterministic local
CodeGraph contract fixture. It also verifies preservation of user-owned
instructions during refresh and local OTLP export from the installed package.
Tool version probes use a three-second default, except npm's heavier CLI
startup, which has a ten-second bound; callers can supply a specific timeout.
`docs:check-links` checks local Markdown targets,
anchors, and the technical-guidance scope/version/review metadata without
network access. `docs:check-official-links` is a separate network check for
official technical-guide URLs; it verifies HTTP reachability, not the technical
correctness of the referenced pages.

### Release acceptance boundaries

Passing the automated suite and installed-package checks is necessary, but
does not certify every capability in the target architecture. Release
acceptance also requires a real Copilot execution with recorded permissions,
the intended file change, post-change graph synchronization, a passing
declared check, and documentation refreshed only after that check passes.
Repeated passing workflow evidence may propose learning; adopting it remains
a separate human decision.

A controlled fixture proves harness orchestration, not the quality of the
application or its tests. An MCP SDK client exercises the real transport and
runtime but does not replace acceptance in the VS Code Chat UI. Likewise,
memory or knowledge included in the prompt proves delivery, not causal use;
lexical fallback is not a successful vector-embedding query. SDK cost values
without a declared unit are not a currency estimate.

Human specialist scorecards, live vector-profile checks and external cloud
operations require their own evidence before being claimed as validated.
Historical telemetry warnings remain findings: later redaction fixes do not
retroactively validate old records. A timeout, blocked stage, or missing
human evaluation must remain visible rather than be reported as overall
product acceptance.

To install MCPEE into a project without publishing:

```sh
node packages/cli/bin/mcpee.js init --project C:\path\to\project
```

Interactive initialization asks for an embeddings profile and applies it after
the initial local sync. To run non-interactively, select one explicitly with
`--embeddings bge-m3`, `--embeddings light`, or `--embeddings none`.

To enable transparent routing from ordinary Copilot Chat in a project:

```sh
node packages/cli/bin/mcpee.js init --project C:\path\to\project
```

Open the initialized project in VS Code and use Copilot Chat normally. The
workspace-scoped `mcpee_run` MCP tool is made available to Chat by the generated
instructions and MCP configuration. VS Code may ask once to trust the workspace
or start its MCP server; explicit approvals for external context transfer and
state-changing actions remain required.
