"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { recordEvent, redact } = require("../../core/src/telemetry");
const { sourceEvidence } = require("../../memory-engine/src/memory");
const { invokeTool } = require("../../tool-manager/src/tools");
const { assessToolInvocation } = require("../../core/src/approval");
const { proposeTasksFromEvaluation } = require("../../core/src/tasks");
const { SUPPORTED_TECHNOLOGIES } = require("../../copilot-renderer/src/project-capabilities");

const MAX_RUN_SPEC_BYTES = 256 * 1024;
const MAX_CHECKS = 20;

function resolveProjectFile(projectRoot, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()) throw new Error("A project-relative path is required");
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path must remain inside the project: ${relativePath}`);
  }
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) throw new Error(`Project path does not exist: ${relativePath}`);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Project path cannot follow symbolic links: ${relativePath}`);
  }
  return absolute;
}

function loadRunSpec(projectRoot, runSpecPath) {
  const absolute = resolveProjectFile(projectRoot, runSpecPath);
  if (!fs.statSync(absolute).isFile()) throw new Error("Run specification must be a file");
  const contents = fs.readFileSync(absolute);
  if (contents.length > MAX_RUN_SPEC_BYTES) throw new Error(`Run specification exceeds ${MAX_RUN_SPEC_BYTES} bytes`);
  let spec;
  try {
    spec = JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`Run specification must be valid JSON: ${error.message}`);
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("Run specification must be a JSON object");
  if (typeof spec.task !== "string" || spec.task.trim().length < 3) throw new Error("Run specification requires a task description");
  const workflowId = spec.workflow_id;
  if (workflowId !== undefined && (typeof workflowId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workflowId))) {
    throw new Error("workflow_id must be a lowercase kebab-case identifier");
  }
  const continueOnFailure = spec.continue_on_failure;
  if (continueOnFailure !== undefined && typeof continueOnFailure !== "boolean") {
    throw new Error("continue_on_failure must be a boolean");
  }
  const checks = workflowId ? spec.steps : spec.checks;
  const checkLabel = workflowId ? "steps" : "checks";
  if (!Array.isArray(checks) || checks.length === 0 || checks.length > MAX_CHECKS) {
    throw new Error(`Run specification requires 1-${MAX_CHECKS} ${checkLabel}`);
  }
  if (!Array.isArray(spec.evidence) || spec.evidence.length === 0) {
    throw new Error("Run specification requires at least one project evidence file");
  }
  const evidencePaths = [...new Set(spec.evidence)];
  if (evidencePaths.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error("Evidence entries must be non-empty project-relative paths");
  }
  const evidence = sourceEvidence(projectRoot, evidencePaths);
  const evidencePathSet = new Set(evidencePaths);
  const validatedChecks = checks.map((check, index) => {
    if (!check || typeof check !== "object" || Array.isArray(check)) throw new Error(`Check ${index + 1} must be an object`);
    if (check.id !== undefined && (typeof check.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(check.id))) {
      throw new Error(`Check ${index + 1} id must be a lowercase kebab-case identifier`);
    }
    if (check.requires_approval !== undefined && typeof check.requires_approval !== "boolean") {
      throw new Error(`Check ${index + 1} requires_approval must be a boolean`);
    }
    if (check.timeout_ms !== undefined &&
        (!Number.isInteger(check.timeout_ms) || check.timeout_ms < 1000 || check.timeout_ms > 900_000)) {
      throw new Error(`Check ${index + 1} timeout_ms must be an integer between 1000 and 900000`);
    }
    if (typeof check.label !== "string" || !check.label.trim()) throw new Error(`Check ${index + 1} requires a label`);
    if (typeof check.tool !== "string" || !check.tool.trim()) throw new Error(`Check ${index + 1} requires an allowlisted tool id`);
    if (!Array.isArray(check.args) || check.args.length > 128 ||
        check.args.some((arg) => typeof arg !== "string" || arg.length > 8192 || arg.includes("\0"))) {
      throw new Error(`Check ${index + 1} args must be an array of at most 128 strings`);
    }
    if (check.cwd !== undefined && typeof check.cwd !== "string") throw new Error(`Check ${index + 1} cwd must be a project-relative path`);
    const checkEvidence = check.evidence ?? [];
    if (!Array.isArray(checkEvidence) ||
        checkEvidence.some((entry) => typeof entry !== "string" || !evidencePathSet.has(entry))) {
      throw new Error(`Check ${index + 1} evidence must be selected from the run specification's evidence paths`);
    }
    const coversTechnologies = check.covers_technologies ?? [];
    if (!Array.isArray(coversTechnologies) ||
        new Set(coversTechnologies).size !== coversTechnologies.length ||
        coversTechnologies.some((technology) => !SUPPORTED_TECHNOLOGIES.includes(technology)) ||
        (coversTechnologies.length > 0 && checkEvidence.length === 0)) {
      throw new Error(`Check ${index + 1} covers_technologies must use supported IDs and include check-specific evidence`);
    }
    return {
      ...(check.id ? { id: check.id } : {}),
      label: redact(check.label.trim()),
      tool: check.tool,
      args: check.args,
      cwd: check.cwd || ".",
      ...(check.timeout_ms !== undefined ? { timeout_ms: check.timeout_ms } : {}),
      ...(checkEvidence.length ? { evidence: checkEvidence } : {}),
      ...(coversTechnologies.length ? { covers_technologies: coversTechnologies } : {}),
      requires_approval: check.requires_approval === true,
    };
  });
  return {
    task: redact(spec.task),
    workflow_id: workflowId || null,
    continue_on_failure: workflowId ? continueOnFailure === true : true,
    checks: validatedChecks,
    evidence,
  };
}

