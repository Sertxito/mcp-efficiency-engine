"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { readProjectFile } = require("../../evaluation-engine/src/asset-evaluation");
const { RUN_STAGES } = require("../../execution-engine/src/run-report");

function completionEvents(root, sessions) {
  let filename = root;
  for (const part of ".mcpee/telemetry/events/copilot.jsonl".split("/")) {
    filename = path.join(filename, part);
    if (!fs.existsSync(filename)) return [];
    if (fs.lstatSync(filename).isSymbolicLink()) throw new Error("Workflow telemetry cannot follow symbolic links.");
  }
  const descriptor = fs.openSync(filename, "r");
  const events = [];
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error("Workflow telemetry must be a regular file.");
    const decoder = new StringDecoder("utf8"), buffer = Buffer.alloc(64 * 1024);
    let pending = "", line = 0;
    const consume = text => {
      pending += text;
      let end;
      while ((end = pending.indexOf("\n")) !== -1) {
        const value = pending.slice(0, end);
        pending = pending.slice(end + 1);
        line++;
        if (!value.trim()) continue;
        let event;
        try { event = JSON.parse(value); }
        catch (error) { throw new Error(`Invalid workflow telemetry at line ${line}: ${error.message}`); }
        if (!event || typeof event.event_name !== "string") throw new Error(`Invalid workflow telemetry event at line ${line}.`);
        if (event.event_name === "copilot.execution.completed" && sessions.has(event.session_id)) {
          if (events.length >= 10000) throw new Error("Workflow completion evidence exceeds 10000 events; no evidence was truncated.");
          events.push(event);
        }
      }
      if (pending.length > 8 * 1024 * 1024) throw new Error("Workflow telemetry record exceeds 8 MiB.");
    };
    let bytes;
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      consume(decoder.write(buffer.subarray(0, bytes)));
    }
    consume(`${decoder.end()}\n`);
  } finally {
    fs.closeSync(descriptor);
  }
  return events;
}

