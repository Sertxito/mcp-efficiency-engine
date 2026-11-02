"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { z } = require("zod");
const { renameAtomicSync } = require("../../core/src/atomic-file");
const { projectPath } = require("./brownfield");

const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({
  schema_version: z.literal(1), generated_by: z.literal("mcpee"),
  scope: z.literal("planned-implementation-checks"), product_acceptance: z.literal("not-verified"),
  specification_sha256: sha256, plan_sha256: sha256, tasks_sha256: sha256,
  report: z.string(), report_sha256: sha256, evaluation_id: z.string().uuid(),
  completed_at: z.string(),
  files: z.array(z.object({ path: z.string(), sha256 }).strict()).min(1),
  use_cases: z.array(z.object({
    id: z.string().regex(/^UC-\d{3}$/),
    tasks: z.array(z.string().regex(/^TASK-\d{3}$/)).min(1),
    checks: z.array(z.string().regex(/^CHECK-\d{3}$/)).min(1),
    paths: z.array(z.string()).min(1),
  }).strict()).min(1),
}).strict();

function implementationStatus(root, directory, reviews, drift) {
  const filename = projectPath(root, `${directory}/verification.json`);
  if (!fs.existsSync(filename)) return { verified: false, status: "not-run", scope: "planned-implementation-checks" };
  const record = schema.parse(JSON.parse(fs.readFileSync(filename, "utf8")));
  const stale = [];
  if (drift.length || ["specification", "plan", "tasks"].some(stage =>
    !reviews[stage].approved || reviews[stage].sha256 !== record[`${stage}_sha256`])) stale.push("canonical-phases");
  for (const file of [...record.files, { path: record.report, sha256: record.report_sha256 }]) {
    const filename = projectPath(root, file.path);
    if (!fs.existsSync(filename) || digest(fs.readFileSync(filename)) !== file.sha256) stale.push(file.path);
  }
  return { verified: stale.length === 0, status: stale.length ? "stale" : "passed",
    scope: record.scope, product_acceptance: record.product_acceptance, report: record.report,
    use_cases: record.use_cases, stale };
}

function recordImplementationVerification(root, slug, canonical, reportPath) {
  if (!/^\.mcpee\/reports\/(?:workflows|evaluations)\/[a-f0-9-]+\.json$/.test(reportPath)) {
    throw new Error("Implementation verification requires a persisted MCPEE evaluation report.");
  }
  const { prepareImplementationValidation } = require("./phases");
  const current = prepareImplementationValidation(root, slug);
  if (JSON.stringify(current) !== JSON.stringify(canonical)) throw new Error("Canonical phases changed before verification publication.");
  const contents = fs.readFileSync(projectPath(root, reportPath));
  const report = JSON.parse(contents.toString("utf8"));
  if (report.generated_by !== "mcpee" || report.schema_version !== 1 || report.status !== "passed" ||
      report.workflow_id !== current.spec.workflow_id || !Array.isArray(report.checks) ||
      report.checks.length !== current.spec.steps.length || !Array.isArray(report.evidence)) {
    throw new Error("Implementation verification requires a complete passing canonical evaluation, not model claims.");
  }
  for (const step of current.spec.steps) {
    const matches = report.checks.filter(check => check.id === step.id);
    if (matches.length !== 1 || matches[0].status !== "passed" || matches[0].exit_code !== 0 ||
        matches[0].tool !== step.tool || matches[0].cwd !== "." ||
        JSON.stringify(matches[0].args) !== JSON.stringify(step.args)) {
      throw new Error(`Evaluation did not execute the exact canonical check ${step.id}.`);
    }
  }
  const files = current.spec.evidence.map(path => {
    const sha256 = digest(fs.readFileSync(projectPath(root, path)));
    if (report.evidence.filter(file => file.path === path && file.sha256 === sha256).length !== 1) {
      throw new Error(`Implementation evidence changed or is missing: ${path}`);
    }
    return { path, sha256 };
  });
  const { readFeature, refreshWorkspaceIndex } = require("./lifecycle");
  const { directory, manifest } = readFeature(root, slug);
  const tasks = JSON.parse(fs.readFileSync(projectPath(root, `${directory}/tasks.json`), "utf8")).tasks;
  const record = schema.parse({
    schema_version: 1, generated_by: "mcpee", scope: "planned-implementation-checks", product_acceptance: "not-verified",
    specification_sha256: current.specification_sha256, plan_sha256: current.plan_sha256,
    tasks_sha256: current.tasks_sha256, report: reportPath, report_sha256: digest(contents),
    evaluation_id: report.id, completed_at: report.completed_at, files,
    use_cases: manifest.cases.map(useCase => {
      const linked = tasks.filter(task => task.use_cases.includes(useCase.id));
      return { id: useCase.id, tasks: linked.map(task => task.id),
        checks: [...new Set(linked.flatMap(task => task.checks))],
        paths: [...new Set(linked.flatMap(task => task.paths))] };
    }),
  });
  const filename = projectPath(root, `${directory}/verification.json`);
  const temporary = projectPath(root, `${directory}/verification.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    renameAtomicSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  require("../../core/src/telemetry").recordEvent(root, {
    event_name: "specification.implementation.verified",
    attributes: { feature: slug, report: reportPath, evaluation_id: record.evaluation_id,
      scope: record.scope, use_case_count: record.use_cases.length, product_acceptance: record.product_acceptance },
  });
  require("./relocation").relocateFeature(root, slug, "approved");
  refreshWorkspaceIndex(root);
  const indexing = require("../../source-engine/src/sync").syncProject(root, {
    generateDocumentation: false, tools: [], graphify: { installed: false },
  });
  if (indexing.counts.failed) throw new Error("Verification persisted but canonical retrieval indexing failed; inspect sync evidence.");
  const { directory: currentDirectory } = readFeature(root, slug);
  return schema.parse(JSON.parse(fs.readFileSync(projectPath(root, `${currentDirectory}/verification.json`), "utf8")));
}

module.exports = { implementationStatus, recordImplementationVerification };
