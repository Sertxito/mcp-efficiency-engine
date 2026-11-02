"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readProjectFile } = require("../../evaluation-engine/src/asset-evaluation");
const { projectPath, isScaffolding } = require("./brownfield");
const { partitionDomains } = require("./domains");
const { prepareFunctionalSources } = require("./functional");

const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SECTIONS = 1000;
const MAX_TASK = 10000;

function scopeTask(id, sources) {
  return `Generate brownfield functional specifications for scope ${id} from ${sources.map(source =>
    `\`${source.path}\``).join(", ")}. Use slug ${id}. Account for every selected source section; distinguish observed code from documented intent, preserve open contradictions and identify cross-scope dependencies. Do not implement or change source files.`;
}

function buildSpecificationScopes(projectRoot) {
  const root = path.resolve(projectRoot);
  const bytes = readProjectFile(root, "knowledge/traceability/source-manifest.json",
    32 * 1024 * 1024, "Specification source inventory").contents;
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.generated_by !== "mcpee" || !Array.isArray(manifest.sources) ||
      manifest.sources.length > 5000) {
    throw new Error("Specification scope planning requires a current bounded MCPEE source inventory (at most 5000 sources).");
  }
  const seen = new Set(), sources = [], excluded = [], blocked = [];
  for (const entry of manifest.sources) {
    if (!entry || typeof entry.path !== "string" || typeof entry.category !== "string" ||
        typeof entry.status !== "string") throw new Error("Invalid specification scope source record.");
    projectPath(root, entry.path);
    if (seen.has(entry.path)) throw new Error(`Duplicate specification scope source: ${entry.path}`);
    seen.add(entry.path);
    if (entry.category === "logs" || entry.path.startsWith("docs/specifications/") ||
        entry.path.startsWith("specs/approved/") || isScaffolding(root, entry.path)) {
      excluded.push({ path: entry.path, reason: entry.category === "logs" ? "execution-log-not-product-input" : "derived-harness-or-specification-artifact" });
      continue;
    }
    if (!["processed", "unchanged"].includes(entry.status)) {
      blocked.push({ path: entry.path, reason: `source-processing-${entry.status}` });
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid source checksum: ${entry.path}`);
    const filename = projectPath(root, entry.path);
    if (!fs.lstatSync(filename).isFile() || hash(fs.readFileSync(filename)) !== entry.sha256) {
      throw new Error(`Source changed after sync: ${entry.path}. Synchronize before planning specification scopes.`);
    }
    let prepared;
    try {
      prepared = prepareFunctionalSources(root, [entry.path])[0];
    } catch (error) {
      if (!["MCPEE_SPEC_SOURCE_BYTES", "MCPEE_SPEC_SOURCE_SECTIONS"].includes(error.code)) throw error;
      blocked.push({ path: entry.path, sha256: entry.sha256, reason: error.code,
        action: "Split this source into traceable source documents before authoring; no sections were discarded." });
      continue;
    }
    sources.push({
      path: entry.path, sha256: entry.sha256, category: entry.category, test_cases: [],
      evidence_path: prepared.path, evidence_sha256: prepared.sha256,
      bytes: fs.statSync(projectPath(root, prepared.path)).size,
      sections: Math.max(1, prepared.headings.length),
    });
  }
  const scopes = [];
  for (const group of partitionDomains(sources)) {
    let current = [], size = 0, sections = 0;
    const publish = () => {
      if (!current.length) return;
      const snapshot = current.map(({ test_cases, ...source }) => source);
      const checksum = hash(JSON.stringify(snapshot));
      const id = `brownfield-${group.domain.slice(0, 50)}-${checksum.slice(0, 12)}`;
      scopes.push({ id, domain: group.domain, grouping: "inferred-path-domain-not-a-business-decision",
        sources: snapshot, source_snapshot_sha256: checksum, bytes: size, sections,
        task: scopeTask(id, snapshot), status: "planned-not-authored" });
      current = []; size = 0; sections = 0;
    };
    for (const source of group.sources) {
      const proposed = [...current, source];
      if (current.length && (size + source.bytes > MAX_BYTES ||
          sections + source.sections > MAX_SECTIONS ||
          scopeTask(`brownfield-${group.domain.slice(0, 50)}-${"0".repeat(12)}`, proposed).length > MAX_TASK)) publish();
      if (scopeTask(`brownfield-${group.domain.slice(0, 50)}-${"0".repeat(12)}`, [source]).length > MAX_TASK) {
        blocked.push({ path: source.path, reason: "task-path-exceeds-routing-limit" });
        continue;
      }
      current.push(source); size += source.bytes; sections += source.sections;
    }
    publish();
  }
  const accounted = scopes.reduce((total, scope) => total + scope.sources.length, 0) + blocked.length + excluded.length;
  if (accounted !== manifest.sources.length) throw new Error("Specification scope accounting failed; no incomplete plan was returned.");
  return {
    schema_version: 1, generated_by: "mcpee", mode: "brownfield",
    status: blocked.length ? "blocked" : scopes.length ? "planned" : "empty",
    source_manifest_sha256: hash(bytes),
    summary: { inventory_sources: manifest.sources.length, planned_sources: sources.length -
      blocked.filter(item => item.reason === "task-path-exceeds-routing-limit").length,
      scopes: scopes.length, blocked_sources: blocked.length, excluded_sources: excluded.length },
    limits: { files_per_scope: 20, bytes_per_scope: MAX_BYTES, sections_per_scope: MAX_SECTIONS, task_characters: MAX_TASK },
    scopes, blocked, excluded,
    limitations: [
      "This is read-only preparation, not authored specifications, validated business boundaries or automatic execution.",
      "Run each exported task against unchanged sources. Final artifacts use the shared specs/<scope>/ workspace, graph and retrieval inventory.",
      "After authoring, run mcpee specs reconcile to build a hash-linked cross-scope review matrix; path grouping does not prove semantic completeness.",
    ],
  };
}

function validateSpecificationScopeTask(root, task) {
  const requested = task.match(/^Generate brownfield functional specifications for scope ([a-z0-9-]+) from /);
  if (!requested) return null;
  const report = buildSpecificationScopes(root);
  const scope = report.scopes.find(item => item.id === requested[1]);
  if (!scope || task !== scope.task) {
    throw new Error("Brownfield authoring scope no longer matches the current inventory and exact exported task. Run mcpee specs scopes again; no paid execution was started.");
  }
  return { id: scope.id, domain: scope.domain, source_snapshot_sha256: scope.source_snapshot_sha256,
    source_paths: scope.sources.map(source => source.path), scope_status: report.status };
}

module.exports = { buildSpecificationScopes, validateSpecificationScopeTask };
