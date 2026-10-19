"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const RUN_REPORTS = ".mcpee/reports/runs";
const RUN_STAGES = [
  "understand",
  "analyze",
  "plan",
  "execute",
  "validate",
  "document",
  "observe",
  "learn",
];

function writeRunReport(projectRoot, { task, plan, execution, postChange = null, events = [] }) {
  if (typeof task !== "string" || !plan?.workflow?.id || !plan?.agent?.id ||
      (execution?.sessionId !== null && typeof execution?.sessionId !== "string") ||
      !Array.isArray(execution?.changedPaths) || !Array.isArray(events)) {
    throw new Error("Run report requires a task, routed plan, execution result, and telemetry events.");
  }
  const root = path.resolve(projectRoot);
  const directory = path.join(root, RUN_REPORTS);
  let current = root;
  for (const segment of RUN_REPORTS.split("/")) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to write run report through symbolic link: ${current}`);
    }
  }
  fs.mkdirSync(directory, { recursive: true });
  const executionEvent = events.find((event) =>
    event.event_name === "copilot.execution.completed" &&
    (execution.sessionId ? event.session_id === execution.sessionId : event.attributes?.task_sha256 ===
      crypto.createHash("sha256").update(task).digest("hex")));
  const traceEvents = executionEvent?.trace_id
    ? events.filter((event) => event.trace_id === executionEvent.trace_id)
    : [];
  const executionSucceeded = execution.outcome
    ? execution.outcome === "success"
    : executionEvent?.attributes?.outcome === "success";
  const hasChanges = execution.changedPaths.length > 0;
  const validationStatus = postChange?.validation?.status;
  const stages = [
    {
      id: "understand",
      status: "completed",
      evidence: [{ kind: "local_routing", workflow_id: plan.workflow.id, agent_id: plan.agent.id }],
    },
    {
      id: "analyze",
      status: plan.impact_preflight?.status === "ready" ? "completed" : "blocked",
      evidence: [{
        kind: "impact_preflight",
        status: plan.impact_preflight?.status || "unavailable",
        target_count: plan.impact_preflight?.targets?.length || 0,
      }],
      ...(plan.impact_preflight?.status === "ready" ? {} : {
        reason: plan.impact_preflight?.reason || "Impact evidence was not ready.",
      }),
    },
    {
      id: "plan",
      status: "completed",
      evidence: [{ workflow_id: plan.workflow.id, agent_id: plan.agent.id, skill_ids: plan.skills.map((skill) => skill.id) }],
    },
    {
      id: "execute",
      status: executionSucceeded ? "completed" : "failed",
      evidence: [{
        session_id: execution.sessionId,
        outcome: executionSucceeded ? "success" : "failure",
        changed_paths: execution.changedPaths,
      }],
    },
    {
      id: "validate",
      status: !hasChanges ? "not_applicable" :
        validationStatus === "passed" ? "completed" :
          validationStatus === "failed" ? "failed" : "blocked",
      evidence: postChange?.validation?.evaluation_id
        ? [{ evaluation_id: postChange.validation.evaluation_id, report: postChange.validation.report }]
        : [],
      ...(!hasChanges ? { reason: "The session did not report a file mutation." } :
        validationStatus === "passed" ? {} :
          { reason: postChange?.validation?.reason || "No validation result was recorded." }),
    },
    {
      id: "document",
      status: !hasChanges ? "not_applicable" :
        validationStatus === "passed" && postChange?.documentation?.refreshed ? "completed" : "blocked",
      evidence: postChange?.documentation?.files || [],
      ...(!hasChanges ? { reason: "No validated file changes required documentation refresh." } :
        validationStatus === "passed" && postChange?.documentation?.refreshed ? {} :
          { reason: "Documentation is refreshed only after the routed validation workflow passes." }),
    },
    {
      id: "observe",
      status: executionEvent ? "completed" : "blocked",
      evidence: [{
        telemetry_file: ".mcpee/telemetry/events/copilot.jsonl",
        trace_id: executionEvent?.trace_id || null,
        trace_event_count: traceEvents.length,
        session_event_count: typeof execution.sessionId === "string"
          ? events.filter((event) => event.session_id === execution.sessionId).length
          : executionEvent ? 1 : 0,
      }],
      ...(!executionEvent ? { reason: "No persisted Copilot execution event was found." } : {}),
    },
    {
      id: "learn",
      status: postChange?.learning?.proposal_ids?.length ? "completed" : "not_applicable",
      evidence: postChange?.learning?.proposal_ids || [],
      ...(!postChange?.learning?.proposal_ids?.length
        ? { reason: "No new evidence-backed learning proposal was generated." }
        : {}),
    },
  ];
  const hasFailure = stages.some((stage) => stage.status === "failed");
  const hasBlock = stages.some((stage) => stage.status === "blocked");
  const report = {
    schema_version: 1,
    generated_by: "mcpee",
    id: crypto.randomUUID(),
    task_sha256: crypto.createHash("sha256").update(task).digest("hex"),
    workflow_id: plan.workflow.id,
    agent_id: plan.agent.id,
    session_id: execution.sessionId,
    trace_id: executionEvent?.trace_id || null,
    trace_event_count: traceEvents.length,
    started_at: events.find((event) =>
      typeof execution.sessionId === "string" &&
      event.event_name === "copilot.execution.started" && event.session_id === execution.sessionId)?.timestamp || null,
    completed_at: new Date().toISOString(),
    status: hasFailure ? "failed" : hasBlock ? "blocked" : "completed",
    stages,
  };
  const destination = path.join(directory, `${report.id}.json`);
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
  return { ...report, file: `${RUN_REPORTS}/${report.id}.json` };
}

module.exports = { RUN_REPORTS, RUN_STAGES, writeRunReport };
