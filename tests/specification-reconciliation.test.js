"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { initializeProject } = require("../packages/core/src/project");
const { syncProject } = require("../packages/source-engine/src/sync");
const { prepareFunctionalSources, publishFunctionalSpec } = require("../packages/spec-engine/src/functional");
const { buildSpecificationScopes } = require("../packages/spec-engine/src/scopes");
const { buildSpecificationReconciliation } = require("../packages/spec-engine/src/reconciliation");
const { GRAPH_PATH } = require("../packages/knowledge-engine/src/unified");

function documentFor(scope, source) {
  const sourceLines = fs.readFileSync(path.join(source.root, source.path), "utf8").split(/\r?\n/);
  const citations = source.headings.map(heading => ({
    path: source.path, line: heading.line, quote: sourceLines[heading.line - 1].trim(),
  }));
  return {
    language: "en", title: `Workflow for ${scope.domain}`,
    slug: scope.id, summary: "A user completes a service request using the available workflow.",
    scope: ["Users complete the supported request."],
    non_goals: ["Administrative configuration remains outside this workflow."],
    actors: [{ id: "ACT-001", name: "User", goal: "Complete the requested operation." }],
    use_cases: [{
      id: "UC-001", title: `Complete the ${scope.domain} operation`,
      actor: "ACT-001", goal: "A user completes a service request using the available workflow.",
      dependencies: [], open_questions: [], basis: "observed",
      trigger: "The user starts the operation.",
      preconditions: ["The service is available to the user."],
      main_flow: ["The user submits the operation.", "The service completes the operation."],
      alternatives: ["The service reports a recoverable failure."],
      postconditions: ["The result is available to the user."],
      rules: ["The service preserves the submitted request."],
      acceptance_criteria: [{ given: "The service is available.", when: "The user submits a request.", then: "The service returns the completed result." }],
      evidence: citations,
    }],
    open_questions: [],
    coverage: source.headings.map(heading => ({
      path: source.path, line: heading.line, status: "covered",
      use_cases: ["UC-001"], reason: "This source section describes the operation.",
    })),
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-spec-reconciliation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  fs.mkdirSync(path.join(root, "src/modules/orders"), { recursive: true });
  fs.mkdirSync(path.join(root, "src/modules/payments"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/modules/orders/index.js"),
    'const payments = require("../payments/index.js");\nfunction submitOrder() { return payments.status(); }\nmodule.exports = { submitOrder };\n');
  fs.writeFileSync(path.join(root, "src/modules/payments/index.js"),
    'function status() { return "paid"; }\nmodule.exports = { status };\n');
  syncProject(root, { generateDocumentation: false, tools: [], graphify: { installed: false } });
  return root;
}

test("reconciliation persists a source-bound case matrix and flags candidates without granting approval", t => {
  const root = fixture(t);
  const scopes = buildSpecificationScopes(root).scopes;
  assert.deepEqual(scopes.map(scope => scope.domain), ["order", "payment"]);

  const incomplete = buildSpecificationReconciliation(root);
  assert.equal(incomplete.status, "incomplete");
  assert.equal(incomplete.summary.missing_specifications, 2);

  for (const scope of scopes) {
    const source = prepareFunctionalSources(root, scope.sources.map(item => item.path))[0];
    publishFunctionalSpec(root, JSON.stringify(documentFor(scope, { ...source, root })), [source], { automatic: true });
  }
  const report = buildSpecificationReconciliation(root);
  assert.equal(report.status, "review-required");
  assert.equal(report.summary.structurally_validated, 2);
  assert.equal(report.summary.cases, 2);
  assert.equal(report.summary.duplicate_candidates, 1);
  assert.equal(report.summary.cross_scope_source_dependencies, 1);
  assert.equal(report.review_gates.owner_review_required, true);
  assert.equal(report.review_gates.semantic_completeness_proven, false);
  assert.equal(report.review_gates.product_acceptance_granted, false);
  assert.equal(report.graph.status, "current");
  const stored = JSON.parse(fs.readFileSync(path.join(root, report.path), "utf8"));
  assert.equal(stored.source_manifest_sha256, report.source_manifest_sha256);
  assert.equal(stored.scope_matrix[0].status, "source-bound-structurally-validated");
  const command = spawnSync(process.execPath, [
    path.resolve(__dirname, "../packages/cli/bin/mcpee.js"),
    "specs", "reconcile", "--project", root, "--json",
  ], { encoding: "utf8", timeout: 30000 });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).status, "review-required");

  const caseFile = path.join(root, report.scope_matrix[0].cases[0].case_file);
  fs.appendFileSync(caseFile, "\nOwner edit.\n");
  const stale = buildSpecificationReconciliation(root);
  assert.equal(stale.status, "blocked");
  assert.ok(stale.scope_matrix.some(scope => scope.issues.some(issue => issue.type === "case-artifact-drift")));
});

test("reconciliation reports stale graphs and missing specifications instead of inferring dependencies", t => {
  const root = fixture(t);
  const graphPath = path.join(root, GRAPH_PATH);
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  graph.nodes.find(node => node.type === "source" && node.source_path === "src/modules/orders/index.js").sha256 = "0".repeat(64);
  fs.writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  const stale = buildSpecificationReconciliation(root);
  assert.equal(stale.status, "blocked");
  assert.equal(stale.graph.status, "stale");
  assert.equal(stale.summary.missing_specifications, 2);
  assert.equal(stale.summary.cross_scope_source_dependencies, 0);
});
