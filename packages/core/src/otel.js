"use strict";

const crypto = require("node:crypto");
const { ROOT_CONTEXT, trace, TraceFlags, SpanStatusCode } = require("@opentelemetry/api");
const { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } = require("@opentelemetry/sdk-trace-base");
const { writeLocalReport } = require("./telemetry");

function identifier(value, length) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, length);
}

function nanoTime([seconds, nanos]) {
  return (BigInt(seconds) * 1_000_000_000n + BigInt(nanos)).toString();
}

function attribute(value) {
  if (Array.isArray(value)) return { arrayValue: { values: value.map(attribute) } };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return Number.isInteger(value)
    ? { intValue: String(value) } : { doubleValue: value };
  return { stringValue: String(value) };
}

function spanAttributes(event) {
  const selected = {};
  for (const [key, value] of Object.entries(event.attributes || {})) {
    if (/^(?:layer|outcome|status|decision|workflow|agent|model|models|retrieval|context_mode|context_retrieval|consulted|fallback|duration_ms|selected_count|candidate_count|excluded_stale_count|vector_search_performed|vector_candidate_count|lexical_candidate_count|selected_vector_count|selected_lexical_count|embedding_profile|input_tokens|output_tokens|cache_read_tokens|cache_write_tokens|current_tokens|token_limit|context_bytes|context_source_count|context_estimated_tokens|prompt_bytes|prompt_estimated_tokens|estimated_tokens|max_tokens|cost|cost_unit|usage_calls)$/.test(key) &&
        (typeof value === "string" || typeof value === "boolean" || Number.isFinite(value) ||
          Array.isArray(value) && value.every(item => typeof item === "string"))) {
      selected[`mcpee.${key}`] = value;
    }
  }
  selected["mcpee.event_id"] = event.event_id;
  if (event.tool_name) selected["gen_ai.tool.name"] = event.tool_name;
  if (event.attributes?.model) selected["gen_ai.response.model"] = event.attributes.model;
  for (const [source, target] of [["input_tokens", "gen_ai.usage.input_tokens"], ["output_tokens", "gen_ai.usage.output_tokens"]]) {
    if (Number.isFinite(event.attributes?.[source])) selected[target] = event.attributes[source];
  }
  return selected;
}

async function buildOtlpTraceExport(events) {
  const exporter = new InMemorySpanExporter();
  let nextSpanId;
  let nextTraceId;
  const provider = new BasicTracerProvider({
    idGenerator: {
      generateTraceId: () => nextTraceId,
      generateSpanId: () => nextSpanId,
    },
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer("mcpee.recorded-evidence", "1.0.0");
  const groups = new Map();
  for (const event of events) {
    if (/reasoning/.test(event.event_name)) continue;
    const key = event.trace_id || event.session_id || `uncorrelated:${event.event_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  try {
    for (const [id, entries] of groups) {
      entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      nextTraceId = identifier(`trace:${id}`, 32);
      nextSpanId = identifier(`root:${id}`, 16);
      const root = tracer.startSpan("mcpee.recorded_request", {
        startTime: new Date(entries[0].timestamp),
        attributes: {
          "mcpee.source_trace_id": id,
          "mcpee.instrumentation": "materialized-from-recorded-events",
          "mcpee.content_exported": false,
        },
      }, ROOT_CONTEXT);
      const ends = new Map();
      const paired = new Set();
      for (const event of entries) {
        if (event.parent_id && /(?:\.completed|\.execution_complete)$/.test(event.event_name)) {
          const startNames = [
            event.event_name.replace(/\.completed$/, ".started").replace(/\.execution_complete$/, ".execution_start"),
            event.event_name.replace(/\.completed$/, ".requested"),
          ];
          const start = entries.find(item => item.event_id === event.parent_id &&
            startNames.includes(item.event_name));
          if (start) {
            ends.set(start.event_id, event);
            paired.add(event.event_id);
          }
        }
      }
      const included = new Set(entries.filter(event => !paired.has(event.event_id)).map(event => event.event_id));
      for (const event of entries) {
        if (paired.has(event.event_id)) continue;
        const end = ends.get(event.event_id);
        nextSpanId = identifier(`span:${id}:${event.event_id}`, 16);
        const parent = event.parent_id && included.has(event.parent_id)
          ? { traceId: root.spanContext().traceId, spanId: identifier(`span:${id}:${event.parent_id}`, 16), traceFlags: TraceFlags.SAMPLED }
          : root.spanContext();
        const span = tracer.startSpan(event.event_name, {
          startTime: new Date(event.timestamp),
          attributes: {
            ...spanAttributes(event), ...(end ? spanAttributes(end) : {}),
            "mcpee.event_id": event.event_id,
            ...(end ? { "mcpee.completion_event_id": end.event_id } : {}),
          },
        }, trace.setSpanContext(ROOT_CONTEXT, parent));
        const final = end || event;
        if (final.attributes?.outcome === "failure" || final.attributes?.result === "failure" ||
            final.attributes?.status === "failed" || /\.failed$/.test(final.event_name)) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          root.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end(new Date(final.timestamp));
      }
      root.end(new Date(entries.at(-1).timestamp));
    }
    await provider.forceFlush();
    return {
      resourceSpans: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "mcpee" } }] },
        scopeSpans: [{
          scope: { name: "mcpee.recorded-evidence", version: "1.0.0" },
          spans: exporter.getFinishedSpans().map(span => ({
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
            ...(span.parentSpanContext ? { parentSpanId: span.parentSpanContext.spanId } : {}),
            name: span.name,
            kind: span.kind + 1,
            startTimeUnixNano: nanoTime(span.startTime),
            endTimeUnixNano: nanoTime(span.endTime),
            attributes: Object.entries(span.attributes).map(([key, value]) => ({ key, value: attribute(value) })),
            status: { code: span.status.code },
          })),
        }],
      }],
    };
  } finally {
    await provider.shutdown();
  }
}

async function writeLocalOtlpExport(root, relativePath, events) {
  const report = await buildOtlpTraceExport(events);
  return writeLocalReport(root, relativePath, `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { buildOtlpTraceExport, writeLocalOtlpExport };
