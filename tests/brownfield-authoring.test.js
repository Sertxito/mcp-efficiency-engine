"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { initializeProject } = require("../packages/core/src/project");
const { syncProject, searchKnowledge } = require("../packages/source-engine/src/sync");
const { authorBrownfield, isBrownfieldRequest, brownfieldConcurrency } = require("../packages/spec-engine/src/brownfield-authoring");
const { prepareFunctionalSources, publishFunctionalSpec } = require("../packages/spec-engine/src/functional");
const { listFeatures } = require("../packages/spec-engine/src/lifecycle");
const { buildSpecificationScopes, prepareScopeSources } = require("../packages/spec-engine/src/scopes");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-brownfield-authoring-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/orders.js"), "function listOrders() { return ['submitted order']; }\n");
  fs.writeFileSync(path.join(root, "src/payments.js"), "function listPayments() { return ['paid invoice']; }\n");
  fs.mkdirSync(path.join(root, "src/modules/stock"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/modules/stock/list.js"), "function listStock() { return ['available stock']; }\n");
  fs.writeFileSync(path.join(root, "knowledge/sources/business/orders.md"),
    "# Orders\nVisitors can list submitted orders.\n");
  syncProject(root, { tools: [], graphify: { installed: false } });
  return root;
}

function executor(root, calls, nameForScope = scope => scope.domain) {
  return async (scope, plan) => {
    calls.push(scope.id);
    const sources = prepareScopeSources(root, scope);
    const slug = `${nameForScope(scope)}-access`;
    const specification = publishFunctionalSpec(root, JSON.stringify({
      language: "en", title: `Access ${scope.domain} information`, slug,
      summary: "Visitors can inspect the published information for this capability.",
      scope: ["Display the public information supported by the selected sources."],
      non_goals: ["Editing private records is outside the documented capability."],
      actors: [{ id: "ACT-001", name: "Visitor", goal: "Inspect the published information for this capability." }],
      use_cases: [{
        id: "UC-001", slug: `${scope.domain}-listing`, title: `Browse ${scope.domain} information`, actor: "ACT-001",
        goal: `Inspect the published ${scope.domain} information.`, basis: "observed", dependencies: [], open_questions: [],
        trigger: "The visitor opens the information listing.",
        preconditions: ["Public information has been published."],
        main_flow: ["The visitor requests the published information.", "The application displays the public listing."],
        alternatives: ["No published information produces an explicit empty listing."],
        postconditions: ["The visitor sees the published information."],
        rules: ["Only published information is included in the public listing."],
        acceptance_criteria: [{ given: "Public records have been published.", when: "The visitor opens the listing.", then: "Published records are displayed." }],
        evidence: sources.filter(source => source.coverage_role !== "context").flatMap(source =>
          source.headings.map(heading => ({ path: source.path, line: heading.line, quote: source.lines[heading.line - 1] }))),
      }],
      open_questions: [],
      coverage: sources.filter(source => source.coverage_role !== "context").flatMap(source => source.headings.map(heading => ({
        path: source.path, line: heading.line, status: "covered", use_cases: ["UC-001"],
        reason: "The listing capability accounts for the observed or documented public information.",
      }))),
    }), sources, { automatic: true, proposalOnly: true, authoringScope: plan.authoring_scope });
    return { specification, sessionId: "test-session" };
  };
}

test("documentation-only CLI brownfield does not require a ready application code graph", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-docs-brownfield-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  fs.writeFileSync(path.join(root, "knowledge/sources/business/catalog.md"),
    "# Public catalog\nVisitors can browse published books without signing in.\n");
  const { run } = require("../packages/cli/src/cli");
  await assert.rejects(() => run(["brownfield", "--project", root, "--last-domain", "unknown-domain"]), /Unknown brownfield last domain/);
  assert.equal(fs.existsSync(path.join(root, ".mcpee/state/codegraph.json")), false);
  assert.equal(fs.existsSync(path.join(root, ".git")), false);
});

