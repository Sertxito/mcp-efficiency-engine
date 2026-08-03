const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { registerExecutionArtifact } = require("./artifact-registry");

function appendJsonl(filePath, event) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

function newExecutionIds() {
  return {
    executionId: `exec-${crypto.randomUUID()}`,
    traceId: `trace-${crypto.randomUUID()}`,
  };
}

function writeExecutionEvent(workspaceRoot, event) {
  const telemetryPath = path.join(workspaceRoot, ".mcpee", "telemetry", "executions.jsonl");
  appendJsonl(telemetryPath, event);
}

function writeExecutionReport(workspaceRoot, event) {
  const reportPath = path.join(workspaceRoot, ".mcpee", "artifacts", "reports", `${event.executionId}.json`);
  const dir = path.dirname(reportPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(reportPath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  registerExecutionArtifact(workspaceRoot, event, reportPath);
  return reportPath;
}

function summarizeTelemetry(workspaceRoot) {
  const telemetryPath = path.join(workspaceRoot, ".mcpee", "telemetry", "executions.jsonl");
  if (!fs.existsSync(telemetryPath)) {
    return {
      totalExecutions: 0,
      byCapability: {},
      byBoost: {},
      avgLatencyMs: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgGroundingScore: 0,
    };
  }

  const lines = fs
    .readFileSync(telemetryPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const byCapability = {};
  const byBoost = {};
  let totalLatency = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalGrounding = 0;
  for (const line of lines) {
    const parsed = JSON.parse(line);
    const capability = String(parsed.capability || "unknown");
    const boost = String(parsed.boost || "unknown");
    byCapability[capability] = (byCapability[capability] || 0) + 1;
    byBoost[boost] = (byBoost[boost] || 0) + 1;
    totalLatency += Number(parsed.latencyMs?.total || 0);
    totalInputTokens += Number(parsed.tokens?.rawRetrieved || 0);
    totalOutputTokens += Number(parsed.tokens?.llmOutput || 0);
    totalGrounding += Number(parsed.quality?.groundingScore || 0);
  }

  return {
    totalExecutions: lines.length,
    byCapability,
    byBoost,
    avgLatencyMs: Math.round(totalLatency / lines.length),
    avgInputTokens: Math.round(totalInputTokens / lines.length),
    avgOutputTokens: Math.round(totalOutputTokens / lines.length),
    avgGroundingScore: Number((totalGrounding / lines.length).toFixed(2)),
  };
}

module.exports = {
  newExecutionIds,
  writeExecutionEvent,
  writeExecutionReport,
  summarizeTelemetry,
};
