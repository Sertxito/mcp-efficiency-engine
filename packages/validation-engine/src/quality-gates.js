"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readCatalog, summarizeCatalogCoverage } = require("../../copilot-renderer/src/render");
const {
  detectProjectCapabilities,
  SUPPORTED_TECHNOLOGIES,
} = require("../../copilot-renderer/src/project-capabilities");
const { loadRunSpec } = require("../../evaluation-engine/src/evaluate");

const WORKFLOW_DIRECTORY = ".mcpee/workflows";
const REPORT_DIRECTORY = ".mcpee/reports/workflows";
const MAX_JSON_BYTES = 1024 * 1024;

function readProjectJson(root, relativePath, label) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  if (fs.lstatSync(absolutePath).isSymbolicLink() || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`${label} must be a regular file: ${relativePath}`);
  }
  const contents = fs.readFileSync(absolutePath);
  if (contents.length > MAX_JSON_BYTES) throw new Error(`${label} exceeds ${MAX_JSON_BYTES} bytes: ${relativePath}`);
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${label} ${relativePath}: ${error.message}`);
  }
}

function listJsonFiles(root, relativeDirectory, label) {
  let absoluteDirectory = root;
  for (const segment of relativeDirectory.split(/[\\/]/).filter(Boolean)) {
    absoluteDirectory = path.join(absoluteDirectory, segment);
    if (!fs.existsSync(absoluteDirectory)) return [];
    if (fs.lstatSync(absoluteDirectory).isSymbolicLink()) {
      throw new Error(`${label} path cannot follow a symbolic link: ${relativeDirectory}`);
    }
  }
  if (!fs.statSync(absoluteDirectory).isDirectory()) {
    throw new Error(`${label} directory must be a regular directory: ${relativeDirectory}`);
  }
  return fs.readdirSync(absoluteDirectory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => `${relativeDirectory}/${entry}`);
}

function buildQualityGateReport(projectRoot) {
  const root = path.resolve(projectRoot);
  const { catalog, coverageContract } = readCatalog();
  const capabilities = detectProjectCapabilities(root, catalog);
  const detected = capabilities.detected_technologies.map((technology) => technology.id);
  const declaredByTechnology = new Map(SUPPORTED_TECHNOLOGIES.map((id) => [id, new Map()]));
  for (const specPath of listJsonFiles(root, WORKFLOW_DIRECTORY, "Workflow specs")) {
    const spec = readProjectJson(root, specPath, "Workflow spec");
    if (!spec || !Array.isArray(spec.steps)) {
      throw new Error(`Workflow spec ${specPath} must contain a steps array.`);
    }
    const validated = loadRunSpec(root, specPath);
    for (const step of spec.steps) {
      if (typeof step?.id !== "string" || !Array.isArray(step.covers_technologies)) continue;
      for (const technology of step.covers_technologies) {
        if (!declaredByTechnology.has(technology)) {
          throw new Error(`Workflow ${specPath} step ${step.id} references unsupported technology '${technology}'.`);
        }
        const key = `${validated.workflow_id}:${step.id}`;
        declaredByTechnology.get(technology).set(key, {
          id: step.id,
          label: step.label,
          tool: step.tool,
          workflow_spec: specPath,
          workflow_id: validated.workflow_id,
          evidence: Array.isArray(step.evidence) ? step.evidence : spec.evidence || [],
        });
      }
    }
  }

  const observations = new Map(SUPPORTED_TECHNOLOGIES.map((id) => [id, new Map()]));
  for (const reportPath of listJsonFiles(root, REPORT_DIRECTORY, "Workflow reports")) {
    const report = readProjectJson(root, reportPath, "Workflow report");
    if (!report || !Array.isArray(report.checks)) {
      throw new Error(`Workflow report ${reportPath} must contain a checks array.`);
    }
    for (const check of report.checks) {
      if (typeof check?.id !== "string" || !Array.isArray(check.covers_technologies)) continue;
      for (const technology of check.covers_technologies) {
        if (!observations.has(technology)) continue;
        const key = `${report.workflow_id}:${check.id}`;
        const current = observations.get(technology).get(key);
        const completedAt = report.completed_at || "";
        if (!current || completedAt > current.completed_at) {
          observations.get(technology).set(key, {
            id: check.id,
            status: check.status,
            workflow_id: report.workflow_id || null,
            report: reportPath,
            completed_at: completedAt,
          });
        }
      }
    }
  }

  const technologies = detected.map((technology) => {
    const checks = [...declaredByTechnology.get(technology).values()];
    const results = [...observations.get(technology).values()];
    const failed = results.some((result) => result.status === "failed");
    const allChecksPassed = checks.length > 0 && checks.every((check) =>
      results.some((result) =>
        result.workflow_id === check.workflow_id && result.id === check.id &&
        result.status === "passed"));
    const status = failed
      ? "failed"
      : checks.length === 0
        ? "not-configured"
        : !allChecksPassed
          ? "configured-not-run"
          : "passed";
    return {
      id: technology,
      name: coverageContract.technologies.find((entry) => entry.id === technology)?.name || technology,
      status,
      configured_check_count: checks.length,
      checks,
      latest_results: results,
      validation_basis: coverageContract.technologies.find((entry) => entry.id === technology)?.validation_basis || null,
    };
  });
  const status = technologies.some((technology) => technology.status === "failed")
    ? "failed"
    : technologies.length > 0 && technologies.every((technology) => technology.status === "passed")
      ? "passed"
      : "incomplete";
  return {
    schema_version: 1,
    generated_by: "mcpee",
    status,
    detected_technology_count: detected.length,
    technologies,
    limitations: [
      "Configured checks are project-owned declarations; MCPEE does not certify their semantic coverage or adequacy.",
      "A passing status means every currently declared check tagged for a detected technology has a latest passing recorded result; it is not a security or release certification.",
      "Checks must explicitly declare covers_technologies. No language, framework, or infrastructure convention is inferred as enforced merely from guidance.",
    ],
  };
}

function buildCatalogCoverageReport() {
  const { coverageContract } = readCatalog();
  return summarizeCatalogCoverage(coverageContract);
}

function readWorkflowHistory(root) {
  return listJsonFiles(root, REPORT_DIRECTORY, "Workflow reports").map((file) => {
    const report = readProjectJson(root, file, "Workflow report");
    if (!report || !Array.isArray(report.checks) || typeof report.workflow_id !== "string" ||
        !Number.isFinite(Date.parse(report.completed_at))) {
      throw new Error(`Invalid completed workflow report: ${file}`);
    }
    return { ...report, report_path: file };
  }).sort((a, b) => b.completed_at.localeCompare(a.completed_at));
}

module.exports = {
  buildCatalogCoverageReport, buildQualityGateReport, readWorkflowHistory,
  readProjectJson, listJsonFiles,
};
