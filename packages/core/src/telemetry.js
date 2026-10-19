"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");

const TELEMETRY_FILE = ".mcpee/telemetry/events/copilot.jsonl";
const TELEMETRY_RETENTION_DAYS = 30;
const TELEMETRY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SECRET_KEY = /(?:password|secret|token|api[_-]?key|authorization|cookie|credential)/i;
const SAFE_METRIC_KEY = /^(?:(?:input|output|cache_read|cache_write)_tokens(?:_(?:total|events))?|(?:input|output)_token_events|(?:input|output|cacheRead|cacheWrite)Tokens|(?:(?:context|prompt)_)?estimated_tokens|max_tokens|current_tokens|token_limit|system_tokens|conversation_tokens|tool_definition_tokens|authorization_duration_ms)$/;
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{20,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^:\s/]+:[^@\s/]+@/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];
const telemetryContext = new AsyncLocalStorage();

function redactString(input) {
  let value = input;
  for (const pattern of SECRET_PATTERNS) value = value.replace(pattern, "[REDACTED]");
  let previous;
  do {
    previous = value;
    value = value.replace(
      /\b((?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*)["']?([^\s,;"'&]+)["']?/gi,
      "$1[REDACTED]",
    );
  } while (value !== previous);
  return value;
}

function redact(value, key = "") {
  if (SECRET_KEY.test(key) &&
      !(SAFE_METRIC_KEY.test(key) && (value === null || Number.isFinite(value) && value >= 0))) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) =>
      [childKey, redact(childValue, childKey)]));
  }
  return value;
}

function normalizeTimestamp(value) {
  const date = typeof value === "number" ? new Date(value < 1e12 ? value * 1000 : value)
    : (typeof value === "string" ? new Date(value) : new Date());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function withTelemetryContext(context, callback) {
  const current = telemetryContext.getStore() || {};
  return telemetryContext.run({
    trace_id: context.trace_id || current.trace_id || null,
    parent_id: context.parent_id || current.parent_id || null,
  }, callback);
}

function observeLayer(projectRoot, layer, operation, summarize = () => ({})) {
  const startedAt = Date.now();
  const started = recordEvent(projectRoot, {
    event_name: "context.layer.started",
    attributes: { layer },
  });
  try {
    const result = operation();
    recordEvent(projectRoot, {
      event_name: "context.layer.completed",
      parent_id: started.event_id,
      attributes: { layer, outcome: "success", duration_ms: Date.now() - startedAt, ...summarize(result) },
    });
    return result;
  } catch (error) {
    recordEvent(projectRoot, {
      event_name: "context.layer.completed",
      parent_id: started.event_id,
      attributes: { layer, outcome: "failure", duration_ms: Date.now() - startedAt },
      payload: { error: error.message },
    });
    throw error;
  }
}

function telemetryEventsPath(projectRoot) {
  return path.join(projectRoot, TELEMETRY_FILE);
}

function withTelemetryFileLock(projectRoot, callback) {
  const source = telemetryEventsPath(projectRoot);
  const lockPath = `${source}.lock`;
  fs.mkdirSync(path.dirname(source), { recursive: true });
  let descriptor;
  const deadline = Date.now() + 5000;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockPath, "wx");
      fs.writeSync(descriptor, `${process.pid}\n`);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 5 * 60 * 1000) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the local telemetry file lock: ${lockPath}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return callback(source);
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lockPath);
  }
}

