"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");
const { readProjectFile } = require("../../evaluation-engine/src/asset-evaluation");
const { projectPath, isScaffolding } = require("./brownfield");
const { partitionDomains } = require("./domains");
const { prepareFunctionalSources } = require("./functional");

const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const MAX_SECTIONS = 1000;
const MAX_TASK = 10000;
const UNIT_BYTES = 24 * 1024;
const UNIT_SECTIONS = 12;
const UNIT_FILES = 4;
const CONTEXT_BYTES = 12 * 1024;
const planningContext = new AsyncLocalStorage();

function withSpecificationScopePlanning(root, callback) {
  return planningContext.run({ root: path.resolve(root) }, callback);
}

function planningFingerprint(root, contents) {
  const manifest = JSON.parse(contents.toString("utf8"));
  if (!Array.isArray(manifest.sources) || manifest.sources.length > 5000) {
    throw new Error("Specification scope planning requires a bounded source inventory.");
  }
  const files = new Set([".mcpee/indexes/knowledge-index.json", ...manifest.sources.flatMap(source =>
    [source.path, ...(source.normalized_path ? [source.normalized_path] : [])])]);
  return hash(JSON.stringify([hash(contents), [...files].map(file => {
    const filename = projectPath(root, file);
    if (!fs.existsSync(filename)) return [file, null];
    const stat = fs.lstatSync(filename, { bigint: true });
    return [file, ...[stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino, stat.mode].map(String)];
  })]));
}

function scopeTask(id, sources, context = []) {
  return `Generate brownfield functional specifications for scope ${id} from ${sources.map(source =>
    `\`${source.path}\``).join(", ")}.${context.length ? ` Cross-check against these related original documents from local lexical retrieval: ${context.map(source => `\`${source.path}\``).join(", ")}.` : ""} Choose short descriptive feature and atomic case slugs from the business capabilities (for example about-us-staff); do not use this internal scope ID, workflow prefixes, part numbers or hashes as public names. Account for every PRIMARY selected line range in this unit; related documents are context, not a requirement to specify their entire contents again. Every original document retains its own primary units. Use only the selected numbered excerpts, distinguish observed code from documented intent, preserve open contradictions and identify cross-scope dependencies. Do not implement or change source files.`;
}

function sourceUnits(source, prepared, byteLimit = UNIT_BYTES) {
  const units = [];
  let start = 1, bytes = 0, sections = 0;
  const headings = new Set(prepared.headings.map(heading => heading.line));
  const flush = end => {
    if (end < start) return;
    units.push({ ...source, ranges: [{ start_line: start, end_line: end }], bytes, sections: Math.max(1, sections) });
    start = end + 1; bytes = 0; sections = 0;
  };
  for (let index = 0; index < prepared.lines.length; index++) {
    const line = index + 1, size = Buffer.byteLength(prepared.lines[index], "utf8") + 1;
    if (size > byteLimit) return null;
    if (bytes && (bytes + size > byteLimit || headings.has(line) && sections >= UNIT_SECTIONS)) flush(line - 1);
    if (!bytes && !headings.has(line)) sections = 1;
    bytes += size;
    if (headings.has(line)) sections++;
  }
  flush(prepared.lines.length);
  return units;
}

function prepareScopeSources(root, scope) {
  const paths = scope.source_paths || [...scope.sources, ...scope.context_sources].map(source => source.path);
  const prepared = scope.source_selections
    ? paths.flatMap(file => prepareFunctionalSources(root, [file])) : prepareFunctionalSources(root, paths);
  if (!scope.source_selections) return prepared;
  return require("./functional").selectFunctionalSources(prepared, scope.source_selections);
}

function scopeCoveredByManifest(scope, manifest) {
  if (manifest.authoring_scope?.domain && manifest.authoring_scope.domain !== scope.domain) return false;
  return scope.sources.every(source => {
    const saved = manifest.sources.find(item => (item.original_path || item.path) === source.path &&
      (item.original_sha256 || item.sha256) === source.sha256 && item.coverage_role !== "context");
    if (!saved) return false;
    return !saved.selected_ranges || source.ranges.every(range => saved.selected_ranges.some(previous =>
      previous.start_line <= range.start_line && previous.end_line >= range.end_line));
  });
}

