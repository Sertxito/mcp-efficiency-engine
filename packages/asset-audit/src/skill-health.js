"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPORT_DIRECTORIES = [
  ".mcpee/reports/asset-evaluations",
  ".mcpee/reports/evaluations",
  ".mcpee/reports/workflows",
];
const MAX_REPORTS = 5000;
const MAX_REPORT_BYTES = 1024 * 1024;

function isWithinRoot(root, absolute) {
  const relative = path.relative(root, absolute);
  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function hasSymlinkInPath(root, relative) {
  let current = root;
  for (const part of relative.split(/[\\/]/)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) return false;
    if (fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function readReports(root) {
  const reports = [];
  for (const relative of REPORT_DIRECTORIES) {
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory)) continue;
    if (hasSymlinkInPath(root, relative)) {
      throw new Error(`Refusing to read evaluation reports through a symbolic link: ${relative}`);
    }
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Refusing to read evaluation reports through a symbolic link: ${relative}`);
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[0-9a-f-]{36}\.json$/i.test(entry.name)) continue;
      if (reports.length >= MAX_REPORTS) {
        throw new Error(`Evaluation report limit exceeded (${MAX_REPORTS}); refusing to produce an incomplete skill-health report.`);
      }
      const absolute = path.join(directory, entry.name);
      if (!isWithinRoot(root, absolute)) throw new Error(`Evaluation report escapes project root: ${entry.name}`);
      if (fs.statSync(absolute).size > MAX_REPORT_BYTES) {
        throw new Error(`Evaluation report exceeds the ${MAX_REPORT_BYTES}-byte limit: ${entry.name}`);
      }
      const report = JSON.parse(fs.readFileSync(absolute, "utf8"));
      const direct = relative === ".mcpee/reports/asset-evaluations";
      if (report.generated_by !== "mcpee" ||
          report.id !== path.basename(entry.name, ".json") ||
          !["passed", "failed"].includes(report.status) ||
          (direct
            ? report.evaluation_kind !== "agent-asset-response" || !report.human_review
            : !Array.isArray(report.checks))) continue;
      reports.push(report);
    }
  }
  return reports;
}

function buildSkillHealth(projectRoot, catalog, options = {}) {
  const root = path.resolve(projectRoot);
  const minimumSampleSize = options.minimumSampleSize ?? 3;
  if (!Number.isInteger(minimumSampleSize) || minimumSampleSize < 1) {
    throw new Error("minimumSampleSize must be a positive integer.");
  }
  const workflowSkills = new Map();
  for (const workflow of catalog.workflows || []) {
    for (const skillId of workflow.skills || []) {
      const workflows = workflowSkills.get(skillId) || new Set();
      workflows.add(workflow.id);
      workflowSkills.set(skillId, workflows);
    }
  }
  const reports = readReports(root);
  const skills = (catalog.skills || []).map((skill) => {
    const eligibleWorkflows = workflowSkills.get(skill.id) || new Set();
    const direct = reports.filter((report) =>
      report.evaluation_kind === "agent-asset-response" && report.asset_id === skill.id);
    const workflowProxy = reports.filter((report) =>
      report.evaluation_kind !== "agent-asset-response" && eligibleWorkflows.has(report.workflow_id));
    const passed = direct.filter((report) => report.status === "passed").length;
    const sampleSize = direct.length;
    return {
      id: skill.id,
      status: sampleSize === 0
        ? "no-direct-evidence"
        : sampleSize < minimumSampleSize ? "limited-evidence" : "observed",
      sample_size: sampleSize,
      minimum_sample_size: minimumSampleSize,
      passed,
      failed: sampleSize - passed,
      observed_pass_rate: sampleSize ? Number((passed / sampleSize).toFixed(3)) : null,
      workflow_outcome_proxy: {
        sample_size: workflowProxy.length,
        passed: workflowProxy.filter((report) => report.status === "passed").length,
        failed: workflowProxy.filter((report) => report.status === "failed").length,
        pass_rate: workflowProxy.length
          ? Number((workflowProxy.filter((report) => report.status === "passed").length / workflowProxy.length).toFixed(3))
          : null,
      },
      workflows: [...eligibleWorkflows].sort(),
      last_evaluated_at: direct
        .map((report) => report.completed_at)
        .filter((value) => typeof value === "string")
        .sort()
        .at(-1) || null,
      evaluation_ids: direct.map((report) => report.id).filter(Boolean),
    };
  });
  return {
    schema_version: 1,
    generated_by: "mcpee",
    metric: "reviewed-asset-evaluation-outcomes",
    interpretation: "Direct counts include only completed asset evaluations with human scorecards. Workflow outcomes are separate proxies and cannot establish that a skill caused the result.",
    minimum_sample_size: minimumSampleSize,
    reports_considered: reports.filter((report) => report.evaluation_kind === "agent-asset-response").length,
    workflow_reports_considered: reports.filter((report) => report.evaluation_kind !== "agent-asset-response").length,
    skills,
  };
}

module.exports = { buildSkillHealth, readReports };