function pruneExpiredTelemetryLocked(source, now = Date.now(), force = false) {
  if (!fs.existsSync(source)) return 0;
  const marker = `${source}.last-pruned`;
  if (!force && fs.existsSync(marker) &&
      now - fs.statSync(marker).mtimeMs < TELEMETRY_PRUNE_INTERVAL_MS) return 0;

  const lines = fs.readFileSync(source, "utf8").split(/\r?\n/);
  const cutoff = now - TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const retained = [];
  let removed = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
      validateEvent(event);
    } catch (error) {
      throw new Error(`Invalid telemetry JSONL at ${source}:${index + 1}: ${error.message}`);
    }
    if (Date.parse(event.timestamp) < cutoff) removed += 1;
    else retained.push(line);
  }
  if (removed) {
    const temporary = `${source}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, retained.length ? `${retained.join("\n")}\n` : "", "utf8");
    fs.renameSync(temporary, source);
  }
  fs.writeFileSync(marker, new Date(now).toISOString(), "utf8");
  return removed;
}

function recordEvent(projectRoot, event) {
  const eventName = event.event_name;
  if (typeof eventName !== "string" || eventName.length === 0) {
    throw new Error("Telemetry event requires a non-empty event_name");
  }
  const safeEvent = redact(event);
  const context = telemetryContext.getStore() || {};
  const record = {
    schema_version: 1,
    event_id: crypto.randomUUID(),
    timestamp: normalizeTimestamp(safeEvent.timestamp),
    source: safeEvent.source || "mcpee",
    event_name: safeEvent.event_name,
    source_event_id: safeEvent.source_event_id || null,
    session_id: safeEvent.session_id || null,
    trace_id: safeEvent.trace_id || context.trace_id || process.env.MCPEE_TRACE_ID || safeEvent.session_id || null,
    parent_id: safeEvent.parent_id || context.parent_id || process.env.MCPEE_PARENT_EVENT_ID || null,
    tool_name: safeEvent.tool_name || null,
    tool_call_id: safeEvent.tool_call_id || null,
    attributes: safeEvent.attributes || {},
  };
  if (safeEvent.payload !== undefined) record.payload = safeEvent.payload;
  const serialized = JSON.stringify(record);
  return withTelemetryFileLock(projectRoot, (destination) => {
    pruneExpiredTelemetryLocked(destination);
    fs.appendFileSync(destination, `${serialized}\n`, "utf8");
    return record;
  });
}

function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event) ||
      event.schema_version !== 1 ||
      typeof event.event_id !== "string" || !event.event_id ||
      typeof event.timestamp !== "string" || Number.isNaN(Date.parse(event.timestamp)) ||
      typeof event.source !== "string" || !event.source ||
      typeof event.event_name !== "string" || !event.event_name ||
      !["attributes", "payload"].some((key) =>
        event[key] && typeof event[key] === "object" && !Array.isArray(event[key]))) {
    throw new Error("event does not conform to telemetry-event schema version 1");
  }
  for (const key of [
    "source_event_id", "session_id", "trace_id", "parent_id", "tool_name", "tool_call_id",
  ]) {
    if (event[key] !== undefined && event[key] !== null && typeof event[key] !== "string") {
      throw new Error(`${key} must be a string or null`);
    }
  }
}

function readEvents(projectRoot) {
  return withTelemetryFileLock(projectRoot, (source) => {
    pruneExpiredTelemetryLocked(source, Date.now(), true);
    if (!fs.existsSync(source)) return [];
    return fs.readFileSync(source, "utf8").split(/\r?\n/).flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        const event = JSON.parse(line);
        validateEvent(event);
        return [event];
      } catch (error) {
        throw new Error(`Invalid telemetry JSONL at ${source}:${index + 1}: ${error.message}`);
      }
    });
  });
}

function evaluateTelemetryIntegrity(projectRoot) {
  const findings = [];
  let eventCount = 0;
  withTelemetryFileLock(projectRoot, (source) => {
    if (!fs.existsSync(source)) return;
    const lines = fs.readFileSync(source, "utf8").split(/\r?\n/);
    const cutoff = Date.now() - TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      eventCount += 1;
      let event;
      try {
        event = JSON.parse(line);
        validateEvent(event);
      } catch {
        findings.push({ check: "event-schema", line: index + 1, message: "Invalid JSON or telemetry event schema." });
        continue;
      }
      if (Date.parse(event.timestamp) < cutoff) {
        eventCount -= 1;
        continue;
      }
      if (JSON.stringify(redact(event)) !== JSON.stringify(event)) {
        findings.push({ check: "redaction", line: index + 1, message: "Event contains values that the telemetry redactor would remove." });
      }
    }
    if (!findings.some((finding) => finding.check === "event-schema")) {
      pruneExpiredTelemetryLocked(source, Date.now(), true);
    }
  });
  const schemaFailed = findings.some((finding) => finding.check === "event-schema");
  const redactionFailed = findings.some((finding) => finding.check === "redaction");
  const noEvidence = eventCount === 0;
  return {
    schema_version: 1,
    generated_by: "mcpee",
    status: noEvidence ? "no-evidence" : findings.length ? "failed" : "passed",
    event_count: eventCount,
    checks: [
      { id: "event-schema", status: noEvidence ? "no-evidence" : schemaFailed ? "failed" : "passed" },
      { id: "redaction", status: noEvidence ? "no-evidence" : redactionFailed ? "failed" : "passed" },
    ],
    findings,
  };
}

function writeLocalTelemetryEventsExport(projectRoot, relativePath, events) {
  if (!Array.isArray(events)) throw new Error("Telemetry event export requires an array of validated events.");
  for (const event of events) validateEvent(event);
  return writeLocalTelemetryExport(projectRoot, relativePath, {
    export_kind: "mcpee.telemetry.events",
    generated_at: new Date().toISOString(),
    retention_days: TELEMETRY_RETENTION_DAYS,
    event_count: events.length,
    events,
  });
}

function writeLocalReport(projectRoot, relativePath, contents) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error("Telemetry export path must be project-relative.");
  }
  const root = path.resolve(projectRoot);
  const normalized = relativePath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) ||
      normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(`Telemetry export path must stay inside the project: ${relativePath}`);
  }
  const destination = path.resolve(root, normalized);
  const relative = path.relative(root, destination);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)) {
    throw new Error(`Telemetry export path must stay inside the project: ${relativePath}`);
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Telemetry export path cannot follow a symbolic link: ${relativePath}`);
    }
  }
  if (fs.existsSync(destination)) {
    throw new Error(`Telemetry export will not overwrite an existing file: ${relativePath}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents, {
    encoding: "utf8",
    flag: "wx",
  });
  return destination;
}

function writeLocalTelemetryExport(projectRoot, relativePath, report) {
  const safeReport = redact({
    schema_version: 1,
    generated_by: "mcpee",
    ...report,
  });
  return writeLocalReport(projectRoot, relativePath, `${JSON.stringify(safeReport, null, 2)}\n`);
}

module.exports = {
  TELEMETRY_FILE,
  TELEMETRY_RETENTION_DAYS,
  withTelemetryContext,
  observeLayer,
  recordEvent,
  readEvents,
  pruneExpiredTelemetry: (projectRoot, now = Date.now()) =>
    withTelemetryFileLock(projectRoot, (source) => pruneExpiredTelemetryLocked(source, now, true)),
  evaluateTelemetryIntegrity,
  writeLocalTelemetryExport,
  writeLocalReport,
  writeLocalTelemetryEventsExport,
  redact,
};
