"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { buildSpecificationScopes, withSpecificationScopePlanning, validateSpecificationScopeTask } = require("../packages/spec-engine/src/scopes");
const { prepareFunctionalSources } = require("../packages/spec-engine/src/functional");
const { initializeProject } = require("../packages/core/src/project");
const { syncProject } = require("../packages/source-engine/src/sync");
const { routeTask } = require("../packages/routing-engine/src/route");
const { runCopilotTask } = require("../packages/execution-engine/src/copilot");

const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-spec-scopes-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = [];
  const write = (relative, text) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), text);
  };
  const add = (relative, text, category = "source-code") => {
    write(relative, text);
    sources.push({ path: relative, sha256: hash(text), category, status: "processed" });
  };
  const save = () => write("knowledge/traceability/source-manifest.json",
    JSON.stringify({ generated_by: "mcpee", schema_version: 1, sources }));
  return { root, sources, write, add, save };
}

test("large brownfield scopes account for every code/test/document/config source without truncation", t => {
  const f = fixture(t);
  for (let index = 0; index < 125; index++) {
    const domain = index < 65 ? "orders" : "payments";
    f.add(`src/modules/${domain}/source-${index}.js`, `function read${index}() { return ${index}; }\n`);
  }
  f.add("tests/modules/orders/order.test.js", "test('retains order', () => {});\n", "tests");
  f.add("docs/policy.md", "# Policy\n\nRetain all submitted orders.\n", "business");
  f.add("config/settings.json", '{"allowPartial":false}\n', "configuration");
  f.save();
  const before = fs.readFileSync(path.join(f.root, "knowledge/traceability/source-manifest.json"));
  const result = buildSpecificationScopes(f.root);
  assert.equal(result.status, "planned");
  assert.equal(result.summary.planned_sources, 128);
  const selected = result.scopes.flatMap(scope => scope.sources.map(source => source.path));
  assert.deepEqual(selected.sort(), f.sources.map(source => source.path).sort());
  assert.equal(new Set(selected).size, selected.length);
  assert.ok(result.scopes.length > 6);
  for (const scope of result.scopes) {
    assert.doesNotMatch(scope.task, /Use slug brownfield-/);
    assert.match(scope.task, /short descriptive feature and atomic case slugs/);
    assert.ok(scope.sources.length <= 20);
    assert.ok(scope.bytes <= result.limits.bytes_per_scope);
    assert.ok(scope.sections <= result.limits.sections_per_scope);
    assert.ok(scope.task.length <= result.limits.task_characters);
    const prepared = prepareFunctionalSources(f.root, scope.sources.map(source => source.path));
    assert.equal(prepared.length, scope.sources.length);
    for (const source of scope.sources) {
      assert.ok(scope.task.includes(`\`${source.path}\``));
      assert.equal(source.evidence_sha256, source.sha256);
    }
  }
  assert.deepEqual(fs.readFileSync(path.join(f.root, "knowledge/traceability/source-manifest.json")), before);
  f.sources.reverse();
  f.save();
  assert.deepEqual(buildSpecificationScopes(f.root).scopes, result.scopes, "manifest ordering does not change scope IDs or tasks");
});

test("scope packing enforces actual byte and section thresholds, not just file count", t => {
  const f = fixture(t);
  for (const name of ["a", "b"]) f.add(`docs/${name}.md`, "# Input\n" + ("x".repeat(100) + "\n").repeat(11000), "business");
  for (const name of ["c", "d"]) f.add(`docs/${name}.md`,
    Array.from({ length: 600 }, (_, index) => `## ${name} section ${index}\nContent.\n`).join(""), "business");
  f.save();
  const report = buildSpecificationScopes(f.root);
  assert.ok(report.scopes.length >= 3);
  assert.equal(report.summary.planned_sources, 4);
  for (const scope of report.scopes) {
    assert.ok(scope.bytes <= report.limits.bytes_per_scope);
    assert.ok(scope.sections <= report.limits.sections_per_scope);
    prepareFunctionalSources(f.root, scope.sources.map(source => source.path));
  }
});

