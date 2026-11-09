"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { z } = require("zod");
const { projectPath, ensureDirectory } = require("./brownfield");

const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema = z.object({
  schema_version: z.literal(1), generated_by: z.literal("mcpee"), id: z.string().uuid(),
  feature: z.string(), check: z.object({ id: z.string().regex(/^CHECK-\d{3}$/),
    kind: z.literal("manual"), command: z.string(), expected: z.string() }).strict(),
  specification_sha256: hash, plan_sha256: hash, tasks_sha256: hash,
  files: z.array(z.object({ path: z.string(), sha256: hash }).strict()).min(1),
  review_sha256: hash, reviewer: z.string().trim().min(1).max(160),
  outcome: z.enum(["passed", "failed"]), findings: z.string().trim().min(8).max(4000), completed_at: z.string(),
}).strict();

function snapshot(root, slug, canonical, check) {
  const files = canonical.spec.evidence.filter(file => file !== canonical.explicit_workflow).map(file => {
    const filename = projectPath(root, file);
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      throw new Error(`Manual review requires all planned evidence files to exist: ${file}`);
    }
    return { path: file, sha256: digest(fs.readFileSync(filename)) };
  });
  return { feature: slug, check, specification_sha256: canonical.specification_sha256,
    plan_sha256: canonical.plan_sha256, tasks_sha256: canonical.tasks_sha256, files };
}

function previewManualReview(root, slug, id) {
  const canonical = require("./phases").prepareImplementationValidation(root, slug,
    { allowPending: true, skipManualReviews: true });
  const check = canonical.pending_checks?.find(item => item.id === id && item.kind === "manual");
  if (!check) throw new Error(`Not a canonical manual check: ${id}`);
  const review = snapshot(root, slug, canonical, check);
  return { ...review, review_sha256: digest(JSON.stringify(review)) };
}

function recordManualReview(root, { slug, id, reviewer, outcome, findings, confirmSha256 }) {
  z.string().trim().min(1).max(160).parse(reviewer);
  z.enum(["passed", "failed"]).parse(outcome);
  z.string().trim().min(8).max(4000).parse(findings);
  const preview = previewManualReview(root, slug, id);
  if (preview.review_sha256 !== confirmSha256) {
    throw new Error("Manual review evidence changed or confirmation digest is incorrect; inspect the current review preview.");
  }
  const record = recordSchema.parse({ schema_version: 1, generated_by: "mcpee",
    id: crypto.randomUUID(), ...preview, reviewer: reviewer.trim(), outcome, findings: findings.trim(),
    completed_at: new Date().toISOString() });
  const directory = `.mcpee/reports/manual-reviews/${slug}`;
  ensureDirectory(root, directory);
  const file = `${directory}/${record.id}.json`;
  const temporary = `${directory}/${record.id}.tmp`;
  try {
    fs.writeFileSync(projectPath(root, temporary), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    require("../../core/src/atomic-file").renameAtomicSync(projectPath(root, temporary), projectPath(root, file));
  } finally {
    if (fs.existsSync(projectPath(root, temporary))) fs.unlinkSync(projectPath(root, temporary));
  }
  require("../../core/src/telemetry").recordEvent(root, {
    event_name: "specification.manual_review.recorded",
    attributes: { feature: slug, check: id, review_sha256: record.review_sha256, report: file },
  });
  return { ...record, path: file };
}

function currentManualReviews(root, slug, canonical) {
  const checks = (canonical.pending_checks || []).filter(check => check.kind === "manual");
  const directory = `.mcpee/reports/manual-reviews/${slug}`;
  if (!checks.length || !fs.existsSync(projectPath(root, directory))) return [];
  const records = fs.readdirSync(projectPath(root, directory)).filter(file => /^[a-f0-9-]+\.json$/.test(file))
    .map(file => {
      const path = `${directory}/${file}`;
      const contents = fs.readFileSync(projectPath(root, path));
      return { record: recordSchema.parse(JSON.parse(contents.toString("utf8"))), path, sha256: digest(contents) };
    });
  return checks.flatMap(check => {
    let expected;
    try { expected = digest(JSON.stringify(snapshot(root, slug, canonical, check))); }
    catch (error) {
      if (error.message.startsWith("Manual review requires all planned evidence files to exist:")) return [];
      throw error;
    }
    const matching = records.filter(({ record }) => record.feature === slug && record.check.id === check.id &&
      record.review_sha256 === expected && record.review_sha256 === digest(JSON.stringify({
        feature: record.feature, check: record.check, specification_sha256: record.specification_sha256,
        plan_sha256: record.plan_sha256, tasks_sha256: record.tasks_sha256, files: record.files,
      }))).sort((a, b) => b.record.completed_at.localeCompare(a.record.completed_at) ||
        (a.record.outcome === b.record.outcome ? a.path.localeCompare(b.path) : a.record.outcome === "failed" ? -1 : 1));
    if (!matching.length || matching[0].record.outcome !== "passed") return [];
    const { record, path, sha256 } = matching[0];
    return [{ id: check.id, path, sha256, reviewer: record.reviewer, findings: record.findings,
      completed_at: record.completed_at }];
  });
}

function reviewSuperseded(root, slug, review) {
  const contents = fs.readFileSync(projectPath(root, review.path));
  const original = recordSchema.parse(JSON.parse(contents.toString("utf8")));
  const directory = `.mcpee/reports/manual-reviews/${slug}`;
  const later = fs.readdirSync(projectPath(root, directory)).filter(file => /^[a-f0-9-]+\.json$/.test(file))
    .map(file => recordSchema.parse(JSON.parse(fs.readFileSync(projectPath(root, `${directory}/${file}`), "utf8"))))
    .filter(record => record.feature === slug && record.check.id === original.check.id &&
      record.review_sha256 === original.review_sha256 && record.id !== original.id);
  return later.some(record => record.completed_at > original.completed_at ||
    record.completed_at === original.completed_at && record.outcome === "failed");
}

module.exports = { previewManualReview, recordManualReview, currentManualReviews, reviewSuperseded };