function buildWorkflowHealth(projectRoot, catalog) {
  const root = path.resolve(projectRoot);
  const directory = ".mcpee/reports/runs";
  const reports = [];
  if (fs.existsSync(path.join(root, directory))) {
    let current = root;
    for (const segment of directory.split("/")) {
      current = path.join(current, segment);
      if (fs.lstatSync(current).isSymbolicLink() || !fs.lstatSync(current).isDirectory()) {
        throw new Error("Workflow health requires real project-local run report directories.");
      }
    }
    const names = fs.readdirSync(path.join(root, directory)).filter(name => /^[a-f0-9-]{36}\.json$/i.test(name));
    if (names.length > 5000) throw new Error("Workflow health exceeds 5000 run reports; no evidence was silently truncated.");
    for (const name of names) {
      const relative = `${directory}/${name}`;
      const { contents } = readProjectFile(root, relative, 1024 * 1024, "Workflow run report");
      const report = JSON.parse(contents.toString("utf8"));
      if (report.generated_by !== "mcpee" || report.schema_version !== 1 || report.id !== name.slice(0, -5) ||
          !["completed", "blocked", "failed"].includes(report.status) || !Array.isArray(report.stages) ||
          report.stages.length !== RUN_STAGES.length || new Set(report.stages.map(stage => stage.id)).size !== RUN_STAGES.length ||
          !RUN_STAGES.every(id => report.stages.some(stage => stage.id === id)) ||
          report.stages.some(stage => !["completed", "blocked", "failed", "not_applicable"].includes(stage.status) ||
            !Array.isArray(stage.evidence)) ||
          !/^[a-f0-9]{64}$/.test(report.task_sha256) || typeof report.workflow_id !== "string" ||
          !Number.isFinite(Date.parse(report.completed_at))) {
        throw new Error(`Invalid workflow run evidence: ${relative}`);
      }
      reports.push({ ...report, path: relative });
    }
  }
  const events = completionEvents(root, new Set(reports.map(report => report.session_id).filter(Boolean)));
  const latest = new Map();
  for (const report of reports) {
    const key = `${report.workflow_id}:${report.session_id || report.id}:${report.task_sha256}`;
    const previous = latest.get(key);
    if (!previous || Date.parse(report.completed_at) > Date.parse(previous.completed_at)) latest.set(key, report);
  }
  const workflows = catalog.workflows.map(workflow => {
    const runs = [...latest.values()].filter(report => report.workflow_id === workflow.id).map(report => {
      const completion = events.find(event => report.session_id && event.session_id === report.session_id &&
        event.event_name === "copilot.execution.completed" &&
        event.attributes?.task_sha256 === report.task_sha256 &&
        (!report.trace_id || event.trace_id === report.trace_id));
      const validation = report.stages.find(stage => stage.id === "validate");
      const checks = validation.evidence.filter(evidence => evidence.evaluation_id);
      const gaps = [];
      if (!completion) gaps.push("matching-execution-telemetry-missing");
      if (report.status !== "completed") gaps.push(`run-${report.status}`);
      if (validation.status !== "completed") gaps.push("application-validation-not-completed");
      if (!checks.length) gaps.push("no-evaluated-application-checks");
      for (const evidence of checks) {
        if (!/^\.mcpee\/reports\/(?:workflows|evaluations)\/[a-f0-9-]{36}\.json$/i.test(evidence.report || "")) {
          throw new Error(`Invalid validation report reference in ${report.path}`);
        }
        if (!fs.existsSync(path.join(root, evidence.report))) {
          gaps.push("evaluation-report-missing");
          continue;
        }
        const { contents } = readProjectFile(root, evidence.report, 1024 * 1024, "Workflow validation report");
        const evaluation = JSON.parse(contents.toString("utf8"));
        if (evaluation.generated_by !== "mcpee" || evaluation.id !== evidence.evaluation_id ||
            evaluation.status !== "passed" || !Array.isArray(evaluation.checks) || !evaluation.checks.length ||
            evaluation.checks.some(check => check.status !== "passed" || check.exit_code !== 0) ||
            !Array.isArray(evaluation.evidence) || !evaluation.evidence.length) {
          gaps.push("evaluation-not-passing-or-incomplete");
          continue;
        }
        for (const file of evaluation.evidence) {
          if (typeof file.path !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid hashed workflow evidence.");
          if (!fs.existsSync(path.join(root, file.path))) {
            gaps.push(`missing-artifact:${file.path}`);
            continue;
          }
          const { contents } = readProjectFile(root, file.path, 32 * 1024 * 1024, "Workflow artifact evidence");
          if (crypto.createHash("sha256").update(contents).digest("hex") !== file.sha256) gaps.push(`stale-artifact:${file.path}`);
        }
      }
      if (completion && completion.attributes.outcome !== "success") gaps.push("execution-failed");
      return { report: report.path, status: report.status, scope: validation.evidence.some(item =>
        item.kind === "source-bound-authoring") ? "structured-authoring" : checks.length ? "evaluated-checks" : "unverified",
        current_checked_execution: gaps.length === 0, gaps: [...new Set(gaps)] };
    });
    return { id: workflow.id, agent: workflow.agent, status: runs.some(run => run.current_checked_execution)
      ? "observed-checked-execution" : runs.length ? "evidence-incomplete" : "not-run",
      catalogue_certified: false, runs };
  });
  return {
    schema_version: 1, generated_by: "mcpee", suite_id: "workflow-catalog", status: "incomplete",
    scope: "this-project-only",
    interpretation: "Observed checked executions are not workflow certification. Source-bound authoring, unit tests and mappings do not prove every workflow outcome, failure/boundary path or specialist capability.",
    summary: { workflows: workflows.length,
      observed_checked: workflows.filter(workflow => workflow.status === "observed-checked-execution").length,
      evidence_incomplete: workflows.filter(workflow => workflow.status === "evidence-incomplete").length,
      not_run: workflows.filter(workflow => workflow.status === "not-run").length,
      certified: 0, reports: reports.length, distinct_executions: latest.size },
    workflows,
    noncatalogue_workflows: [...new Set(reports.filter(report => !catalog.workflows.some(workflow =>
      workflow.id === report.workflow_id)).map(report => report.workflow_id))],
  };
}

module.exports = { buildWorkflowHealth };