function buildSpecificationScopes(projectRoot) {
  const root = path.resolve(projectRoot);
  const bytes = readProjectFile(root, "knowledge/traceability/source-manifest.json",
    32 * 1024 * 1024, "Specification source inventory").contents;
  const context = planningContext.getStore();
  if (context?.root !== root) return planSpecificationScopes(root, bytes);
  const fingerprint = planningFingerprint(root, bytes);
  if (context.fingerprint !== fingerprint) {
    context.plan = planSpecificationScopes(root, bytes);
    context.fingerprint = fingerprint;
  }
  return structuredClone(context.plan);
}

function planSpecificationScopes(root, bytes) {
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.generated_by !== "mcpee" || !Array.isArray(manifest.sources) ||
      manifest.sources.length > 5000) {
    throw new Error("Specification scope planning requires a current bounded MCPEE source inventory (at most 5000 sources).");
  }
  const seen = new Set(), sources = [], excluded = [], blocked = [], preparedByPath = new Map();
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
    preparedByPath.set(entry.path, prepared);
  }
  const scopes = [];
  const documents = new Map(sources.filter(source =>
    ["business", "documentation", "office-documents"].includes(source.category) ||
    source.path.startsWith("knowledge/sources/")).map(source => [source.path, source]));
  const searchDocuments = documents.size && fs.existsSync(projectPath(root, ".mcpee/indexes/knowledge-index.json"))
    ? require("../../source-engine/src/sync").createKnowledgeSearch(root, { sourcePaths: [...documents.keys()] }) : null;
  for (const group of partitionDomains(sources)) {
    let current = [], size = 0, sections = 0;
    const publish = () => {
      if (!current.length) return;
      const snapshot = current.map(({ test_cases, ...source }) => source);
      const checksum = hash(JSON.stringify({ version: 2, sources: snapshot }));
      const id = `brownfield-${group.domain.slice(0, 50)}-${checksum.slice(0, 12)}`;
      const context = [], omitted = [];
      let contextBytes = size, contextSections = sections;
      if (snapshot.some(source => ["source-code", "tests"].includes(source.category)) && searchDocuments) {
        const query = `${group.domain} ${snapshot.map(source => path.posix.basename(source.path)).join(" ")}`;
        const matches = searchDocuments(query, 100);
        for (const match of matches) {
          const source = documents.get(match.source_path);
          if (!source || context.some(item => item.path === source.path) || snapshot.some(item => item.path === source.path)) continue;
          const prepared = preparedByPath.get(source.path);
          const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2);
          const candidates = sourceUnits(source, prepared, CONTEXT_BYTES);
          const selected = candidates?.map(item => {
            const range = item.ranges[0];
            const text = prepared.lines.slice(range.start_line - 1, range.end_line).join("\n").toLowerCase();
            return { item, score: tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0) };
          }).sort((a, b) => b.score - a.score || a.item.ranges[0].start_line - b.item.ranges[0].start_line)
            .find(({ item }) => item.bytes <= CONTEXT_BYTES - (contextBytes - size));
          if (!selected || context.length >= 3 ||
              contextBytes + selected.item.bytes > UNIT_BYTES + CONTEXT_BYTES ||
              contextSections + selected.item.sections > MAX_SECTIONS ||
              scopeTask(id, snapshot, [...context, source]).length > MAX_TASK) {
            omitted.push({ path: source.path, reason: "related-context-budget; source-retains-its-own-authoring-scope" });
            continue;
          }
          const { test_cases, ...reference } = selected.item;
          context.push(reference); contextBytes += reference.bytes; contextSections += reference.sections;
        }
      }
      scopes.push({ id, domain: group.domain, grouping: "inferred-path-domain-not-a-business-decision",
        unit_version: 2,
        sources: snapshot, source_snapshot_sha256: checksum, bytes: size, sections,
        context_sources: context, context_omitted: omitted,
        authoring_bytes: contextBytes, authoring_sections: contextSections,
        source_selections: [...snapshot.map(source => ({ path: source.path, sha256: source.sha256,
          role: "primary", ranges: source.ranges })),
        ...context.map(source => ({ path: source.path, sha256: source.sha256, role: "context", ranges: source.ranges }))],
        retrieval: "local-lexical; every original document also retains its own primary scope",
        task: scopeTask(id, snapshot, context), status: "planned-not-authored" });
      current = []; size = 0; sections = 0;
    };
    for (const original of group.sources) {
      if (scopeTask(`brownfield-${group.domain.slice(0, 50)}-${"0".repeat(12)}`, [original]).length > MAX_TASK) {
        blocked.push({ path: original.path, reason: "task-path-exceeds-routing-limit" });
        continue;
      }
      const units = sourceUnits(original, preparedByPath.get(original.path));
      if (!units) {
        blocked.push({ path: original.path, reason: "source-line-exceeds-unit-budget",
          action: "Split the oversized source line before authoring; no line was discarded." });
        continue;
      }
      for (const source of units) {
        const proposed = [...current, source];
        if (current.length && (current.length >= UNIT_FILES || current.some(item => item.path === source.path) ||
            size + source.bytes > UNIT_BYTES ||
            sections + source.sections > UNIT_SECTIONS ||
            scopeTask(`brownfield-${group.domain.slice(0, 50)}-${"0".repeat(12)}`, proposed).length > MAX_TASK)) publish();
        current.push(source); size += source.bytes; sections += source.sections;
      }
    }
    publish();
  }
  const plannedPaths = new Set(scopes.flatMap(scope => scope.sources.map(source => source.path)));
  for (const sourcePath of plannedPaths) {
    const ranges = scopes.flatMap(scope => scope.sources.filter(source => source.path === sourcePath)
      .flatMap(source => source.ranges)).sort((a, b) => a.start_line - b.start_line);
    let next = 1;
    for (const range of ranges) {
      if (range.start_line !== next) throw new Error(`Incomplete or overlapping primary line coverage: ${sourcePath}:${next}`);
      next = range.end_line + 1;
    }
    if (next !== preparedByPath.get(sourcePath).lines.length + 1) {
      throw new Error(`Incomplete primary line coverage: ${sourcePath}:${next}`);
    }
  }
  const accounted = plannedPaths.size + blocked.length + excluded.length;
  if (accounted !== manifest.sources.length) throw new Error("Specification scope accounting failed; no incomplete plan was returned.");
  return {
    schema_version: 1, generated_by: "mcpee", mode: "brownfield",
    status: blocked.length ? "blocked" : scopes.length ? "planned" : "empty",
    source_manifest_sha256: hash(bytes),
    summary: { inventory_sources: manifest.sources.length, planned_sources: plannedPaths.size,
      scopes: scopes.length, blocked_sources: blocked.length, excluded_sources: excluded.length },
    limits: { files_per_scope: UNIT_FILES, bytes_per_scope: UNIT_BYTES, sections_per_scope: UNIT_SECTIONS,
      context_bytes_per_scope: CONTEXT_BYTES, task_characters: MAX_TASK },
    scopes, blocked, excluded,
    limitations: [
      "This is read-only preparation, not authored specifications, validated business boundaries or automatic execution.",
      "Run each exported task against unchanged sources. Final artifacts use docs/specifications/{proposed,reviewed,approved}/<feature>/<case-slug>.md, graph and retrieval inventory; scope IDs remain internal provenance.",
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
    unit_version: scope.unit_version, source_selections: scope.source_selections,
    source_paths: [...scope.sources, ...scope.context_sources].map(source => source.path),
    primary_source_paths: scope.sources.map(source => source.path),
    context_paths: scope.context_sources.map(source => source.path), scope_status: report.status };
}

module.exports = { buildSpecificationScopes, validateSpecificationScopeTask, prepareScopeSources, scopeCoveredByManifest,
  withSpecificationScopePlanning };
