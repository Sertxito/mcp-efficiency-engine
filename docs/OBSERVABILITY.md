# Observability and evidence

MCPEE records what actually happened during routing, Copilot execution, hooks
and validation, so a person can review it afterwards. Everything stays local:
no collector, remote exporter or third-party observability service is
configured.

- [What is recorded](#what-is-recorded)
- [Inspect traces](#inspect-traces)
- [Summaries](#summaries)
- [Human review views](#human-review-views)
- [Usage and cost fields](#usage-and-cost-fields)
- [Retention and redaction](#retention-and-redaction)

## What is recorded

Routing, MCP, CLI, Copilot SDK and hook events are stored in
`.mcpee/telemetry/events/copilot.jsonl`. Each trace correlates, through
`trace_id` and `parent_id`:

- route selection and selected knowledge sources;
- prompt and context;
- SDK messages and usage;
- tool requests and results;
- data-transfer approval decisions;
- execution outcomes.

The SDK's `parentId` marks the chronologically preceding SDK event, not a
causal parent; MCPEE keeps it as `sdk_previous_event_id`. Explicit tool
completions are linked to their matching tool start. Uncorrelated events are
never silently joined into one request.

Each `mcpee run` also writes an eight-stage lifecycle report under
`.mcpee/reports/runs/`. Stage status comes from local routing, impact, session,
validation, documentation and telemetry evidence, never from Copilot's
self-reported checklist.

MCPEE records only the events and payloads exposed by the active SDK and hooks.
It does not fabricate missing events or token counts.

## Inspect traces

| Command | Result |
|---|---|
| `mcpee trace` | Lists captured events. Filter with `--trace-id`, `--session`, `--event` and `--limit <1-1000>`; print one sanitized event with `--show <id>`. |
| `mcpee trace --trace-id <id> --export reports/trace.json` | Exports the detailed, versioned event envelope locally. Validate it with [telemetry-export.schema.json](../schemas/telemetry-export.schema.json), whose items reference [telemetry-event.schema.json](../schemas/telemetry-event.schema.json). |
| `mcpee trace --trace-id <id> --otlp reports/trace-otlp.json` | Uses the OpenTelemetry SDK to write recorded events as parented spans in standard OTLP JSON. It omits prompts, responses, source text, tool arguments/results and reasoning. This is an on-demand reconstruction, not live auto-instrumentation, and nothing is sent over the network. |
| `mcpee telemetry validate [--json]` | Checks the recorded JSONL event schema, including redacted SDK and hook payloads, and whether stored events still satisfy the redaction rules. It reports `no-evidence` when no events exist and does not grade prompts or behavior. |

## Summaries

`mcpee observe [--json]` summarizes recorded routing fallbacks, impact
preflight, selected-context size, Copilot outcomes and durations, model usage
when the SDK emits it, tool durations, human tool approvals, tool results and
evaluation/workflow pass/fail counts. It makes no claims about unobserved host
activity.

- JSON output separates `outcomes.local_tools` (MCPEE CLI tools, including
  workflow checks and indexing) from `outcomes.tools` (SDK-reported tool
  timings), so nothing is counted twice.
- `mcpee observe --export reports/observe.json` writes a redacted aggregate
  report inside the project and refuses to overwrite an existing file.

## Human review views

Both views generate standalone HTML (in Spanish) with no server, scripts or
external requests. Both refuse to overwrite an existing file, so export to a
new filename after changes and review the file before sharing it.

**Validation view.** `mcpee observe --html .mcpee/reports/validation-view.html`
shows declared quality gates, missing check results, the latest attempt per
workflow against its history, check output and evidence, and chronological
event journeys. It reads live telemetry and workflow reports. It does not record
human approval, re-run checks, verify evidence freshness or certify release
readiness.

**Evidence library.** `mcpee view --html .mcpee/reports/evidence-view.html
[--report path/to/evidence.json]` covers the wider evidence:

- run lifecycle stages, evaluation and asset-rating reports, and other report
  snapshots;
- capability, tool and graph state;
- explicit memory, task decisions and learning proposals;
- request journeys, newest first: received task, selected route, context
  sources, recorded prompt, approvals, tool calls and final response;
- per-request consultations of the catalog, memory, lexical knowledge,
  grounding/vector retrieval and graphs, including empty selections,
  unavailable indexes and fallbacks.

Reading rules for the library:

- Missing evidence is shown explicitly and never treated as success. Runs
  recorded before these events existed are labeled uninstrumented, not unused.
- A recorded response is not a quality assessment. Guidance in a prompt is not
  an independently executed subagent, and an included memory is not proof of
  causal influence.
- Internal reasoning is not displayed.
- "Completo" means every currently declared technology check has a passing
  result. It does not cover unconfigured checks, model sessions, deployed
  infrastructure, response quality or human release approval.
- The library reads only known MCPEE locations. It rejects symlinked or
  malformed JSON and files over 1 MiB, stops above 500 JSON files and
  applies explicit display limits.

## Usage and cost fields

- Copilot `assistant.usage` values are recorded only when the installed SDK
  emits them. Missing usage is reported as unavailable, never estimated.
  Availability depends on the session and SDK version.
- Each request shows usage per call, cumulative input/output, cache read/write
  when available, and the last observed context window and limit. Cumulative
  input can repeat the same context across calls. It is neither a unique
  context size nor a bill.
- The SDK documents `assistant.usage.cost` as a premium-request multiplier,
  not tokens, AI credits or currency. MCPEE shows the reported value without
  claiming an account charge.
- Retrieved context and the MCPEE prompt show byte counts and
  character/4 token estimates, not tokenizer counts. Additional runtime
  instructions may not be included.

## Retention and redaction

- Detailed event records, including prompts, responses and available tool
  inputs and results, are kept locally for 30 days. They are pruned on
  telemetry reads and periodically on writes.
- Aggregated observations and explicitly exported reports do not expire
  automatically.
- Redaction removes common credential patterns and secret-like fields but
  cannot guarantee removal of every sensitive value. Restrict workspace
  access and review exports.
- Measurements that were already redacted cannot be recovered. Later redaction
  fixes do not retroactively validate older records.
