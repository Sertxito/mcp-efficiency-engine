"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { z } = require("zod");
const { projectPath, ensureDirectory } = require("./brownfield");
const { renameAtomicSync } = require("../../core/src/atomic-file");

const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const snapshotSchema = z.object({
  feature: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  specification_sha256: hash,
  source_path: z.string().min(1),
  recorded_sha256: hash,
  current_sha256: hash,
  coverage: z.array(z.object({ path: z.string(), line: z.number().int().positive(),
    status: z.literal("out-of-scope"), use_cases: z.array(z.string()).length(0),
    reason: z.string().min(1) }).strict()).min(1),
}).strict();
const recordSchema = z.object({
  schema_version: z.literal(1), generated_by: z.literal("mcpee"), id: z.string().uuid(),
  snapshot: snapshotSchema, review_sha256: hash, reviewer: z.string().trim().min(1).max(160),
  findings: z.string().trim().min(8).max(4000), completed_at: z.string().datetime(), record_sha256: hash,
}).strict();

function previewSourceDrift(root, slug, sourcePath) {
  const { readFeature, currentDigest } = require("./lifecycle");
  const { directory, manifest } = readFeature(root, slug);
  const specificationSha256 = currentDigest(root, slug, "specification");
  const sources = manifest.sources.filter(source =>
    source.path === sourcePath || source.original_path === sourcePath);
  if (sources.length !== 1) throw new Error("Select exactly one recorded specification source.");
  const source = sources[0];
  const filename = projectPath(root, sourcePath);
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    throw new Error("Source drift review requires the changed source file to exist.");
  }
  const recorded = source.path === sourcePath ? source.sha256 : source.original_sha256;
  const current = digest(fs.readFileSync(filename));
  if (recorded === current) throw new Error("This specification source has not changed.");
  if (!manifest.document) throw new Error("Out-of-scope drift review requires a structured canonical specification.");
  const document = JSON.parse(fs.readFileSync(projectPath(root, manifest.document), "utf8"));
  if (!Array.isArray(document.coverage) || !Array.isArray(document.use_cases)) {
    throw new Error("Canonical specification has invalid coverage or use-case evidence.");
  }
  const paths = [source.path, ...(source.original_path ? [source.original_path] : [])];
  const coverage = manifest.coverage.filter(entry => paths.includes(entry.path));
  const documentCoverage = document.coverage.filter(entry => paths.includes(entry.path));
  if (!coverage.length || JSON.stringify(coverage) !== JSON.stringify(documentCoverage) ||
      coverage.some(entry => entry.status !== "out-of-scope" || !Array.isArray(entry.use_cases) ||
        entry.use_cases.length !== 0) ||
      !Array.isArray(manifest.cases) || [...document.use_cases, ...manifest.cases].some(useCase =>
        !Array.isArray(useCase.evidence) || useCase.evidence.some(item => paths.includes(item.path)))) {
    throw new Error("Only sources entirely recorded as out-of-scope and not cited by any use case can be reviewed this way.");
  }
  const snapshot = snapshotSchema.parse({ feature: slug, specification_sha256: specificationSha256,
    source_path: sourcePath, recorded_sha256: recorded, current_sha256: current, coverage });
  return { ...snapshot, review_sha256: digest(JSON.stringify(snapshot)), specification_path: `${directory}/spec.md` };
}

