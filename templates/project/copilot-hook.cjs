#!/usr/bin/env node
// MCPEE-MANAGED-RUNTIME v1
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { assessCopilotToolCall } = require("./approval-policy.cjs");

const MAX_INPUT_BYTES = 1024 * 1024;
const SECRET_KEY = /(?:password|secret|token|api[_-]?key|authorization|cookie|credential)/i;
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{20,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

function redact(value, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    let output = value;
    for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, "[REDACTED]");
    return output.replace(
      /\b((?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*)["']?([^\s,;"'&]+)["']?/gi,
      "$1[REDACTED]",
    );
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) =>
      [childKey, redact(childValue, childKey)]));
  }
  return value;
}

function readInput() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    process.stdin.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_INPUT_BYTES) {
        reject(new Error(`Copilot hook input exceeds ${MAX_INPUT_BYTES} bytes`));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function pickString(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0) || null;
}

function normalizeTimestamp(value) {
  let date;
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const numeric = Number(value);
    date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  } else {
    date = new Date(value ?? Date.now());
  }
  if (Number.isNaN(date.getTime())) throw new Error("Invalid hook event timestamp");
  return date.toISOString();
}

async function main() {
  const eventName = process.argv[2];
  if (!eventName) throw new Error("Missing hook event name");
  const raw = await readInput();
  let input;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error.message}`);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Expected a JSON object as hook input");
  }

  const payload = redact(input);
  const serializedPayload = JSON.stringify(payload);
  const event = {
    schema_version: 1,
    event_id: crypto.randomUUID(),
    source_event_id: pickString(input.eventId, input.event_id, input.id),
    timestamp: normalizeTimestamp(input.timestamp ?? input.ts),
    source: "github-copilot-hook",
    event_name: eventName,
    session_id: pickString(input.sessionId, input.session_id, input.session?.id, input.session?.sessionId),
    trace_id: pickString(input.sessionId, input.session_id, input.session?.id, input.session?.sessionId),
    parent_id: pickString(input.parentId, input.parent_id),
    tool_name: pickString(input.toolName, input.tool_name),
    tool_call_id: pickString(input.toolCallId, input.tool_call_id, input.tool_use_id, input.callId),
    payload: Buffer.byteLength(serializedPayload, "utf8") > MAX_INPUT_BYTES / 2
      ? {
        truncated: true,
        serialized_bytes: Buffer.byteLength(serializedPayload, "utf8"),
        sha256: crypto.createHash("sha256").update(serializedPayload).digest("hex"),
        event_fields: Object.keys(payload),
      }
      : payload,
  };
  const decision = eventName === "preToolUse"
    ? assessCopilotToolCall(input, {
      nonInteractive: process.env.MCPEE_NON_INTERACTIVE === "1" ||
        process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true",
    })
    : null;
  if (decision) {
    event.permission_decision = decision.decision;
    event.permission_reason = decision.reason;
  }
  const destination = path.join(process.env.MCPEE_PROJECT_ROOT || process.cwd(),
    ".mcpee", "telemetry", "events", "copilot.jsonl");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.appendFileSync(destination, `${JSON.stringify(event)}\n`, "utf8");
  if (decision) {
    process.stdout.write(`${JSON.stringify(preToolUseDecision(decision))}\n`);
  }
}

function preToolUseDecision(decision) {
  return {
    permissionDecision: decision.decision,
    permissionDecisionReason: decision.reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.decision,
      permissionDecisionReason: decision.reason,
    },
  };
}

main().catch((error) => {
  if (process.argv[2] === "preToolUse") {
    process.stdout.write(`${JSON.stringify(preToolUseDecision({
      decision: "deny",
      reason: "MCPEE could not verify this tool call; it was denied to preserve the human-approval policy.",
    }))}\n`);
    process.stderr.write(`[mcpee] Copilot hook capture failed: ${error.message}\n`);
    return;
  }
  process.stderr.write(`[mcpee] Copilot hook capture failed: ${error.message}\n`);
  process.exitCode = 1;
});
