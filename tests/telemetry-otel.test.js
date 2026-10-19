"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { redact, recordEvent, readEvents, observeLayer, withTelemetryContext, evaluateTelemetryIntegrity } = require("../packages/core/src/telemetry");
const { buildOtlpTraceExport, writeLocalOtlpExport } = require("../packages/core/src/otel");

test("redaction preserves only numeric telemetry measures, never token-shaped credentials", () => {
  const metrics = {
    input_tokens: 123, output_tokens: 5, inputTokens: 12, cacheReadTokens: 6,
    context_estimated_tokens: 40, prompt_estimated_tokens: 100,
    estimated_tokens: 0, max_tokens: 4000, current_tokens: 80, token_limit: 128000,
    cache_read_tokens: 3, authorization_duration_ms: 10,
    input_token_events: 4, output_token_events: 4, input_tokens_total: 1234,
  };
  assert.deepEqual(redact(metrics), metrics);
  for (const key of ["token", "GITHUB_TOKEN", "api_key", "authorization", "context_estimated_tokens"]) {
    assert.equal(redact({ [key]: "sensitive-value" })[key], "[REDACTED]");
  }
  assert.equal(redact({ estimated_tokens: -1 }).estimated_tokens, "[REDACTED]");
  assert.equal(redact({ input_tokens: { secret: "sensitive" } }).input_tokens, "[REDACTED]");
});

test("layer evidence records empty consultations and failures rather than claiming use", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-layer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  withTelemetryContext({ trace_id: "layer-trace" }, () => {
    assert.deepEqual(observeLayer(root, "memory", () => [], result => ({
      consulted: true, selected_count: result.length,
    })), []);
    assert.throws(() => observeLayer(root, "knowledge.lexical", () => {
      throw new Error("index unavailable");
    }), /index unavailable/);
  });
  const events = readEvents(root);
  assert.equal(events.length, 4);
  assert.equal(events[1].attributes.selected_count, 0);
  assert.equal(events[1].attributes.consulted, true);
  assert.equal(events[1].parent_id, events[0].event_id);
  assert.equal(events[3].attributes.outcome, "failure");
  assert.equal(events.every(event => event.trace_id === "layer-trace"), true);
});

test("redaction remains stable across nested quoted tool output and persisted validation", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-redaction-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const value of ["token = [REDACTED]tail')", "token = 'private-value')", 'API_KEY=\\"private-value\\"']) {
    const safe = redact(value);
    assert.equal(redact(safe), safe);
    assert.doesNotMatch(safe, /private-value|tail/);
    recordEvent(root, { event_name: "copilot.tool.completed", payload: { textResultForLlm: value } });
  }
  assert.equal(evaluateTelemetryIntegrity(root).status, "passed");
});

test("OpenTelemetry SDK materializes correlated OTLP spans locally without prompt content", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-otel-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const start = recordEvent(root, {
    event_name: "context.layer.started", trace_id: "test-request", timestamp: "2026-10-15T12:00:00Z",
    attributes: { layer: "memory" }, payload: { task: "PRIVATE_PROMPT" },
  });
  const finish = recordEvent(root, {
    event_name: "context.layer.completed", trace_id: "test-request", parent_id: start.event_id,
    timestamp: "2026-10-15T12:00:01Z",
    attributes: { layer: "memory", outcome: "failure", consulted: true, selected_count: 0 },
    payload: { error: "PRIVATE_ERROR" },
  });
  recordEvent(root, {
    event_name: "copilot.sdk.assistant.usage", trace_id: "test-request",
    timestamp: "2026-10-15T12:00:02Z", parent_id: start.event_id,
    attributes: { input_tokens: 42, output_tokens: 7, model: "test-model" },
    payload: { content: "PRIVATE_RESPONSE" },
  });
  recordEvent(root, {
    event_name: "copilot.sdk.assistant.reasoning", trace_id: "test-request",
    payload: { content: "PRIVATE_REASONING" },
  });
  const events = [start, finish, ...readEvents(root).slice(2)];
  const report = await buildOtlpTraceExport(events);
  const spans = report.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans.length, 3);
  assert.equal(new Set(spans.map(span => span.traceId)).size, 1);
  for (const span of spans) {
    assert.match(span.traceId, /^[a-f0-9]{32}$/);
    assert.match(span.spanId, /^[a-f0-9]{16}$/);
    assert.ok(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano));
    if (span.parentSpanId) assert.ok(spans.some(parent => parent.spanId === span.parentSpanId));
  }
  const layer = spans.find(span => span.name === "context.layer.started");
  assert.equal(BigInt(layer.endTimeUnixNano) - BigInt(layer.startTimeUnixNano), 1_000_000_000n);
  assert.equal(layer.status.code, 2);
  const usage = spans.find(span => span.name === "copilot.sdk.assistant.usage");
  assert.equal(usage.attributes.find(a => a.key === "gen_ai.usage.input_tokens").value.intValue, "42");
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|reasoning/);
  const exportPath = await writeLocalOtlpExport(root, "traces/otlp.json", events);
  assert.ok(JSON.parse(fs.readFileSync(exportPath, "utf8")).resourceSpans.length);
  await assert.rejects(writeLocalOtlpExport(root, "traces/otlp.json", events), /overwrite/);
  await assert.rejects(writeLocalOtlpExport(root, "../outside.json", events), /inside the project/);
});

test("trace CLI exports standard OTLP without mixing in the private JSONL envelope", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-otlp-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  recordEvent(root, { event_name: "mcp.tool.started", trace_id: "wanted", payload: { task: "PRIVATE" } });
  recordEvent(root, { event_name: "mcp.tool.started", trace_id: "excluded" });
  execFileSync(process.execPath, [
    path.resolve(__dirname, "../packages/cli/bin/mcpee.js"), "trace", "--project", root,
    "--trace-id", "wanted", "--otlp", "traces.json",
  ], { stdio: "pipe" });
  const report = JSON.parse(fs.readFileSync(path.join(root, "traces.json"), "utf8"));
  assert.equal(report.schema_version, undefined);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|excluded/);
  assert.equal(report.resourceSpans[0].scopeSpans[0].spans.length, 2);
});
