"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { recordEvent, redact } = require("../../core/src/telemetry");
const { addMemory } = require("../../memory-engine/src/memory");
const { readEvaluation } = require("../../evaluation-engine/src/evaluate");

const PROPOSALS_FILE = ".mcpee/learning/proposals.jsonl";
const LEARNING_KINDS = new Set(["pattern", "insight"]);

function appendLearningEvent(projectRoot, event) {
  const destination = path.join(projectRoot, PROPOSALS_FILE);
  const root = path.resolve(projectRoot);
  let current = root;
  for (const part of [".mcpee", "learning"]) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to write learning record through symbolic link: ${current}`);
    }
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.appendFileSync(destination, `${JSON.stringify({
    schema_version: 1,
    generated_by: "mcpee",
    ...event,
    timestamp: new Date().toISOString(),
  })}\n`, "utf8");
  recordEvent(projectRoot, {
    event_name: `learning.proposal.${event.action}`,
    attributes: { proposal_id: event.proposal_id, evaluation_id: event.evaluation_id || null, kind: event.kind || null },
  });
}

function listLearning(projectRoot) {
  const source = path.join(projectRoot, PROPOSALS_FILE);
  if (!fs.existsSync(source)) return [];
  const states = new Map();
  for (const [index, line] of fs.readFileSync(source, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`Corrupt learning JSONL at ${source}:${index + 1}: ${error.message}`);
    }
    if (event.generated_by !== "mcpee" || typeof event.proposal_id !== "string") {
      throw new Error(`Invalid learning record at ${source}:${index + 1}`);
    }
    if (event.action === "proposed") {
      if (states.has(event.proposal_id)) throw new Error(`Duplicate learning proposal: ${event.proposal_id}`);
      states.set(event.proposal_id, { ...event, status: "pending" });
      continue;
    }
    const previous = states.get(event.proposal_id);
    if (!previous || previous.status !== "pending" || !["approved", "rejected"].includes(event.action)) {
      throw new Error(`Invalid learning decision at ${source}:${index + 1}`);
    }
    states.set(event.proposal_id, {
      ...previous,
      status: event.action,
      decision_at: event.timestamp,
      memory_id: event.memory_id || null,
    });
  }
  return [...states.values()];
}

function proposeLearning(projectRoot, { evaluationId, kind, text }) {
  if (!LEARNING_KINDS.has(kind)) throw new Error(`Learning kind must be ${[...LEARNING_KINDS].join(" or ")}`);
  if (typeof text !== "string" || text.trim().length < 10) throw new Error("Learning proposal must be at least 10 characters");
  const evaluation = readEvaluation(projectRoot, evaluationId);
  if (evaluation.status !== "passed" || evaluation.checks.length === 0 ||
      evaluation.checks.some((check) => check.status !== "passed") || evaluation.evidence.length === 0) {
    throw new Error("Learning can only be proposed from a fully passed evaluation with source evidence");
  }
  const proposal = {
    proposal_id: crypto.randomUUID(),
    evaluation_id: evaluation.id,
    kind,
    text: redact(text),
    evidence: evaluation.evidence,
    action: "proposed",
  };
  appendLearningEvent(projectRoot, proposal);
  return { ...proposal, status: "pending" };
}

function evaluationSignature(evaluation) {
  if (evaluation.generated_by !== "mcpee" || evaluation.status !== "passed" ||
      !evaluation.workflow_id || !Array.isArray(evaluation.checks) || evaluation.checks.length === 0 ||
      evaluation.checks.some((check) => check.status !== "passed") ||
      !Array.isArray(evaluation.evidence) || evaluation.evidence.length === 0) return null;
  return JSON.stringify({
    workflow_id: evaluation.workflow_id,
    checks: evaluation.checks.map(({ label, tool }) => ({ label, tool })),
    evidence: evaluation.evidence.map(({ path: sourcePath, sha256 }) => ({ path: sourcePath, sha256 })),
  });
}

function proposeRecurringLearning(projectRoot, evaluationId, reportDirectory = ".mcpee/reports/evaluations") {
  const current = readEvaluation(projectRoot, evaluationId, reportDirectory);
  const signature = evaluationSignature(current);
  if (!signature) return [];
  const recurrenceKey = crypto.createHash("sha256").update(signature).digest("hex");
  if (listLearning(projectRoot).some((proposal) => proposal.recurrence_key === recurrenceKey)) return [];

  const reportsDirectory = path.join(projectRoot, reportDirectory);
  if (fs.lstatSync(reportsDirectory).isSymbolicLink()) {
    throw new Error(`Refusing to read learning evaluations through symbolic link: ${reportsDirectory}`);
  }
  const matchingEvaluations = [];
  for (const filename of fs.readdirSync(reportsDirectory).sort()) {
    const match = filename.match(/^([0-9a-f]{8}-[0-9a-f-]{27})\.json$/i);
    if (!match) continue;
    const filePath = path.join(reportsDirectory, filename);
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`Refusing to read learning evaluation through symbolic link: ${filePath}`);
    }
    const evaluation = readEvaluation(projectRoot, match[1], reportDirectory);
    if (evaluationSignature(evaluation) === signature) matchingEvaluations.push(evaluation);
  }
  if (matchingEvaluations.length < 2) return [];

  const proposal = {
    proposal_id: crypto.randomUUID(),
    evaluation_id: current.id,
    report_directory: reportDirectory,
    kind: "pattern",
    text: redact(
      `Workflow "${current.workflow_id}" passed the same ordered checks in ${matchingEvaluations.length} evaluations: ${current.checks.map((check) => `${check.label} (${check.tool})`).join("; ")}. Treat this as a candidate validation pattern and review it before reuse.`,
    ),
    evidence: current.evidence,
    origin: "recurring-workflow",
    recurrence_key: recurrenceKey,
    recurrence_count: matchingEvaluations.length,
    action: "proposed",
  };
  appendLearningEvent(projectRoot, proposal);
  return [{ ...proposal, status: "pending" }];
}

function decideLearning(projectRoot, proposalId, decision) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(proposalId)) throw new Error("Invalid learning proposal id");
  if (decision !== "approved" && decision !== "rejected") throw new Error("Learning decision must be approved or rejected");
  const proposal = listLearning(projectRoot).find((item) => item.proposal_id === proposalId);
  if (!proposal) throw new Error(`Learning proposal not found: ${proposalId}`);
  if (proposal.status !== "pending") throw new Error(`Learning proposal is already ${proposal.status}: ${proposalId}`);
  let memory = null;
  if (decision === "approved") {
    const evaluation = readEvaluation(projectRoot, proposal.evaluation_id, proposal.report_directory);
    if (evaluation.status !== "passed") throw new Error(`Evaluation no longer qualifies for learning: ${evaluation.id}`);
    memory = addMemory(projectRoot, {
      kind: proposal.kind,
      text: proposal.text,
      sources: proposal.evidence.map((item) => item.path),
      expectedSources: proposal.evidence,
      evaluationId: evaluation.id,
    });
  }
  appendLearningEvent(projectRoot, {
    proposal_id: proposalId,
    evaluation_id: proposal.evaluation_id,
    action: decision,
    ...(memory ? { memory_id: memory.id } : {}),
  });
  return { ...proposal, status: decision, memory_id: memory?.id || null };
}

module.exports = {
  PROPOSALS_FILE,
  proposeLearning,
  proposeRecurringLearning,
  decideLearning,
  listLearning,
};