function recordSourceDriftReview(root, { slug, sourcePath, reviewer, findings, confirmSha256 }) {
  z.string().trim().min(1).max(160).parse(reviewer);
  z.string().trim().min(8).max(4000).parse(findings);
  const { review_sha256, specification_path, ...snapshot } = previewSourceDrift(root, slug, sourcePath);
  if (confirmSha256 !== review_sha256) {
    throw new Error("Source or specification changed, or confirmation digest is incorrect; inspect the current drift preview.");
  }
  const details = { schema_version: 1, generated_by: "mcpee", id: crypto.randomUUID(),
    snapshot, review_sha256, reviewer: reviewer.trim(), findings: findings.trim(), completed_at: new Date().toISOString() };
  const record = recordSchema.parse({ ...details, record_sha256: digest(JSON.stringify(details)) });
  const directory = `.mcpee/reports/source-drift-reviews/${slug}`;
  ensureDirectory(root, directory);
  const file = `${directory}/${record.id}.json`, temporary = `${directory}/${record.id}.tmp`;
  try {
    fs.writeFileSync(projectPath(root, temporary), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    renameAtomicSync(projectPath(root, temporary), projectPath(root, file));
  } finally {
    if (fs.existsSync(projectPath(root, temporary))) fs.unlinkSync(projectPath(root, temporary));
  }
  return { ...record, path: file, specification_path };
}

function relocatedSpecificationDigests(root, slug) {
  const { readFeature, currentDigest, reviewPaths } = require("./lifecycle");
  const { directory, lifecycle } = readFeature(root, slug);
  const artifacts = reviewPaths(root, slug, "specification").map(file => file.slice(directory.length + 1));
  let current = currentDigest(root, slug, "specification"), location = directory;
  const digests = new Set([current]);
  for (const transition of [...(lifecycle.transitions || [])].reverse()) {
    if (!transition.report) break;
    const report = JSON.parse(fs.readFileSync(projectPath(root, transition.report), "utf8"));
    if (report.generated_by !== "mcpee" || report.kind !== "specification-relocation" ||
        report.feature !== slug || !Array.isArray(report.files)) {
      throw new Error(`Invalid specification relocation evidence: ${transition.report}`);
    }
    if (report.to !== location) break;
    const files = artifacts.map(name => {
      const matches = report.files.filter(file => file.from === `${report.from}/${name}` &&
        file.to === `${report.to}/${name}`);
      if (matches.length !== 1 || !hash.safeParse(matches[0].previous_sha256).success ||
          !hash.safeParse(matches[0].sha256).success) {
        throw new Error(`Invalid specification relocation artifacts: ${transition.report}`);
      }
      return matches[0];
    });
    const before = digest(JSON.stringify(files.map(file => [file.from, file.previous_sha256])));
    const after = digest(JSON.stringify(files.map(file => [file.to, file.sha256])));
    // Follow exact relocation evidence, never a content revision or a restored approval alone.
    if (after !== current || before !== report.previous_reviews?.specification?.sha256) break;
    digests.add(before);
    current = before;
    location = report.from;
  }
  return digests;
}

function reviewedSourceDrift(root, slug, rawDrift) {
  const directory = `.mcpee/reports/source-drift-reviews/${slug}`;
  if (!rawDrift.length || !fs.existsSync(projectPath(root, directory))) return [];
  const records = fs.readdirSync(projectPath(root, directory)).filter(name => /^[a-f0-9-]+\.json$/.test(name))
    .map(name => {
      const file = `${directory}/${name}`;
      const contents = fs.readFileSync(projectPath(root, file));
      const record = recordSchema.parse(JSON.parse(contents.toString("utf8")));
      const { record_sha256, ...details } = record;
      if (record.snapshot.feature !== slug || record.review_sha256 !== digest(JSON.stringify(record.snapshot)) ||
          record_sha256 !== digest(JSON.stringify(details))) {
        throw new Error(`Invalid source drift review: ${file}`);
      }
      return { file, record, sha256: digest(contents) };
    });
  if (!records.length) return [];
  const specificationDigests = relocatedSpecificationDigests(root, slug);
  return rawDrift.flatMap(sourcePath => {
    if (!records.some(({ record }) => record.snapshot.source_path === sourcePath)) return [];
    let preview;
    try { preview = previewSourceDrift(root, slug, sourcePath); }
    catch (error) {
      if (/^(Only sources entirely recorded|Source drift review requires the changed source file|This specification source has not changed)/.test(error.message)) return [];
      throw error;
    }
    const { review_sha256, specification_path, ...snapshot } = preview;
    const match = records.filter(({ record }) =>
      specificationDigests.has(record.snapshot.specification_sha256) &&
      record.review_sha256 === digest(JSON.stringify({
        ...snapshot, specification_sha256: record.snapshot.specification_sha256,
      })))
      .sort((a, b) => b.record.completed_at.localeCompare(a.record.completed_at) || a.file.localeCompare(b.file))[0];
    return match ? [{ path: sourcePath, review: match.file, sha256: match.sha256, reviewer: match.record.reviewer,
      findings: match.record.findings, recorded_sha256: preview.recorded_sha256,
      current_sha256: preview.current_sha256 }] : [];
  });
}

module.exports = { previewSourceDrift, recordSourceDriftReview, reviewedSourceDrift };