test("complete brownfield combines code with original documentation and produces only proposals, then resumes without paid reruns", async t => {
  const root = fixture(t), calls = [];
  const planning = buildSpecificationScopes(root);
  const orders = planning.scopes.find(scope => scope.sources.some(source => source.path === "src/orders.js"));
  assert.ok(orders.context_sources.some(source => source.path.endsWith("orders.md")));
  const result = await authorBrownfield(root, { authorized: true, execute: executor(root, calls) });
  assert.equal(result.status, "completed");
  assert.equal(result.concurrency, 1);
  assert.equal(result.requested_concurrency, "auto");
  assert.equal(calls.length, planning.scopes.length);
  for (const feature of listFeatures(root)) {
    assert.equal(feature.document_state, "proposed");
    assert.equal(feature.authoritative, false);
    assert.equal(feature.reviews.specification.approved, false);
  }
  const resumed = await authorBrownfield(root, { authorized: true, execute: () => assert.fail("Current scopes must not spend quota again.") });
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.concurrency, 0);
  assert.equal(resumed.pending_authoring_units, 0);
  assert.ok(resumed.scopes.every(scope => scope.status === "preserved-current"));
});

test("automatic concurrency scales with remaining authoring work, never above ten", () => {
  for (const [pending, expected] of [[0, 0], [1, 1], [10, 1], [11, 2], [40, 4], [90, 9], [100, 10], [101, 10], [304, 10]]) {
    assert.equal(brownfieldConcurrency(pending), expected);
  }
  assert.equal(brownfieldConcurrency(130, 4), 4);
});

test("automatic concurrency excludes validated reusable proposals before choosing worker count", async t => {
  const root = fixture(t);
  await authorBrownfield(root, { authorized: true, execute: executor(root, []) });
  for (const domain of ["shipping", "delivery", "profile", "invoice", "supplier", "warehouse", "inventory", "returns"]) {
    fs.mkdirSync(path.join(root, "src/modules", domain), { recursive: true });
    fs.writeFileSync(path.join(root, "src/modules", domain, "list.js"), "function listItems() { return ['published item']; }\n");
  }
  syncProject(root, { tools: [], graphify: { installed: false } });
  const calls = [];
  const result = await authorBrownfield(root, { authorized: true, execute: executor(root, calls) });
  assert.equal(result.status, "completed");
  assert.ok(result.scopes.length > 10);
  assert.equal(result.pending_authoring_units, 8);
  assert.equal(result.concurrency, 1);
  assert.equal(calls.length, 8);
});

