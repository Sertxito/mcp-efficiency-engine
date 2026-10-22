"use strict";

const { GRAPH_PATH } = require("../../knowledge-engine/src/unified");

const RELATIONSHIPS = new Set([
  "imports_source", "tests_source", "links_to_source",
  "contains_dotnet_project", "references_dotnet_project", "imports_build_file",
  "declares_local_module", "references_api_schema", "uses_local_action",
  "references_local_schema", "references_database_table", "depends_on_local_package",
]);

function attachRelationships(sources, graph) {
  if (graph.generated_by !== "mcpee" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("Invalid unified relationship graph; run mcpee sync before specification discovery.");
  }
  const inventory = new Map(sources.map((source) => [source.path, source]));
  const nodes = new Map(graph.nodes.filter((node) => node.type === "source").map((node) => [node.id, node]));
  const nodesByPath = new Map([...nodes.values()].map((node) => [node.source_path, node]));
  for (const source of sources) {
    if (nodesByPath.get(source.path)?.sha256 !== source.sha256) {
      throw new Error(`Stale relationship evidence for ${source.path}; run mcpee sync before specification discovery.`);
    }
  }
  const seen = new Set();
  for (const edge of graph.edges) {
    if (!RELATIONSHIPS.has(edge.type)) continue;
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    const source = inventory.get(from?.source_path), target = inventory.get(to?.source_path);
    if (!source || !target) continue;
    if (from.sha256 !== source.sha256 || to.sha256 !== target.sha256 ||
        edge.evidence?.source_path !== source.path || edge.evidence.sha256 !== source.sha256) {
      throw new Error(`Stale relationship evidence for ${source.path}; run mcpee sync before specification discovery.`);
    }
    const directReference = edge.provenance?.kind === "explicit_source_reference" ||
      ["declares_local_module", "contains_dotnet_project"].includes(edge.type) &&
        edge.provenance?.kind === "source_extraction";
    if (edge.provenance?.inferred !== false || !directReference ||
        !Number.isInteger(edge.evidence.line) ||
        edge.evidence.line < 1 || source.lines !== null && edge.evidence.line > source.lines) continue;
    const key = `${source.path}:${edge.type}:${target.path}:${edge.evidence.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    source.facts.push({
      kind: "source-relationship", line: edge.evidence.line,
      certainty: "explicit-source-reference", relationship: edge.type,
      target: target.path, target_sha256: target.sha256,
      summary: `${edge.type}: ${target.path}. An explicit source reference, not proof that a function is called or a test covers it.`,
    });
  }
  return { status: "available", relationships: seen.size, source: GRAPH_PATH };
}

module.exports = { attachRelationships };
