"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { buildWorkflowHealth } = require("../packages/asset-audit/src/workflow-health");
const { recordEvent } = require("../packages/core/src/telemetry");
const { RUN_STAGES } = require("../packages/execution-engine/src/run-report");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-workflow-health-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const catalog = { workflows: [
    { id: "deliver-feature", agent: "backend" },
    { id: "refine-backlog", agent: "product" },
    { id: "deploy-with-approval", agent: "devops" },
  ] };
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(data));
  };
  const session = crypto.randomUUID(), trace = crypto.randomUUID(), task = "a".repeat(64);
  recordEvent(root, { event_name: "copilot.execution.completed", session_id: session, trace_id: trace,
    attributes: { task_sha256: task, outcome: "success" } });
  fs.writeFileSync(path.join(root, "checked.cjs"), "module.exports = true;\n");
  const evaluation = {
    schema_version: 1, generated_by: "mcpee", id: crypto.randomUUID(), status: "passed",
    checks: [{ status: "passed", exit_code: 0 }],
    evidence: [{ path: "checked.cjs", sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "checked.cjs"))).digest("hex") }],
  };
  const reportPath = `.mcpee/reports/workflows/${evaluation.id}.json`;
  write(reportPath, evaluation);
  const run = {
    schema_version: 1, generated_by: "mcpee", id: crypto.randomUUID(), workflow_id: "deliver-feature",
    session_id: session, trace_id: trace, task_sha256: task, status: "completed",
    completed_at: "2026-11-01T12:00:00Z",
    stages: RUN_STAGES.map(id => ({ id, status: "completed", evidence: id === "validate"
      ? [{ evaluation_id: evaluation.id, report: reportPath }] : [] })),
  };
  const runPath = `.mcpee/reports/runs/${run.id}.json`;
  write(runPath, run);
  return { root, catalog, write, run, runPath, evaluation, reportPath };
}

test("workflow health separates observed checked runs, authoring and untested catalogue flows", t => {
  const f = fixture(t);
  const authored = { ...f.run, id: crypto.randomUUID(), workflow_id: "refine-backlog",
    stages: f.run.stages.map(stage => stage.id === "validate"
      ? { ...stage, evidence: [{ kind: "source-bound-authoring", application_validation: "not-run" }] } : stage) };
  f.write(`.mcpee/reports/runs/${authored.id}.json`, authored);
  const health = buildWorkflowHealth(f.root, f.catalog);
  assert.deepEqual(health.summary, { workflows: 3, observed_checked: 1, evidence_incomplete: 1,
    not_run: 1, certified: 0, reports: 2, distinct_executions: 2 });
  assert.equal(health.status, "incomplete");
  assert.equal(health.workflows[1].runs[0].scope, "structured-authoring");
  assert.ok(health.workflows.every(workflow => !workflow.catalogue_certified));
  assert.match(health.interpretation, /not workflow certification/);
});

test("workflow health invalidates changed/missing artifacts, missing telemetry and nonpassing checks", t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, "checked.cjs"), "changed\n");
  assert.equal(buildWorkflowHealth(f.root, f.catalog).summary.observed_checked, 0);
  fs.unlinkSync(path.join(f.root, "checked.cjs"));
  assert.ok(buildWorkflowHealth(f.root, f.catalog).workflows[0].runs[0].gaps.includes("missing-artifact:checked.cjs"));
  f.evaluation.checks[0].exit_code = 1;
  f.write(f.reportPath, f.evaluation);
  assert.ok(buildWorkflowHealth(f.root, f.catalog).workflows[0].runs[0].gaps.includes("evaluation-not-passing-or-incomplete"));
  fs.unlinkSync(path.join(f.root, ".mcpee/telemetry/events/copilot.jsonl"));
  assert.ok(buildWorkflowHealth(f.root, f.catalog).workflows[0].runs[0].gaps.includes("matching-execution-telemetry-missing"));
});

test("workflow health keeps failures visible and deduplicates revised reports for the same execution", t => {
  const f = fixture(t);
  const newer = { ...f.run, id: crypto.randomUUID(), completed_at: "2026-11-01T12:01:00Z", status: "blocked" };
  f.write(`.mcpee/reports/runs/${newer.id}.json`, newer);
  const health = buildWorkflowHealth(f.root, f.catalog);
  assert.equal(health.summary.distinct_executions, 1);
  assert.equal(health.summary.reports, 2);
  assert.equal(health.workflows[0].runs[0].status, "blocked");
  assert.equal(health.summary.observed_checked, 0);
});

test("workflow health streams large telemetry and retains only relevant completion evidence", t => {
  const f = fixture(t);
  const filename = path.join(f.root, ".mcpee/telemetry/events/copilot.jsonl");
  const descriptor = fs.openSync(filename, "a");
  try {
    const line = `${JSON.stringify({ event_name: "unrelated.progress", note: "é".repeat(512) })}\n`;
    const batch = line.repeat(1024);
    for (let count = 0; count < 34; count++) fs.writeSync(descriptor, batch);
  } finally {
    fs.closeSync(descriptor);
  }
  assert.ok(fs.statSync(filename).size > 32 * 1024 * 1024);
  assert.equal(buildWorkflowHealth(f.root, f.catalog).summary.observed_checked, 1);
  fs.appendFileSync(filename, "{broken telemetry\n");
  assert.throws(() => buildWorkflowHealth(f.root, f.catalog), /Invalid workflow telemetry at line/);
});

test("workflow health rejects malformed reports and linked evidence rather than ignoring them", t => {
  const f = fixture(t);
  f.write(f.runPath, { ...f.run, stages: [] });
  assert.throws(() => buildWorkflowHealth(f.root, f.catalog), /Invalid workflow run evidence/);
  f.write(f.runPath, f.run);
  fs.mkdirSync(path.join(f.root, "real"));
  fs.writeFileSync(path.join(f.root, "real/checked.cjs"), "module.exports = true;\n");
  fs.symlinkSync(path.join(f.root, "real"), path.join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
  f.evaluation.evidence[0].path = "linked/checked.cjs";
  f.write(f.reportPath, f.evaluation);
  assert.throws(() => buildWorkflowHealth(f.root, f.catalog), /symbolic|symlink/i);
});

test("workflow catalogue CLI exposes all 31 workflows without invoking a model or claiming acceptance", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-workflow-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "../packages/cli/bin/mcpee.js"),
    "evaluate", "--suite", "workflow-catalog", "--project", root, "--json"], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.workflows, 31);
  assert.equal(report.summary.not_run, 31);
  assert.equal(report.summary.certified, 0);
  assert.deepEqual(fs.readdirSync(root), []);
});