for (const concurrency of [4, 10]) test(`brownfield permits ${concurrency} concurrently active scopes with an explicit override`, async t => {
  const root = fixture(t);
  for (const domain of ["shipping", "delivery", "profile", "invoice", "supplier", "warehouse", "inventory"].slice(0, concurrency - 3)) {
    fs.mkdirSync(path.join(root, "src/modules", domain), { recursive: true });
    fs.writeFileSync(path.join(root, "src/modules", domain, "list.js"), "function listItems() { return ['published item']; }\n");
  }
  syncProject(root, { tools: [], graphify: { installed: false } });
  assert.ok(buildSpecificationScopes(root).scopes.length >= concurrency);
  let active = 0, peak = 0;
  let release;
  const firstWave = new Promise(resolve => { release = resolve; });
  const publish = executor(root, []);
  const result = await authorBrownfield(root, {
    authorized: true, concurrency,
    execute: async (scope, plan) => {
      active++;
      peak = Math.max(peak, active);
      if (active === concurrency) release();
      try {
        await firstWave;
        return await publish(scope, plan);
      } finally {
        active--;
      }
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.concurrency, concurrency);
  assert.equal(peak, concurrency);
});

test("previous whole-domain proposals remain reusable after upgrading the bounded planner", async t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, "knowledge/sources/business/orders.md"));
  syncProject(root, { tools: [], graphify: { installed: false } });
  const initial = await authorBrownfield(root, { authorized: true, execute: executor(root, []) });
  assert.equal(initial.status, "completed");
  for (const entry of initial.scopes) {
    const feature = listFeatures(root).find(item => item.id === entry.feature);
    assert.ok(feature);
    const { readFeature } = require("../packages/spec-engine/src/lifecycle");
    const { directory, manifest } = readFeature(root, feature.id);
    delete manifest.authoring_scope.unit_version;
    delete manifest.authoring_scope.source_selections;
    manifest.authoring_scope.id = `legacy-${entry.id}`;
    for (const source of manifest.sources) {
      delete source.coverage_role;
      delete source.selected_ranges;
    }
    fs.writeFileSync(path.join(root, directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  const resumed = await authorBrownfield(root, {
    authorized: true, execute: () => assert.fail("Current validated legacy proposals must not be regenerated."),
  });
  assert.equal(resumed.status, "completed", JSON.stringify(resumed.scopes.filter(scope => scope.status === "failed")));
  assert.ok(resumed.scopes.every(scope => scope.status === "preserved-current"));
});

test("brownfield cannot use local preparation as implicit paid authorization, or start a duplicate batch", async t => {
  const root = fixture(t);
  await assert.rejects(authorBrownfield(root), /authorizes Copilot/);
  fs.writeFileSync(path.join(root, ".mcpee/state/brownfield-authoring.lock"),
    JSON.stringify({ generated_by: "mcpee", pid: process.pid, token: "active" }));
  await assert.rejects(authorBrownfield(root, { authorized: true }), /already running/);
  const recovery = path.join(root, ".mcpee/state/brownfield-authoring.lock.recovery");
  fs.writeFileSync(recovery, JSON.stringify({ generated_by: "mcpee", pid: process.pid }));
  await assert.rejects(authorBrownfield(root, { authorized: true }), /recovery is already claimed/);
  assert.equal(fs.existsSync(recovery), true);
});

test("original document context is stable when generated specifications dominate lexical results", t => {
  const root = fixture(t);
  const original = buildSpecificationScopes(root).scopes.map(scope => scope.task);
  const filename = path.join(root, ".mcpee/indexes/knowledge-index.json");
  const index = JSON.parse(fs.readFileSync(filename, "utf8"));
  for (let i = 0; i < 110; i++) {
    const id = `generated-${i}`;
    index.documents.push({ source_id: id, source_path: `docs/specifications/proposed/feature-${i}/spec.md` });
    for (const term of ["orders", "payments"]) {
      index.postings[term] ||= [];
      index.postings[term].push({ source_id: id, frequency: 100000 });
    }
  }
  fs.writeFileSync(filename, JSON.stringify(index));
  assert.ok(searchKnowledge(root, "orders", 100).every(match => match.source_path.startsWith("docs/specifications/")));
  assert.deepEqual(buildSpecificationScopes(root).scopes.map(scope => scope.task), original);
});

test("scope planning loads the shared lexical index only once, preserving retrieval rankings", t => {
  const root = fixture(t);
  const originalRead = fs.readFileSync;
  const filename = path.join(root, ".mcpee/indexes/knowledge-index.json");
  let indexReads = 0;
  t.mock.method(fs, "readFileSync", function(file, ...args) {
    if (path.resolve(String(file)) === filename) indexReads++;
    return originalRead.call(this, file, ...args);
  });
  assert.ok(buildSpecificationScopes(root).scopes.length > 1);
  assert.equal(indexReads, 1);
  const { createKnowledgeSearch } = require("../packages/source-engine/src/sync");
  const sourcePaths = ["knowledge/sources/business/orders.md"];
  const search = createKnowledgeSearch(root, { sourcePaths });
  for (const query of ["orders", "payments", "submitted"]) {
    assert.deepEqual(search(query, 10), searchKnowledge(root, query, 10, { sourcePaths }));
  }
  assert.throws(() => search("", 10), /empty/);
  assert.throws(() => search("orders", 101), /limit/);
});

test("batch cancellation preserves completed proposals and does not start another paid scope", async t => {
  const root = fixture(t), cancellation = new AbortController(), calls = [];
  const execute = executor(root, calls);
  await assert.rejects(authorBrownfield(root, {
    authorized: true, concurrency: 1, signal: cancellation.signal, execute: async (scope, plan) => {
      const result = await execute(scope, plan);
      cancellation.abort(new Error("Host cancelled the batch"));
      return result;
    },
  }), /Host cancelled the batch/);
  assert.equal(calls.length, 1);
  assert.equal(listFeatures(root).length, 1);
  assert.equal(fs.existsSync(path.join(root, ".mcpee/state/brownfield-authoring.lock")), false);
});

test("brownfield resume binds the interrupted session to only its exact original scope", async t => {
  const root = fixture(t);
  const recoverable = require("../packages/execution-engine/src/recoverable-sessions");
  const scope = buildSpecificationScopes(root).scopes[0];
  const sessionId = "20000000-0000-4000-8000-000000000001";
  const session = recoverable.createSessionRecord(root, {
    session_id: sessionId, task_sha256: recoverable.hash(scope.task), execution_sha256: "a".repeat(64),
    workflow_id: "refine-backlog", agent_id: "product", model: "auto",
  });
  recoverable.updateSession(session, "interrupted", { error: "Structured validation failed." });
  const execute = executor(root, []), resumed = [];
  const result = await authorBrownfield(root, {
    authorized: true, resumeSessionId: sessionId, execute: (current, plan, options) => {
      if (options.resumeSessionId) resumed.push(current.id);
      return execute(current, plan);
    },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(resumed, [scope.id]);
  await assert.rejects(authorBrownfield(root, {
    authorized: true, resumeSessionId: sessionId, execute: () => assert.fail("Published scope must not be resumed."),
  }), /already published/);
});

test("failed model authoring leaves evidence and continues later scopes; retry skips all completed scopes", async t => {
  const root = fixture(t), calls = [];
  const execute = executor(root, calls);
  let count = 0;
  const partial = await authorBrownfield(root, {
    authorized: true, execute: (scope, plan) => {
      if (++count === 2) {
        const error = new Error("Injected SDK failure");
        error.sessionId = "failed-session";
        error.authoringEvidence = ".mcpee/reports/authoring/failed-attempt";
        throw error;
      }
      return execute(scope, plan);
    },
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.exitCode, 1);
  assert.equal(listFeatures(root).length, buildSpecificationScopes(root).scopes.length - 1);
  assert.equal(fs.existsSync(path.join(root, ".mcpee/state/brownfield-authoring.lock")), false);
  const reportDirectory = path.join(root, ".mcpee/reports/brownfield");
  const report = JSON.parse(fs.readFileSync(path.join(reportDirectory, fs.readdirSync(reportDirectory)[0]), "utf8"));
  assert.equal(report.status, "partial");
  assert.equal(report.scopes[1].status, "failed");
  assert.equal(report.scopes[1].error, "Injected SDK failure");
  assert.equal(report.scopes[1].session_id, "failed-session");
  assert.equal(report.scopes[1].authoring_evidence, ".mcpee/reports/authoring/failed-attempt");
  assert.equal(report.scopes.at(-1).status, "authored");
  assert.equal(report.summary.pending, 0);
  assert.equal(report.summary.active, 0);
  const result = await authorBrownfield(root, { authorized: true, execute });
  assert.equal(result.status, "completed");
  assert.equal(result.scopes[0].status, "preserved-current");
});

test("changed or edited authored evidence blocks reuse rather than silently accepting or overwriting it", async t => {
  const root = fixture(t);
  await authorBrownfield(root, { authorized: true, execute: executor(root, []) });
  const feature = listFeatures(root)[0];
  fs.appendFileSync(path.join(root, feature.path), "\nOwner changed the contract.\n");
  const partial = await authorBrownfield(root, {
    authorized: true, execute: () => assert.fail("Edited contract must not be overwritten."),
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.summary.failed, 1);
  assert.match(partial.scopes.find(scope => scope.status === "failed").error, /edited artifacts/);
});

test("a failed unit does not invalidate completed sibling units from the same source and domain", async t => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, "src/orders.js"), Array.from({ length: 14 }, (_, index) =>
    `function orderStep${index}() { return ${index}; }\n`).join(""));
  syncProject(root, { tools: [], graphify: { installed: false } });
  const units = buildSpecificationScopes(root).scopes.filter(scope =>
    scope.sources.some(source => source.path === "src/orders.js"));
  assert.equal(units.length, 2);
  assert.equal(units[0].domain, units[1].domain);
  const failed = units[0].id, calls = [];
  const execute = executor(root, calls, scope => {
    const source = scope.sources.find(source => source.path === "src/orders.js");
    return source ? source.ranges[0].start_line === 1 ? "order-listing" : "order-history" : scope.domain;
  });
  const partial = await authorBrownfield(root, {
    authorized: true, execute: (scope, plan) => {
      if (scope.id === failed) throw new Error("Injected bounded unit failure");
      return execute(scope, plan);
    },
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.summary.failed, 1);
  assert.equal(partial.scopes.find(scope => scope.id === units[1].id).status, "authored");
  calls.length = 0;
  const resumed = await authorBrownfield(root, { authorized: true, execute });
  assert.equal(resumed.status, "completed");
  assert.deepEqual(calls, [failed]);
  assert.equal(resumed.scopes.find(scope => scope.id === units[1].id).status, "preserved-current");
});

test("bounded parallel authoring drains independent scopes before a last-domain scope and reports accurate counts", async t => {
  const root = fixture(t), planning = buildSpecificationScopes(root);
  const deferred = planning.scopes[0].domain;
  const execute = executor(root, []), completed = [], progress = [];
  let active = 0, peak = 0;
  const result = await authorBrownfield(root, {
    authorized: true, concurrency: 2, lastDomains: [deferred], onProgress: update => progress.push(update),
    execute: async (scope, plan) => {
      if (scope.domain === deferred) {
        assert.ok(planning.scopes.filter(item => item.domain !== deferred).every(item => completed.includes(item.id)));
      }
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 20));
      try { return await execute(scope, plan); }
      finally { active--; completed.push(scope.id); }
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(peak, 2);
  assert.equal(result.summary.completed, planning.scopes.length);
  assert.equal(result.scopes.at(-1).domain, deferred);
  assert.match(result.duration_notice, /hours/);
  assert.ok(progress.every(update => update.completed + update.failed + update.active + update.pending === update.total));
  assert.equal(progress.at(-1).pending, 0);
  assert.equal(progress.at(-1).active, 0);
});

test("invalid concurrency and unknown deferred domains fail explicitly before model work", async t => {
  const root = fixture(t);
  for (const concurrency of [0, 11, 1.5, "2"]) {
    await assert.rejects(authorBrownfield(root, { authorized: true, concurrency }), /concurrency/);
  }
  await assert.rejects(authorBrownfield(root, { authorized: true, lastDomains: ["missing"],
    execute: () => assert.fail("Unknown domain must not spend quota.") }), /Unknown brownfield last domain/);
});

test("long-running scopes emit heartbeat counts without claiming new model progress", async t => {
  const root = fixture(t), updates = [];
  t.mock.timers.enable({ apis: ["setInterval"] });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let markStarted;
  const firstStarted = new Promise(resolve => { markStarted = resolve; });
  const execute = executor(root, []);
  const pending = authorBrownfield(root, {
    authorized: true, concurrency: 1, onProgress: update => {
      updates.push(update);
      if (update.event === "started") markStarted();
    },
    execute: async (scope, plan) => { await gate; return execute(scope, plan); },
  });
  await firstStarted;
  const started = updates.find(update => update.event === "started");
  t.mock.timers.tick(30_000);
  const heartbeat = updates.find(update => update.event === "heartbeat");
  assert.ok(heartbeat);
  assert.equal(heartbeat.completed, 0);
  assert.equal(heartbeat.active, 1);
  assert.equal(heartbeat.last_activity_at, started.last_activity_at);
  release();
  assert.equal((await pending).status, "completed");
});

test("blocked source conversion remains explicit but eligible independent scopes are still authored", async t => {
  const root = fixture(t);
  const filename = path.join(root, "knowledge/traceability/source-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
  const blocked = manifest.sources.find(source => source.path === "src/payments.js");
  blocked.status = "failed";
  fs.writeFileSync(filename, JSON.stringify(manifest));
  const calls = [];
  const partial = await authorBrownfield(root, { authorized: true, execute: executor(root, calls) });
  assert.equal(partial.status, "partial");
  assert.ok(calls.length > 0);
  assert.ok(partial.blocked_sources.some(source => source.path === blocked.path));
  assert.ok(partial.scopes.every(scope => !scope.primary_sources.includes(blocked.path)));
});

test("only explicit whole-project brownfield requests enter automatic orchestration", () => {
  for (const task of ["Run brownfield for this project", "haz el brownfield", "hazme el brownfield", "Lanza el brownfield", "Run the complete brownfield", "brownfield"]) assert.equal(isBrownfieldRequest(task), true);
  for (const task of ["Explain brownfield", "¿Qué es brownfield?", "Fix a brownfield login bug", "Analiza este error de brownfield", "Run tests for a brownfield login bug", "Generate brownfield functional specifications for scope abc from `src/app.js`."]) {
    assert.equal(isBrownfieldRequest(task), false);
  }
});
