"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { recordEvent, redact } = require("./telemetry");

const TASKS_FILE = ".mcpee/tasks/events.jsonl";

function readTaskEvents(projectRoot) {
  const file = path.join(projectRoot, TASKS_FILE);
  if (!fs.existsSync(file)) return [];
  if (fs.lstatSync(file).isSymbolicLink()) {
    throw new Error(`Refusing to read task records through symbolic link: ${file}`);
  }
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      const event = JSON.parse(line);
      if (event.generated_by !== "mcpee" || typeof event.task_id !== "string" ||
          typeof event.action !== "string") throw new Error("invalid task event");
      return event;
    } catch (error) {
      throw new Error(`Corrupt task JSONL at ${file}:${index + 1}: ${error.message}`);
    }
  });
}

function appendTaskEvent(projectRoot, event) {
  let current = path.resolve(projectRoot);
  for (const part of [".mcpee", "tasks"]) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to write task record through symbolic link: ${current}`);
    }
  }
  const destination = path.join(projectRoot, TASKS_FILE);
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) {
    throw new Error(`Refusing to write task records through symbolic link: ${destination}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const record = {
    schema_version: 1,
    generated_by: "mcpee",
    ...event,
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(destination, `${JSON.stringify(record)}\n`, "utf8");
  recordEvent(projectRoot, {
    event_name: `task.${event.action}`,
    attributes: { task_id: event.task_id, evaluation_id: event.evaluation_id || null },
  });
  return record;
}

function listTasks(projectRoot) {
  const states = new Map();
  for (const event of readTaskEvents(projectRoot)) {
    const previous = states.get(event.task_id);
    if (event.action === "proposed") {
      if (previous) throw new Error(`Duplicate task proposal: ${event.task_id}`);
      states.set(event.task_id, { ...event, status: "pending" });
    } else {
      const nextStatus = {
        approved: "approved",
        rejected: "rejected",
        started: "in_progress",
        completed: "completed",
      }[event.action];
      if (!previous || !nextStatus) throw new Error(`Invalid task transition: ${event.action}`);
      const allowed = {
        approved: previous.status === "pending",
        rejected: previous.status === "pending",
        started: previous.status === "approved",
        completed: previous.status === "in_progress",
      }[event.action];
      if (!allowed) throw new Error(`Invalid task transition ${previous.status} -> ${nextStatus}: ${event.task_id}`);
      states.set(event.task_id, {
        ...previous,
        status: nextStatus,
        ...(event.action === "completed" ? { completion_evaluation_id: event.completion_evaluation_id } : {}),
      });
    }
  }
  return [...states.values()];
}

function proposeTasksFromEvaluation(projectRoot, evaluation) {
  if (!evaluation || evaluation.generated_by !== "mcpee" ||
      !Array.isArray(evaluation.checks) || !Array.isArray(evaluation.evidence)) {
    throw new Error("Task proposals require a valid MCPEE evaluation report");
  }
  const existing = listTasks(projectRoot);
  const proposals = [];
  for (const [checkIndex, check] of evaluation.checks.entries()) {
    if (!["failed", "blocked"].includes(check.status)) continue;
    if (existing.some((task) => task.evaluation_id === evaluation.id && task.check_index === checkIndex)) continue;
    const task = appendTaskEvent(projectRoot, {
      task_id: crypto.randomUUID(),
      action: "proposed",
      status: "pending",
      evaluation_id: evaluation.id,
      check_id: check.id || null,
      check_index: checkIndex,
      label: redact(check.label),
      tool: check.tool,
      diagnostic: redact(check.error || check.stderr_tail || `Check ${check.status}`),
      evidence: evaluation.evidence,
    });
    proposals.push({ ...task, status: "pending" });
  }
  return proposals;
}

function decideTask(projectRoot, taskId, decision) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(taskId)) throw new Error("Invalid task id");
  if (!["approved", "rejected"].includes(decision)) throw new Error("Task decision must be approved or rejected");
  const task = listTasks(projectRoot).find((item) => item.task_id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== "pending") throw new Error(`Task is already ${task.status}: ${taskId}`);
  appendTaskEvent(projectRoot, { task_id: taskId, action: decision, evaluation_id: task.evaluation_id });
  return { ...task, status: decision };
}

function startTask(projectRoot, taskId) {
  const task = listTasks(projectRoot).find((item) => item.task_id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== "approved") throw new Error(`Task must be approved before starting: ${taskId}`);
  appendTaskEvent(projectRoot, { task_id: taskId, action: "started", evaluation_id: task.evaluation_id });
  return { ...task, status: "in_progress" };
}

function completeTask(projectRoot, taskId, evaluationId) {
  const task = listTasks(projectRoot).find((item) => item.task_id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== "in_progress") throw new Error(`Task must be in progress before completion: ${taskId}`);
  const { readEvaluation } = require("../../evaluation-engine/src/evaluate");
  const evaluation = readEvaluation(projectRoot, evaluationId);
  const evidenceIdentity = (evidence) => evidence
    .map((item) => item.path)
    .sort()
    .join("\n");
  const evidenceMatches = evidenceIdentity(task.evidence) === evidenceIdentity(evaluation.evidence);
  const checkMatches = evaluation.checks.some((check) =>
    check.status === "passed" &&
    (task.check_id ? check.id === task.check_id : check.label === task.label) &&
    check.label === task.label && check.tool === task.tool);
  if (evaluation.status !== "passed" || !evidenceMatches || !checkMatches) {
    throw new Error("Task completion requires a fully passed evaluation with the same evidence and matching check");
  }
  appendTaskEvent(projectRoot, {
    task_id: taskId,
    action: "completed",
    evaluation_id: task.evaluation_id,
    completion_evaluation_id: evaluation.id,
  });
  return { ...task, status: "completed", completion_evaluation_id: evaluation.id };
}

module.exports = {
  TASKS_FILE,
  listTasks,
  proposeTasksFromEvaluation,
  decideTask,
  startTask,
  completeTask,
};
