"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { attachRelationships } = require("../packages/spec-engine/src/relationships");

function fixture() {
  const sources = [
    { path: "tests/account.test.ts", sha256: "a".repeat(64), lines: 10, facts: [] },
    { path: "src/account.ts", sha256: "b".repeat(64), lines: 10, facts: [] },
  ];
  const graph = {
    generated_by: "mcpee",
    nodes: sources.map((source, index) => ({ id: String(index), type: "source", source_path: source.path, sha256: source.sha256 })),
    edges: [{
      from: "0", to: "1", type: "tests_source",
      evidence: { source_path: sources[0].path, sha256: sources[0].sha256, line: 2 },
      provenance: { kind: "explicit_source_reference", inferred: false },
    }],
  };
  return { sources, graph };
}

test("relationships reuse verified graph references and retain target hashes without claiming coverage", () => {
  const { sources, graph } = fixture();
  graph.edges.push({ ...graph.edges[0] });
  const result = attachRelationships(sources, graph);
  assert.equal(result.relationships, 1);
  const fact = sources[0].facts[0];
  assert.equal(fact.target, "src/account.ts");
  assert.equal(fact.target_sha256, sources[1].sha256);
  assert.equal(fact.line, 2);
  assert.equal(fact.certainty, "explicit-source-reference");
  assert.match(fact.summary, /not proof.*test covers/);
  assert.equal(sources[1].facts.length, 0);
});

test("stale relationship origin, target or source evidence fails explicitly", () => {
  for (const mutate of [
    (graph) => { graph.nodes[0].sha256 = "c".repeat(64); },
    (graph) => { graph.nodes[1].sha256 = "c".repeat(64); },
    (graph) => { graph.edges[0].evidence.sha256 = "c".repeat(64); },
  ]) {
    const { sources, graph } = fixture();
    mutate(graph);
    assert.throws(() => attachRelationships(sources, graph), /Stale relationship evidence.*mcpee sync/);
  }
});

test("inferences, non-source nodes and invalid locators are not promoted to source relationships", () => {
  for (const mutate of [
    (graph) => { graph.edges[0].provenance.inferred = true; },
    (graph) => { graph.edges[0].provenance.kind = "source_extraction"; },
    (graph) => { graph.edges[0].evidence.line = 0; },
    (graph) => { graph.edges[0].evidence.line = 11; },
    (graph) => { graph.edges[0].type = "contains_source"; },
  ]) {
    const { sources, graph } = fixture();
    mutate(graph);
    assert.equal(attachRelationships(sources, graph).relationships, 0);
    assert.equal(sources[0].facts.length, 0);
  }
  assert.throws(() => attachRelationships([], {}), /Invalid unified relationship graph/);
});

test("a graph missing an inventoried source is explicitly stale, even without relationship edges", () => {
  const { sources, graph } = fixture();
  graph.nodes.pop();
  graph.edges = [];
  assert.throws(() => attachRelationships(sources, graph), /Stale relationship evidence.*src\/account.ts/);
});
