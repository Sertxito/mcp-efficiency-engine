"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { renameAtomicSync } = require("../../core/src/atomic-file");
const { readProjectFile } = require("../../evaluation-engine/src/asset-evaluation");
const { buildSpecificationScopes, scopeCoveredByManifest } = require("./scopes");
const { projectPath, ensureDirectory } = require("./brownfield");
const { GRAPH_PATH } = require("../../knowledge-engine/src/unified");
const { listFeatures, readFeature, workspace } = require("./lifecycle");
const { caseFileName } = require("./naming");

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const REPORT_PATH = ".mcpee/state/specification-reconciliation.json";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

function readJson(root, relative, label) {
  const { contents } = readProjectFile(root, relative, MAX_FILE_BYTES, label);
  try {
    return { value: JSON.parse(contents.toString("utf8")), bytes: contents };
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function normalizedText(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function currentSourceDigest(root, source) {
  const sourcePath = source.original_path || source.path;
  const expected = source.original_sha256 || source.sha256;
  const filename = projectPath(root, sourcePath);
  return fs.existsSync(filename) && hash(fs.readFileSync(filename)) === expected;
}

function sourceSet(sources) {
  return JSON.stringify(sources.map(source => ({
    path: source.original_path || source.path,
    sha256: source.original_sha256 || source.sha256,
  })).sort((left, right) => left.path.localeCompare(right.path)));
}

function inspectScope(root, scope, features) {
  const matches = features.filter(({ directory, manifest }) =>
    directory === `specs/${scope.id}` || manifest.authoring_scope?.id === scope.id ||
    !scope.unit_version && sourceSet(manifest.sources) === sourceSet(scope.sources) ||
    scope.unit_version === 2 && !manifest.authoring_scope?.unit_version && scopeCoveredByManifest(scope, manifest));
  if (matches.length > 1) {
    return { scope_id: scope.id, domain: scope.domain, grouping: scope.grouping,
      source_snapshot_sha256: scope.source_snapshot_sha256,
      status: "ambiguous-specification", cases: [],
      issues: [{ type: "multiple-specifications-for-scope", paths: matches.map(item => item.directory) }] };
  }
  const directory = matches[0]?.directory || workspace(scope.id, root);
  const manifestPath = `${directory}/manifest.json`;
  if (!fs.existsSync(projectPath(root, manifestPath))) {
    return { scope_id: scope.id, domain: scope.domain, grouping: scope.grouping,
      source_snapshot_sha256: scope.source_snapshot_sha256,
      status: "missing-specification", cases: [], issues: [{ type: "missing-specification" }] };
  }
  const { value: manifest, bytes: manifestBytes } = readJson(root, manifestPath, "Canonical specification manifest");
  if (manifest.generated_by !== "mcpee" || manifest.kind !== "atomic-functional-specifications" ||
      manifest.index !== `${directory}/spec.md` || manifest.document !== `${directory}/specification.json` ||
      !Array.isArray(manifest.sources) || !Array.isArray(manifest.cases) ||
      !/^[a-f0-9]{64}$/.test(manifest.index_sha256 || "") ||
      !/^[a-f0-9]{64}$/.test(manifest.document_sha256 || "")) {
    return { scope_id: scope.id, domain: scope.domain, grouping: scope.grouping,
      source_snapshot_sha256: scope.source_snapshot_sha256,
      status: "invalid-specification-manifest", cases: [], manifest_sha256: hash(manifestBytes),
      issues: [{ type: "invalid-specification-manifest" }] };
  }
  const issues = [];
  const expectedSources = [...scope.sources, ...scope.context_sources].map(source => ({
    path: source.path, sha256: source.sha256,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const authoredSources = manifest.sources.map(source => ({
    path: source.original_path || source.path,
    sha256: source.original_sha256 || source.sha256,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const legacy = scope.unit_version === 2 && !manifest.authoring_scope?.unit_version && scopeCoveredByManifest(scope, manifest);
  if (!legacy && JSON.stringify(expectedSources) !== JSON.stringify(authoredSources)) {
    issues.push({ type: "source-scope-mismatch" });
  }
  if (scope.unit_version === 2 && !legacy &&
      (JSON.stringify(manifest.authoring_scope?.source_selections) !== JSON.stringify(scope.source_selections) ||
      JSON.stringify(manifest.sources.map(source => ({
        path: source.original_path || source.path, sha256: source.original_sha256 || source.sha256,
        role: source.coverage_role, ranges: source.selected_ranges,
      }))) !== JSON.stringify(scope.source_selections))) {
    issues.push({ type: "source-selection-mismatch" });
  }
  if (manifest.sources.some(source => !currentSourceDigest(root, source))) {
    issues.push({ type: "source-drift" });
  }
  const index = readProjectFile(root, manifest.index, 4 * 1024 * 1024, "Canonical specification index").contents;
  const documentResult = readJson(root, manifest.document, "Canonical functional specification");
  const document = documentResult.value;
  if (hash(index) !== manifest.index_sha256 ||
      hash(documentResult.bytes) !== manifest.document_sha256 ||
      path.posix.basename(directory) !== document.slug || !Array.isArray(document.use_cases) ||
      document.use_cases.length !== manifest.cases.length) {
    issues.push({ type: "specification-artifact-drift" });
  }
  const manifestCases = new Map(manifest.cases.map(item => [item.id, item]));
  const cases = [];
  for (const useCase of document.use_cases || []) {
    const item = manifestCases.get(useCase.id);
    if (!item || (item.path !== `${directory}/${useCase.id}.md` &&
        item.path !== `${directory}/${caseFileName(useCase)}`) ||
        !/^[a-f0-9]{64}$/.test(item.sha256 || "")) {
      issues.push({ type: "invalid-case-manifest", case_id: useCase.id });
      continue;
    }
    const caseBytes = readProjectFile(root, item.path, 1024 * 1024, "Canonical use-case specification").contents;
    if (hash(caseBytes) !== item.sha256) issues.push({ type: "case-artifact-drift", case_id: useCase.id });
    cases.push({
      scope_id: scope.id, id: useCase.id, title: useCase.title, goal: useCase.goal,
      basis: useCase.basis, dependencies: [...useCase.dependencies].sort(),
      open_questions: [...useCase.open_questions],
      evidence: useCase.evidence.map(reference => ({
        path: reference.path, line: reference.line,
        quote_sha256: hash(reference.quote),
        normalized_quote_sha256: hash(normalizedText(reference.quote)),
      })),
      specification_sha256: hash(JSON.stringify(useCase)),
      case_file: item.path, case_file_sha256: item.sha256,
    });
  }
  return {
    scope_id: scope.id, domain: scope.domain,
    grouping: scope.grouping,
    source_snapshot_sha256: scope.source_snapshot_sha256,
    manifest_path: manifestPath, manifest_sha256: hash(manifestBytes),
    specification_sha256: manifest.document_sha256,
    status: issues.length ? "blocked" : "source-bound-structurally-validated",
    cases, unresolved_decisions: manifest.unresolved_decisions,
    deferred_sections: manifest.deferred_sections, issues,
  };
}

function graphReconciliation(root, scopes, sourceHashes) {
  const graphPath = projectPath(root, GRAPH_PATH);
  if (!fs.existsSync(graphPath)) return {
    status: "missing", sha256: null, cross_scope_source_dependencies: [], contradiction_candidates: [],
  };
  const { value: graph, bytes } = readJson(root, GRAPH_PATH, "Unified evidence graph");
  if (graph.generated_by !== "mcpee" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) ||
      !Array.isArray(graph.findings)) {
    throw new Error("Unified evidence graph failed its reconciliation schema checks.");
  }
  const nodes = new Map(graph.nodes.filter(node => node.type === "source" &&
    typeof node.source_path === "string").map(node => [node.source_path, node]));
  const graphCurrent = [...sourceHashes].every(([sourcePath, digest]) =>
    nodes.get(sourcePath)?.sha256 === digest);
  if (!graphCurrent) return {
    status: "stale", sha256: hash(bytes), cross_scope_source_dependencies: [], contradiction_candidates: [],
  };
  const scopeBySource = new Map();
  for (const scope of scopes) {
    for (const source of scope.sources) {
      const entries = scopeBySource.get(source.path) || [];
      entries.push({ scope_id: scope.id, ranges: source.ranges });
      scopeBySource.set(source.path, entries);
    }
  }
  const nodeScope = new Map([...nodes.values()].flatMap(node => {
    const entries = scopeBySource.get(node.source_path);
    return entries ? [[node.id, entries.map(item => ({ ...item, source_path: node.source_path }))]] : [];
  }));
  const crossScope = graph.edges.flatMap(edge => {
    if (!["imports_source", "tests_source"].includes(edge.type)) return [];
    const from = nodeScope.get(edge.from), to = nodeScope.get(edge.to);
    if (!from || !to) return [];
    return from.flatMap(origin => to.filter(target => origin.scope_id !== target.scope_id).map(target => ({
      from_scope: origin.scope_id, to_scope: target.scope_id, type: edge.type,
      source_path: origin.source_path, target_path: target.source_path,
      evidence: edge.evidence || null,
    })));
  });
  const contradictions = graph.findings.filter(finding =>
    finding.type === "conflicting_source_claims").flatMap(finding => {
    const claims = (finding.claims || []).flatMap(claim => {
      const entries = (scopeBySource.get(claim.source_path) || []).filter(item =>
        !item.ranges || item.ranges.some(range => claim.line >= range.start_line && claim.line <= range.end_line));
      return (entries.length ? entries : [{ scope_id: null }]).map(item => ({
        scope_id: item.scope_id, source_path: claim.source_path, line: claim.line, quote: claim.quote,
      }));
    });
    const scopeIds = [...new Set(claims.map(claim => claim.scope_id).filter(Boolean))].sort();
    return scopeIds.length > 1 ? [{
      type: "source-claim-conflict-candidate", finding_id: finding.id,
      scopes: scopeIds, claims,
    }] : [];
  });
  return {
    status: "current", sha256: hash(bytes),
    cross_scope_source_dependencies: crossScope,
    contradiction_candidates: contradictions,
  };
}

function buildSpecificationReconciliation(projectRoot) {
  const root = path.resolve(projectRoot);
  const planning = buildSpecificationScopes(root);
  const features = listFeatures(root).filter(feature => feature.status !== "unvalidated-manual-draft")
    .map(feature => readFeature(root, feature.id));
  const scopeMatrix = planning.scopes.map(scope => inspectScope(root, scope, features));
  const distinctFeatures = [...new Map(scopeMatrix.filter(scope => scope.manifest_path)
    .map(scope => [scope.manifest_path, scope])).values()];
  const cases = [...new Map(scopeMatrix.flatMap(scope => scope.cases)
    .map(item => [item.case_file, item])).values()];
  const goals = new Map();
  for (const item of cases) {
    const key = normalizedText(item.goal);
    if (!key) continue;
    const matches = goals.get(key) || [];
    matches.push(item);
    goals.set(key, matches);
  }
  const duplicateCandidates = [...goals.values()].filter(items =>
    new Set(items.map(item => item.scope_id)).size > 1).map(items => ({
    type: "exact-normalized-goal-match", scopes: [...new Set(items.map(item => item.scope_id))].sort(),
    cases: items.map(({ scope_id, id, title, goal, specification_sha256 }) =>
      ({ scope_id, id, title, goal, specification_sha256 })),
    disposition: "owner-review-required; textual equality is not proof of duplicate behavior",
  }));
  const sharedEvidence = new Map();
  for (const item of cases) {
    for (const reference of item.evidence) {
      const key = `${reference.path}:${reference.line}`;
      const matches = sharedEvidence.get(key) || [];
      matches.push({
        scope_id: item.scope_id, case_id: item.id,
        quote_sha256: reference.quote_sha256,
        normalized_quote_sha256: reference.normalized_quote_sha256,
      });
      sharedEvidence.set(key, matches);
    }
  }
  const sharedEvidenceCandidates = [...sharedEvidence.values()].filter(items =>
    new Set(items.map(item => item.scope_id)).size > 1).map(items => ({
    type: new Set(items.map(item => item.normalized_quote_sha256)).size > 1
      ? "shared-source-divergent-quotes" : "shared-source-reuse",
    references: items.map(({ normalized_quote_sha256, ...item }) => item),
    disposition: "review source scope and claims; evidence overlap does not establish a contradiction",
  }));
  const sourceHashes = new Map(planning.scopes.flatMap(scope =>
    scope.sources.map(source => [source.path, source.sha256])));
  const missing = scopeMatrix.filter(scope => scope.status === "missing-specification").length;
  const blocked = scopeMatrix.filter(scope => scope.status !== "source-bound-structurally-validated" &&
    scope.status !== "missing-specification").length;
  const graph = graphReconciliation(root, planning.scopes, sourceHashes);
  const graphBlocked = planning.scopes.length > 0 && graph.status !== "current";
  const report = {
    schema_version: 1, generated_by: "mcpee", kind: "brownfield-specification-reconciliation",
    status: planning.status === "empty" && !planning.blocked.length ? "empty"
      : planning.status === "blocked" || blocked || graphBlocked ? "blocked"
      : missing ? "incomplete" : "review-required",
    source_manifest_sha256: planning.source_manifest_sha256,
    generated_at: new Date().toISOString(),
    scope_planning: {
      summary: planning.summary, blocked: planning.blocked, excluded: planning.excluded,
    },
    summary: {
      scopes: scopeMatrix.length,
      structurally_validated: scopeMatrix.filter(scope =>
        scope.status === "source-bound-structurally-validated").length,
      missing_specifications: missing,
      blocked_scopes: blocked,
      blocked_sources: planning.summary.blocked_sources,
      excluded_sources: planning.summary.excluded_sources,
      cases: cases.length,
      unresolved_decisions: distinctFeatures.reduce((total, scope) => total + (scope.unresolved_decisions || 0), 0),
      duplicate_candidates: duplicateCandidates.length,
      shared_evidence_candidates: sharedEvidenceCandidates.length,
      cross_scope_source_dependencies: graph.cross_scope_source_dependencies.length,
      contradiction_candidates: graph.contradiction_candidates.length,
    },
    scope_matrix: scopeMatrix,
    duplicate_candidates: duplicateCandidates,
    shared_evidence_candidates: sharedEvidenceCandidates,
    graph,
    review_gates: {
      owner_review_required: true,
      semantic_completeness_proven: false,
      business_contradictions_resolved: false,
      product_acceptance_granted: false,
    },
    limitations: [
      "Exact goal matches and shared citations are review candidates, not semantic duplicate or contradiction findings.",
      "Graph imports and test-source links show technical source coupling, not business use-case prerequisites.",
      "The report is linked to current source, scope, specification, case and graph hashes; it never approves or rewrites canonical specifications.",
    ],
  };
  const target = projectPath(root, REPORT_PATH);
  const directory = ensureDirectory(root, path.posix.dirname(REPORT_PATH));
  const temporary = path.join(directory, `${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameAtomicSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { ...report, path: REPORT_PATH };
}

module.exports = { buildSpecificationReconciliation };