function boundedOutput(value) {
  const safe = redact(value || "");
  const max = 2048;
  return safe.length > max ? `[truncated]\n${safe.slice(-max)}` : safe;
}

function writeReport(projectRoot, report, reportDirectory = ".mcpee/reports/evaluations") {
  const directory = path.join(projectRoot, reportDirectory);
  let current = path.resolve(projectRoot);
  for (const part of reportDirectory.split(/[\\/]/)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to write evaluation through symbolic link: ${current}`);
    }
  }
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `${report.id}.json`);
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
  return destination;
}

async function executeRunSpec(projectRoot, spec, options = {}) {
  const root = path.resolve(projectRoot);
  const startedAt = new Date().toISOString();
  const checks = [];
  let stopped = false;
  for (const check of spec.checks) {
    if (stopped) {
      checks.push({
        ...(check.id ? { id: check.id } : {}),
        label: check.label,
        tool: check.tool,
        cwd: check.cwd,
        ...(check.evidence ? { evidence: check.evidence } : {}),
        ...(check.covers_technologies ? { covers_technologies: check.covers_technologies } : {}),
        status: "skipped",
        exit_code: null,
        error: "Skipped after an earlier workflow step failed.",
        stdout_tail: "",
        stderr_tail: "",
        duration_ms: 0,
      });
      continue;
    }
    const approval = assessToolInvocation(check.tool, check.args, {
      requiresApproval: check.requires_approval,
    });
    if (spec.workflow_id && approval.requiresApproval &&
        options.impactPreflight?.status !== "ready") {
      const reason = options.impactPreflight?.reason ||
        "Impact analysis is required before a state-changing workflow step.";
      recordEvent(root, {
        event_name: "action.blocked",
        tool_name: check.tool,
        attributes: {
          workflow_id: spec.workflow_id,
          step_id: check.id || null,
          action: "workflow step",
          decision: "blocked",
          reason,
        },
      });
      checks.push({
        ...(check.id ? { id: check.id } : {}),
        label: check.label,
        tool: check.tool,
        cwd: check.cwd,
        ...(check.evidence ? { evidence: check.evidence } : {}),
        ...(check.covers_technologies ? { covers_technologies: check.covers_technologies } : {}),
        status: "blocked",
        exit_code: null,
        error: `Impact preflight required: ${reason}`,
        stdout_tail: "",
        stderr_tail: "",
        duration_ms: 0,
      });
      stopped = true;
      continue;
    }
    if (approval.requiresApproval) {
      const approved = await options.approveStep?.({
        ...check,
        reason: approval.reason,
        action: spec.workflow_id ? "workflow step" : "evaluation check",
      });
      recordEvent(root, {
        event_name: approved ? "action.approved" : "action.blocked",
        tool_name: check.tool,
        attributes: {
          workflow_id: spec.workflow_id || null,
          step_id: check.id || null,
          action: spec.workflow_id ? "workflow step" : "evaluation check",
          decision: approved ? "approved" : "denied",
          reason: approval.reason,
        },
      });
      if (!approved) {
        const outcome = {
          ...(check.id ? { id: check.id } : {}),
          label: check.label,
          tool: check.tool,
          cwd: check.cwd,
          ...(check.evidence ? { evidence: check.evidence } : {}),
          ...(check.covers_technologies ? { covers_technologies: check.covers_technologies } : {}),
          status: "blocked",
          exit_code: null,
          error: `Human approval required: ${approval.reason}`,
          stdout_tail: "",
          stderr_tail: "",
          duration_ms: 0,
        };
        checks.push(outcome);
        stopped = true;
        continue;
      }
    }
    let result;
    try {
      result = invokeTool(root, check.tool, check.args, {
        cwd: check.cwd,
        timeoutMs: check.timeout_ms,
      });
    } catch (error) {
      result = { status: "failed", error: error.message, exit_code: null, stdout: "", stderr: "" };
    }
    const outcome = {
      ...(check.id ? { id: check.id } : {}),
      label: check.label,
      tool: check.tool,
      cwd: check.cwd,
      ...(check.evidence ? { evidence: check.evidence } : {}),
      ...(check.covers_technologies ? { covers_technologies: check.covers_technologies } : {}),
      status: result.status === "success" ? "passed" : "failed",
      exit_code: result.exit_code,
      ...(result.error ? { error: redact(result.error) } : {}),
      stdout_tail: boundedOutput(result.stdout),
      stderr_tail: boundedOutput(result.stderr),
      duration_ms: result.duration_ms ?? 0,
      timeout_ms: check.timeout_ms ?? 30_000,
    };
    checks.push(outcome);
    if (outcome.status !== "passed" &&
        (!spec.continue_on_failure || outcome.status === "blocked")) stopped = true;
  }
  const report = {
    schema_version: 1,
    generated_by: "mcpee",
    id: crypto.randomUUID(),
    ...(spec.workflow_id ? { workflow_id: spec.workflow_id } : {}),
    task: spec.task,
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    evidence: spec.evidence,
    ...(spec.workflow_id && options.impactPreflight
      ? { impact_preflight: options.impactPreflight }
      : {}),
    checks,
  };
  const file = writeReport(root, report, options.reportDirectory);
  const taskProposals = proposeTasksFromEvaluation(root, report);
  recordEvent(root, {
    event_name: options.eventName || "evaluation.completed",
    attributes: {
      evaluation_id: report.id,
      status: report.status,
      check_count: checks.length,
      passed_checks: checks.filter((check) => check.status === "passed").length,
      failed_checks: checks.filter((check) => check.status === "failed").length,
      blocked_checks: checks.filter((check) => check.status === "blocked").length,
      duration_ms: Math.max(0, Date.parse(report.completed_at) - Date.parse(startedAt)),
      evidence_count: report.evidence.length,
    },
  });
  const { proposeRecurringLearning } = require("../../learning-engine/src/learning");
  const learningProposals = proposeRecurringLearning(root, report.id, options.reportDirectory);
  return {
    ...report,
    task_proposals: taskProposals,
    learning_proposals: learningProposals,
    file: path.relative(root, file).split(path.sep).join("/"),
  };
}

async function evaluateExecution(projectRoot, runSpecPath, options = {}) {
  const root = path.resolve(projectRoot);
  return executeRunSpec(root, loadRunSpec(root, runSpecPath), options);
}

function readEvaluation(projectRoot, evaluationId, reportDirectory = ".mcpee/reports/evaluations") {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(evaluationId)) throw new Error("Invalid evaluation id");
  if (![".mcpee/reports/evaluations", ".mcpee/reports/workflows"].includes(reportDirectory)) {
    throw new Error(`Unsupported evaluation report directory: ${reportDirectory}`);
  }
  const relative = `${reportDirectory}/${evaluationId}.json`;
  const filePath = resolveProjectFile(projectRoot, relative);
  const report = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (report.generated_by !== "mcpee" || report.id !== evaluationId ||
      !Array.isArray(report.evidence) || !Array.isArray(report.checks)) {
    throw new Error(`Invalid or non-MCPEE evaluation report: ${evaluationId}`);
  }
  return report;
}

module.exports = {
  evaluateExecution,
  executeRunSpec,
  loadRunSpec,
  readEvaluation,
  MAX_RUN_SPEC_BYTES,
  MAX_CHECKS,
};