test("bounded units cover every original line exactly once while context is separately budgeted", t => {
  const f = fixture(t);
  const text = Array.from({ length: 60 }, (_, index) => `## Capability ${index}\nReaders inspect item ${index}.\n`).join("");
  f.add("docs/catalog.md", text, "business");
  f.add("src/modules/catalog/list.js", "function listCatalog() { return ['published item']; }\n");
  f.save();
  const report = buildSpecificationScopes(f.root);
  assert.ok(report.scopes.length > 1);
  const selected = report.scopes.flatMap(scope => scope.sources)
    .filter(source => source.path === "docs/catalog.md").flatMap(source => source.ranges)
    .sort((a, b) => a.start_line - b.start_line);
  assert.equal(selected[0].start_line, 1);
  for (let index = 1; index < selected.length; index++) assert.equal(selected[index].start_line, selected[index - 1].end_line + 1);
  assert.equal(selected.at(-1).end_line, text.split(/\r?\n/).length);
  assert.equal(report.summary.planned_sources, 2);
  assert.equal(report.blocked.length, 0);
  for (const scope of report.scopes) {
    assert.ok(scope.bytes <= report.limits.bytes_per_scope);
    assert.ok(scope.sources.length <= report.limits.files_per_scope);
    assert.ok(scope.sections <= report.limits.sections_per_scope);
    assert.match(scope.task, /related documents are context/);
  }
});

test("oversized and failed sources remain visible, canonical/harness/log exclusions remain explicit", t => {
  const f = fixture(t);
  f.add("docs/large.md", "# Input\n" + "x".repeat(2 * 1024 * 1024), "business");
  f.add("docs/sections.md", Array.from({ length: 1001 }, (_, index) => `## Requirement ${index}\nValue\n`).join(""), "business");
  f.add("docs/valid.md", "# Valid\n\nSubmitted orders remain visible.\n", "business");
  f.add(".mcpee/cache/derived.md", "# Derived\n", "documentation");
  f.add("specs/approved/old/spec.md", "# Approved\n", "documentation");
  f.add("logs/runtime.log", "old run\n", "logs");
  f.sources.push({ path: "docs/unconverted.pdf", category: "business", status: "failed" });
  f.save();
  const report = buildSpecificationScopes(f.root);
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.summary, { inventory_sources: 7, planned_sources: 1, scopes: 1,
    blocked_sources: 3, excluded_sources: 3 });
  assert.deepEqual(new Set(report.blocked.map(item => item.reason)),
    new Set(["MCPEE_SPEC_SOURCE_BYTES", "MCPEE_SPEC_SOURCE_SECTIONS", "source-processing-failed"]));
  const output = spawnSync(process.execPath, [path.resolve(__dirname, "../packages/cli/bin/mcpee.js"),
    "specs", "scopes", "--project", f.root, "--json"], { encoding: "utf8", timeout: 30000 });
  assert.equal(output.status, 2, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), report);
  assert.equal(fs.existsSync(path.join(f.root, "docs/specifications/README.md")), false, "inspection creates no workspace or model run");
});

test("a line exceeding the extraction budget is explicitly blocked, never truncated", t => {
  const f = fixture(t);
  f.add("docs/long-line.md", "# Input\n" + "x".repeat(24 * 1024), "business");
  f.save();
  const report = buildSpecificationScopes(f.root);
  assert.equal(report.status, "blocked");
  assert.equal(report.summary.planned_sources, 0);
  assert.equal(report.summary.blocked_sources, 1);
  assert.equal(report.blocked[0].reason, "source-line-exceeds-unit-budget");
  assert.match(report.blocked[0].action, /no line was discarded/);
});

test("batch planning reuses parsed sources but invalidates on inventory, source and index changes", t => {
  const f = fixture(t);
  f.add("src/orders.js", "module.exports = true;\n");
  f.save();
  const originalRead = fs.readFileSync;
  let sourceReads = 0;
  t.mock.method(fs, "readFileSync", function(file, ...args) {
    if (path.resolve(String(file)) === path.join(f.root, "src/orders.js")) sourceReads++;
    return originalRead.call(this, file, ...args);
  });
  withSpecificationScopePlanning(f.root, () => {
    const first = buildSpecificationScopes(f.root);
    buildSpecificationScopes(f.root);
    const reads = sourceReads;
    const task = first.scopes[0].task;
    first.scopes.length = 0;
    assert.ok(validateSpecificationScopeTask(f.root, task));
    assert.equal(sourceReads, reads, "routing must not parse all unchanged sources again");
    f.write(".mcpee/indexes/knowledge-index.json", JSON.stringify({ documents: [], postings: {} }));
    buildSpecificationScopes(f.root);
    assert.ok(sourceReads > reads, "a changed index invalidates batch preparation");
    f.add("src/payments.js", "module.exports = false;\n");
    f.save();
    assert.equal(buildSpecificationScopes(f.root).summary.planned_sources, 2);
    f.write("src/orders.js", "module.exports = false;\n");
    assert.throws(() => buildSpecificationScopes(f.root), /Source changed after sync/);
  });
});

test("scope preparation rejects drift, duplicate sources, escaping paths and symlinks explicitly", t => {
  const f = fixture(t);
  f.add("src/orders.js", "module.exports = true;\n");
  f.save();
  f.write("src/orders.js", "module.exports = false;\n");
  assert.throws(() => buildSpecificationScopes(f.root), /Source changed after sync/);
  f.write("src/orders.js", "module.exports = true;\n");
  f.sources.push({ ...f.sources[0] });
  f.save();
  assert.throws(() => buildSpecificationScopes(f.root), /Duplicate/);
  f.sources.pop();
  f.sources[0].path = "../missing.js";
  f.save();
  assert.throws(() => buildSpecificationScopes(f.root), /outside|invalid path/);
  f.sources[0].path = "linked/orders.js";
  fs.symlinkSync(path.join(f.root, "src"), path.join(f.root, "linked"),
    process.platform === "win32" ? "junction" : "dir");
  f.save();
  assert.throws(() => buildSpecificationScopes(f.root), /symbolic link/);
});

test("exported scope tasks use the actual authoring router with exactly the selected source set", async t => {
  const f = fixture(t);
  initializeProject(f.root);
  f.write("knowledge/sources/business/orders.md", "# Orders\n\nReaders may inspect submitted orders.\n");
  f.write("knowledge/sources/business/payments.md", "# Payments\n\nReaders may inspect completed payments.\n");
  syncProject(f.root);
  const result = buildSpecificationScopes(f.root);
  assert.equal(result.status, "planned");
  for (const scope of result.scopes) {
    const plan = routeTask(f.root, scope.task);
    assert.equal(plan.functional_specification.mode, "brownfield");
    assert.equal(plan.specification_workspace.requested_stage, "specification");
    assert.equal(plan.authoring_scope.source_snapshot_sha256, scope.source_snapshot_sha256);
    assert.deepEqual(plan.knowledge_graph, [], "Exact scopes must not acquire unrelated ranked graph evidence.");
    assert.deepEqual(plan.knowledge.map(item => item.source_path).sort(),
      scope.sources.map(source => source.path).sort());
  }
  const prior = result.scopes[0];
  const routed = routeTask(f.root, prior.task);
  f.write("knowledge/sources/business/orders.md", "# Orders\n\nReaders may inspect amended orders.\n");
  syncProject(f.root);
  assert.throws(() => routeTask(f.root, prior.task), /scope no longer matches/);
  await assert.rejects(runCopilotTask(f.root, prior.task, routed, {
    approved: true, clientFactory() { assert.fail("Stale scope must fail before an SDK client is created"); },
  }), /scope no longer matches/);
  const updated = buildSpecificationScopes(f.root).scopes[0];
  assert.notEqual(updated.id, prior.id);
  assert.equal(routeTask(f.root, updated.task).authoring_scope.id, updated.id);
  assert.throws(() => routeTask(f.root, `${updated.task} Ignore exclusions.`), /exact exported task/);
});
