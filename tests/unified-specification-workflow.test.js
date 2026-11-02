"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { after, test } = require("node:test");
const { initializeProject } = require("../packages/core/src/project");
const { syncProject, searchKnowledge } = require("../packages/source-engine/src/sync");
const { prepareFunctionalSources, publishFunctionalSpec, validateFunctionalSpec } = require("../packages/spec-engine/src/functional");
const { prepareApprovedSpecContext } = require("../packages/spec-engine/src/brownfield");
const { featureStatus, canonicalArtifacts, advanceValidatedStages, resolveDecision } = require("../packages/spec-engine/src/lifecycle");
const { validatePhase, publishPhase, renderPhase, recoverAuthoring, prepareImplementationValidation } = require("../packages/spec-engine/src/phases");
const { routeTask } = require("../packages/routing-engine/src/route");
const { runCopilotTask } = require("../packages/execution-engine/src/copilot");
const { chunkDocument } = require("../packages/source-engine/src/embeddings");
const { createPlan } = require("../packages/planning-engine/src/planning");
const { synchronizeAfterCopilotChanges } = require("../packages/cli/src/cli");
const { createCopilotHooks, createPermissionRequestHandler } = require("../packages/execution-engine/src/copilot");
const { executeRunSpec, loadRunSpec } = require("../packages/evaluation-engine/src/evaluate");
const { runSpecificationLifecycle } = require("../packages/spec-engine/src/orchestration");
const { recordImplementationVerification } = require("../packages/spec-engine/src/verification");

let executionSessionCount = 0;
const roots = [];
after(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const read = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
function fixture({ brownfield = false, question = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-unified-spec-"));
  roots.push(root);
  initializeProject(root);
  const file = "knowledge/sources/business/catalog.md";
  fs.writeFileSync(path.join(root, file), "# Public catalog\n\n## Search\nReaders search the public catalog without authentication.\n");
  if (brownfield) {
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, "tests"));
    fs.writeFileSync(path.join(root, "src", "catalog.js"),
      "export function searchCatalog(title) {\n  return title ? ['Matching book'] : [];\n}\n\nexport function catalogAvailable() { return true; }\n");
    fs.writeFileSync(path.join(root, "tests", "catalog.test.js"), "test('anonymous search returns matching titles', () => searchCatalog('Book'));\n");
    fs.writeFileSync(path.join(root, "catalog.config.json"), '{"authentication": "not-required"}\n');
  }
  syncProject(root, { generateDocumentation: false, graphify: { installed: false } });
  const plan = routeTask(root, `Draft ${brownfield ? "brownfield" : "greenfield"} functional specifications`);
  const sources = prepareFunctionalSources(root, plan.knowledge.map(source => source.source_path));
  const document = {
    language: "en", title: "Public catalog specifications", slug: "public-catalog",
    summary: "Allow library readers to discover matching books without authentication.",
    scope: ["Anonymous public catalog search returns matching book titles."],
    non_goals: ["Private account management and lending are outside this feature."],
    actors: [{ id: "ACT-001", name: "Library reader", goal: "Find matching books in the public catalog." }],
    use_cases: [{
      id: "UC-001", title: "Search the public book catalog", actor: "ACT-001",
      basis: brownfield ? "observed" : "documented",
      goal: "Find books matching a title without authenticating.",
      dependencies: [], open_questions: [],
      trigger: "The reader submits a title to the public catalog.",
      preconditions: ["The public catalog is available to anonymous readers."],
      main_flow: ["The reader enters a book title.", "The catalog returns matching book titles."],
      alternatives: ["A search without matches displays an explicit no-results state."],
      postconditions: ["The reader sees matching titles without signing in."],
      rules: ["Public catalog search does not require authentication."],
      acceptance_criteria: [{ given: "The reader has not authenticated.", when: "They search for an existing book title.",
        then: "The catalog displays matching book titles without requesting authentication." }],
      evidence: [{ path: file, line: 4, quote: "Readers search the public catalog without authentication." }],
    }],
    open_questions: question ? ["Who chooses the public catalog availability policy?"] : [],
    coverage: sources.flatMap(source => source.headings.map(section => ({
      path: source.path, line: section.line, status: "covered", use_cases: ["UC-001"],
      reason: "Public search behavior, supporting checks and configuration inform this use case.",
    }))),
  };
  document.use_cases[0].evidence.push(...sources.filter(source => source.path !== file)
    .flatMap(source => source.headings.map(section =>
      ({ path: source.path, line: section.line, quote: source.lines[section.line - 1] }))));
  return { root, file, sources, document, plan };
}
function technicalPlan(root) {
  return {
    title: "Anonymous public catalog design", specification_sha256: featureStatus(root, "public-catalog").reviews.specification.sha256,
    design: [{ id: "DESIGN-001", description: "Implement title lookup without an authentication dependency.",
      use_cases: ["UC-001"], paths: ["src/catalog.js", "tests/catalog.test.js"] }],
    checks: [{ id: "CHECK-001", command: "node --test tests/catalog.test.js",
      expected: "Anonymous matching-title and explicit no-results assertions pass." }],
    risks: [], open_questions: [],
  };
}
function tasks(root) {
  const status = featureStatus(root, "public-catalog");
  const task = { id: "TASK-001", description: "Implement matching-title search and its no-results response.",
    use_cases: ["UC-001"], paths: ["src/catalog.js"], depends_on: [], checks: ["CHECK-001"] };
  return { title: "Anonymous catalog implementation tasks", specification_sha256: status.reviews.specification.sha256,
    plan_sha256: status.reviews.plan.sha256,
    tasks: [{ ...task, id: "TASK-002", description: "Verify anonymous title search and its empty response.",
      paths: ["tests/catalog.test.js"], depends_on: ["TASK-001"] }, task], open_questions: [] };
}
async function execute(root, task, plan, responses, prompts = []) {
  let sends = 0;
  return runCopilotTask(root, task, plan, {
    approved: true, contextPackage: prepareApprovedSpecContext(root, plan),
    clientFactory: () => ({
      async start() {}, async stop() {},
      async createSession() {
        return { sessionId: `20000000-0000-4000-8000-${String(++executionSessionCount).padStart(12, "0")}`,
          async sendAndWait({ prompt }) {
            prompts.push(prompt);
            assert.ok(sends < responses.length, "No unbounded or duplicate generation");
            return { data: { content: JSON.stringify(responses[sends++]) } };
          }, async disconnect() {} };
      },
    }),
  });
}

test("greenfield and brownfield use identical validated final artifacts and cover all selected source categories", () => {
  for (const brownfield of [false, true]) {
    const { root, sources, document, plan } = fixture({ brownfield });
    assert.equal(plan.functional_specification.mode, brownfield ? "brownfield" : "greenfield");
    if (brownfield) {
      assert.ok(plan.knowledge.some(source => source.source_path === "src/catalog.js"));
      assert.ok(plan.knowledge.some(source => source.source_path === "tests/catalog.test.js"));
      assert.ok(plan.knowledge.some(source => source.source_path === "catalog.config.json"));
      const missing = structuredClone(document);
      missing.coverage = missing.coverage.filter(section => section.path !== "src/catalog.js" || section.line !== 5);
      assert.throws(() => validateFunctionalSpec(root, JSON.stringify(missing), sources), /missing section coverage.*catalog\.js:5/);
    }
    publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
    assert.equal(featureStatus(root, document.slug).reviews.specification.validation, "machine-validated");
    assert.equal(featureStatus(root, document.slug).next, "author-plan");
    assert.throws(() => createPlan(root, { slug: document.slug, title: "Catalog plan" }), /structured plan authoring/);
    assert.equal(fs.existsSync(path.join(root, "specs", document.slug, "plan.md")), false);
    publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
    assert.equal(featureStatus(root, document.slug).next, "author-tasks");
    publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
    const status = featureStatus(root, document.slug);
    assert.equal(status.next, "implement-and-verify");
    assert.equal(status.implementation_verified, false);
    const markdown = fs.readFileSync(path.join(root, "specs", document.slug, "tasks.md"), "utf8");
    assert.ok(markdown.indexOf("**TASK-001**") < markdown.indexOf("**TASK-002**"));
    for (const name of ["spec.md", "UC-001.md", "specification.json", "manifest.json", "decisions.json",
      "decisions.md", "lifecycle.json", "plan.md", "plan.json", "tasks.md", "tasks.json"]) {
      assert.ok(fs.existsSync(path.join(root, "specs", document.slug, name)), name);
    }
  }
});

test("graph, lexical and embedding chunks share canonical identity and hashes, even with scoped source roots", () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
  fs.writeFileSync(path.join(root, "mcpee.config.yml"), "knowledge:\n  sourceRoots:\n    - knowledge/sources\n");
  syncProject(root, { generateDocumentation: false, graphify: { installed: false } });
  const index = read(root, ".mcpee/indexes/knowledge-index.json");
  const graph = read(root, ".mcpee/graphs/unified/graph.json");
  for (const artifact of canonicalArtifacts(root)) {
    const lexical = index.documents.find(item => item.source_path === artifact.path);
    const node = graph.nodes.find(item => item.type === "source" && item.source_path === artifact.path);
    assert.ok(lexical, artifact.path);
    assert.equal(node.sha256, artifact.sha256);
    assert.equal(lexical.sha256, artifact.sha256);
    assert.equal(node.source_id, lexical.source_id);
    assert.equal(node.authority, "canonical-specification");
    for (const chunk of chunkDocument(root, lexical)) {
      assert.equal(chunk.source_id, lexical.source_id);
      assert.equal(chunk.source_sha256, node.sha256);
      assert.equal(chunk.authority, node.authority);
    }
  }
  assert.ok(searchKnowledge(root, "Anonymous public catalog design", 100)
    .some(item => item.source_path === "specs/public-catalog/plan.md"));
  assert.ok(!index.documents.some(item => /\/reviews\/|lifecycle\.json$/.test(item.source_path)));
  const rerouted = routeTask(root, "Draft greenfield functional specifications");
  assert.ok(!rerouted.knowledge.some(item => item.source_path.startsWith("specs/")));
});

test("unresolved decisions block automation; explicit resolution advances without a second approval", () => {
  const { root, sources, document } = fixture({ question: true });
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  assert.equal(featureStatus(root, document.slug).next, "clarify");
  resolveDecision(root, { slug: document.slug, id: "Q-001",
    answer: "The catalog owner chooses and publishes the availability policy.", reviewer: "Product owner" });
  assert.equal(featureStatus(root, document.slug).next, "author-plan");
  const risk = technicalPlan(root);
  risk.risks = [{ description: "Replacing the production database requires migration authorization.", requires_approval: true,
    approval_action: "migration" }];
  publishPhase(root, document.slug, "plan", JSON.stringify(risk));
  assert.equal(featureStatus(root, document.slug).next, "clarify-phase");
  assert.equal(featureStatus(root, document.slug).reviews.plan.approved, false);
});

test("invalid references, omitted cases, cyclic dependencies and owner edits never advance", () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const invalid = technicalPlan(root);
  invalid.design[0].use_cases = ["UC-099"];
  assert.throws(() => publishPhase(root, document.slug, "plan", JSON.stringify(invalid)), /Unknown use case/);
  assert.equal(fs.existsSync(path.join(root, "specs", document.slug, "plan.md")), false);
  publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
  const cyclic = tasks(root);
  cyclic.tasks[1].depends_on = ["TASK-002"];
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(cyclic)), /Cyclic/);
  const stale = tasks(root);
  stale.plan_sha256 = "a".repeat(64);
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(stale)), /current validated plan/);
  fs.appendFileSync(path.join(root, "specs", document.slug, "spec.md"), "\nOwner clarification changes the product contract.\n");
  assert.throws(() => advanceValidatedStages(root, document.slug), /Canonical specification changed/);
  assert.equal(featureStatus(root, document.slug).reviews.plan.approved, false);
});

test("the executor repairs invalid JSON in one session then publishes and indexes spec, plan and tasks", async () => {
  const { root, document, plan } = fixture();
  const invalid = structuredClone(document);
  invalid.coverage[0].status = "complete";
  const prompts = [];
  const result = await execute(root, "Draft greenfield functional specifications", plan, [invalid, document], prompts);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Repair the previous specification JSON in this same session/);
  const attempts = fs.readdirSync(path.join(root, result.authoringEvidence));
  assert.equal(attempts.length, 4);
  assert.equal(read(root, `${result.authoringEvidence}/specification-1.json`).status, "invalid");
  assert.equal(read(root, `${result.authoringEvidence}/specification-1.json`).source_snapshot[0].sha256,
    read(root, "specs/public-catalog/manifest.json").sources[0].sha256);
  assert.equal(read(root, `${result.authoringEvidence}/specification-2.json`).status, "validated");
  assert.ok(searchKnowledge(root, "Public catalog specifications", 100)
    .some(item => item.source_path === "specs/public-catalog/spec.md"));
  const planRoute = routeTask(root, "Create plan for public-catalog");
  const phase = await execute(root, "Create plan for public-catalog", planRoute, [technicalPlan(root)]);
  assert.equal(phase.phase.status.next, "author-tasks");
  const tasksRoute = routeTask(root, "Create tasks for public-catalog");
  const delivery = await execute(root, "Create tasks for public-catalog", tasksRoute, [tasks(root)]);
  assert.equal(delivery.phase.status.next, "implement-and-verify");
  assert.equal(delivery.phase.status.implementation_verified, false);
  assert.ok(searchKnowledge(root, "Anonymous catalog implementation tasks", 100)
    .some(item => item.source_path === "specs/public-catalog/tasks.md"),
  JSON.stringify(read(root, ".mcpee/indexes/knowledge-index.json").documents.map(item => item.source_path)));
});

test("source drift saves the candidate and stops before spending another repair attempt", async () => {
  const { root, file, document, plan } = fixture();
  let sends = 0;
  await assert.rejects(runCopilotTask(root, "Draft greenfield functional specifications", plan, {
    approved: true, clientFactory: () => ({
      async start() {}, async stop() {},
      async createSession() {
        return { sessionId: "20000000-0000-4000-8000-000000000007", async disconnect() {},
          async sendAndWait() {
            sends++;
            fs.appendFileSync(path.join(root, file), "\nThe owner has changed the public search policy.\n");
            return { data: { content: JSON.stringify(document) } };
          } };
      },
    }),
  }), /Source drift prevents repair/);
  assert.equal(sends, 1);
  assert.equal(fs.existsSync(path.join(root, "specs", document.slug, "spec.md")), false);
  const attemptsRoot = path.join(root, ".mcpee", "reports", "authoring");
  const [attempt] = fs.readdirSync(attemptsRoot);
  assert.equal(fs.readdirSync(path.join(attemptsRoot, attempt)).length, 2);
});

test("tasks retain actual use-case prerequisites, not merely an acyclic task list", () => {
  const { root, file, document } = fixture();
  fs.appendFileSync(path.join(root, file), "\n## Details\nReaders open details for a matching book title.\n");
  const details = structuredClone(document.use_cases[0]);
  Object.assign(details, { id: "UC-002", title: "Read matching book details",
    goal: "Understand the details of a book found in the public catalog.",
    trigger: "The reader selects a matching book title.",
    preconditions: ["A public catalog search has returned a matching book title."],
    main_flow: ["The reader selects a matching title.", "The catalog displays the selected book details."],
    alternatives: ["A title no longer available displays an explicit unavailable state."],
    postconditions: ["The reader understands the selected matching book details."],
    rules: ["Book details correspond to the selected matching title."],
    acceptance_criteria: [{ given: "A public search returned a matching title.",
      when: "The reader opens that title.", then: "The catalog displays details of the selected matching book." }],
    dependencies: ["UC-001"], evidence: [{ path: file, line: 7, quote: "Readers open details for a matching book title." }] });
  document.use_cases.push(details);
  document.scope.push("Public book details for a selected matching search result.");
  document.coverage.push({ path: file, line: 6, status: "covered", use_cases: ["UC-002"],
    reason: "Book details are opened for a matching public search result." });
  publishFunctionalSpec(root, JSON.stringify(document), prepareFunctionalSources(root, [file]), { automatic: true });
  const plan = technicalPlan(root);
  plan.design.push({ id: "DESIGN-002", description: "Expose details for a title found by public catalog search.",
    use_cases: ["UC-002"], paths: ["src/details.js", "tests/details.test.js"] });
  plan.checks.push({ id: "CHECK-002", command: "node --test tests/details.test.js",
    expected: "Matching-title details are accessible after a public catalog lookup." });
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  const delivery = tasks(root);
  delivery.tasks.push({ id: "TASK-003", description: "Implement matching-title details and check their public availability.",
    use_cases: ["UC-002"], paths: ["src/details.js", "tests/details.test.js"], depends_on: [], checks: ["CHECK-002"] });
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)), /prerequisite UC-001/);
  delivery.tasks[2].depends_on = ["TASK-002"];
  validatePhase(root, document.slug, "tasks", JSON.stringify(delivery));
});

test("a scope exceeding the exact coverage limit fails before paid authoring instead of truncating symbols", () => {
  const { root, file } = fixture();
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "large.js"),
    Array.from({ length: 1001 }, (_, index) => `export function operation${index}() { return ${index}; }`).join("\n"));
  assert.throws(() => prepareFunctionalSources(root, [file, "src/large.js"]), /exceeds 1000 source sections/);
});

test("an explicit source followed by a sentence period never expands to other business documents", () => {
  const { root, file } = fixture();
  fs.writeFileSync(path.join(root, "knowledge/sources/business/internal.md"), "# Internal content\nDo not transfer this source.\n");
  syncProject(root, { generateDocumentation: false, graphify: { installed: false } });
  const route = routeTask(root, `Draft greenfield functional specifications. Exclusive source: ${file}.`);
  assert.deepEqual(route.knowledge.map(source => source.source_path), [file]);
});

test("actual subsections are valid coverage and all unknown or omitted sections are reported together", () => {
  const { root, file, document } = fixture();
  fs.writeFileSync(path.join(root, file),
    "# Catalog\n\n## Search\n### Anonymous lookup\nReaders search the public catalog without authentication.\n\n## Lending\nLending is not part of this feature.\n");
  const sources = prepareFunctionalSources(root, [file]);
  document.use_cases[0].evidence[0].line = 5;
  document.coverage = [
    { path: file, line: 3, status: "covered", use_cases: ["UC-001"], reason: "Anonymous catalog search is implemented by this use case." },
    { path: file, line: 4, status: "covered", use_cases: ["UC-001"], reason: "Anonymous lookup is the subsection selected for this use case." },
    { path: file, line: 7, status: "out-of-scope", use_cases: [], reason: "Lending is explicitly excluded from this catalog acceptance." },
  ];
  validateFunctionalSpec(root, JSON.stringify(document), sources);
  document.coverage = [10, 11].map(line => ({ ...document.coverage[0], line }));
  assert.throws(() => validateFunctionalSpec(root, JSON.stringify(document), sources), error =>
    [":10", ":11", ":3", ":7"].every(location => error.message.includes(location)));
});

test("canonical phase intent overrides incidental specification or ingestion keywords", () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const planRoute = routeTask(root, "Crea el plan técnico para public-catalog. Lee la especificación y documentación.");
  assert.equal(planRoute.specification_workspace.requested_stage, "plan");
  assert.equal(planRoute.functional_specification, undefined);
  publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
  assert.equal(routeTask(root, "Crea tareas para public-catalog siguiendo la especificación.").specification_workspace.requested_stage, "tasks");
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  const route = routeTask(root, "Implementa public-catalog siguiendo la especificación y documentación; sin nuevas dependencias.");
  assert.equal(route.specification_workspace.requested_stage, "implementation");
  assert.equal(route.workflow.id, "deliver-feature");
  assert.equal(route.functional_specification, undefined);
});

test("only an actual typed risky action creates a plan approval gate; Markdown newline formatting does not", () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  plan.risks = [{ description: "Local synthetic tests do not establish production acceptance.", requires_approval: true }];
  assert.throws(() => validatePhase(root, document.slug, "plan", JSON.stringify(plan)), /actual typed risky action/);
  plan.risks[0].requires_approval = false;
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  fs.writeFileSync(path.join(root, "specs/public-catalog/plan.md"), renderPhase("plan", plan).trimEnd().replace(/\n/g, "\r\n"));
  assert.equal(advanceValidatedStages(root, document.slug).reviews.plan.validation, "machine-validated");
  fs.appendFileSync(path.join(root, "specs/public-catalog/plan.md"), "\nOwner changes the actual implementation contract.\n");
  assert.throws(() => advanceValidatedStages(root, document.slug), /JSON and Markdown disagree/);
  const risky = fixture();
  publishFunctionalSpec(risky.root, JSON.stringify(risky.document), risky.sources, { automatic: true });
  const migration = technicalPlan(risky.root);
  migration.risks = [{ description: "Migrate the production catalog to another database.", requires_approval: true, approval_action: "migration" }];
  publishPhase(risky.root, risky.document.slug, "plan", JSON.stringify(migration));
  assert.equal(featureStatus(risky.root, risky.document.slug).next, "clarify-phase");
});

test("saved candidate recovery requires exact checksum, original scope and unchanged source evidence without a model", () => {
  const { root, sources, document, file } = fixture();
  const candidate = ".mcpee/reports/authoring/abcdef01/specification-1.txt";
  const response = JSON.stringify(document);
  fs.mkdirSync(path.dirname(path.join(root, candidate)), { recursive: true });
  fs.writeFileSync(path.join(root, candidate), response);
  const metadata = { generated_by: "mcpee", stage: "specification", response_path: candidate,
    response_sha256: crypto.createHash("sha256").update(response).digest("hex"),
    source_snapshot: sources.map(({ path, sha256 }) => ({ path, sha256 })) };
  const save = () => fs.writeFileSync(path.join(root, candidate.replace(".txt", ".json")), JSON.stringify(metadata));
  save();
  assert.throws(() => recoverAuthoring(root, candidate, ["knowledge/sources/business/unrelated.md"]), /outside the original/);
  fs.appendFileSync(path.join(root, candidate), " ");
  assert.throws(() => recoverAuthoring(root, candidate), /recorded execution evidence/);
  fs.writeFileSync(path.join(root, candidate), response);
  const original = fs.readFileSync(path.join(root, file), "utf8");
  fs.appendFileSync(path.join(root, file), "\nChanged business policy.\n");
  assert.throws(() => recoverAuthoring(root, candidate), /Source drift blocks recovery/);
  fs.writeFileSync(path.join(root, file), original);
  metadata.response_sha256 = undefined;
  save();
  assert.throws(() => recoverAuthoring(root, candidate), /recorded execution evidence/);
  metadata.response_sha256 = crypto.createHash("sha256").update(response).digest("hex");
  save();
  const recovered = recoverAuthoring(root, candidate, [file]);
  assert.equal(recovered.result.lifecycle.next, "author-plan");
  const canonical = path.join(root, "specs/public-catalog/spec.md");
  fs.appendFileSync(canonical, "\nOwner contract change.\n");
  assert.throws(() => recoverAuthoring(root, candidate, [file]), /conflict|changed|exists|different|reconcile/i);
  assert.match(fs.readFileSync(canonical, "utf8"), /Owner contract change/);
});

test("canonical local implementation checks complete without a routed ingestion workflow or per-test approval", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "src/catalog.js"), "module.exports = { search: () => ['Matching book'] };\n");
  fs.writeFileSync(path.join(root, "tests/catalog.test.js"),
    "require('node:test')('anonymous search', () => require('node:assert/strict').deepEqual(require('../src/catalog').search(), ['Matching book']));\n");
  const canonical = prepareImplementationValidation(root, document.slug);
  const runChecks = async (project, file, options) => {
    // Node suppresses nested --test execution when this runner marker is inherited.
    const testContext = process.env.NODE_TEST_CONTEXT;
    delete process.env.NODE_TEST_CONTEXT;
    try {
      return await executeRunSpec(project, loadRunSpec(project, file), {
        approveStep: options.approveStep, impactPreflight: { status: "ready" },
      });
    } finally {
      if (testContext !== undefined) process.env.NODE_TEST_CONTEXT = testContext;
    }
  };
  const hooks = createCopilotHooks(root, { validationCommands: canonical.commands });
  const permissions = createPermissionRequestHandler(root, { validationCommands: canonical.commands });
  const invocation = { sessionId: "planned-local-checks" };
  assert.equal((await hooks.onPreToolUse({ toolName: "powershell", toolArgs: { command: canonical.commands[0] } }, invocation)).permissionDecision, "allow");
  assert.deepEqual(await permissions({ kind: "shell", fullCommandText: canonical.commands[0] }, invocation), { kind: "approved" });
  for (const command of ["npm install", `${canonical.commands[0]}; npm install`, "node --test tests/other.test.js"]) {
    assert.equal((await hooks.onPreToolUse({ toolName: "powershell", toolArgs: { command } }, invocation)).permissionDecision, "deny");
    assert.deepEqual(await permissions({ kind: "shell", fullCommandText: command }, invocation), { kind: "user-not-available" });
  }
  assert.deepEqual(await permissions({ kind: "shell", fullCommandText: canonical.commands[0], requestSandboxBypass: true }, invocation), { kind: "user-not-available" });
  let validation;
  const exitCode = await synchronizeAfterCopilotChanges(root, ["src/catalog.js", "tests/catalog.test.js"], "ingest-knowledge", {
    canonicalFeature: document.slug, approveSync: async () => true,
    syncProject: () => ({ counts: { failed: 0 }, graphify: { status: "not-installed" } }),
    discoverTools: () => ({ tools: [] }), updateCodeGraph: () => ({ status: "ready" }),
    runWorkflow: runChecks,
    generateProjectDocumentation: () => ({ files: [], counts: { written: 0, preserved: 0 } }),
    onValidation: result => { validation = result; },
  });
  assert.equal(exitCode, 0);
  assert.equal(validation.status, "passed");
  assert.equal(featureStatus(root, document.slug).implementation_verified, true);
  assert.equal(featureStatus(root, document.slug).next, "review-product-acceptance");
  assert.equal(featureStatus(root, document.slug).implementation.product_acceptance, "not-verified");
  const verification = read(root, "specs/public-catalog/verification.json");
  assert.deepEqual(verification.use_cases[0].tasks.sort(), ["TASK-001", "TASK-002"]);
  assert.deepEqual(verification.use_cases[0].checks, ["CHECK-001"]);
  assert.ok(canonicalArtifacts(root).some(file => file.path.endsWith("/verification.json")));
  const report = read(root, validation.report);
  const originalReport = fs.readFileSync(path.join(root, validation.report), "utf8");
  report.checks[0].args = ["--version"];
  fs.writeFileSync(path.join(root, validation.report), JSON.stringify(report));
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  assert.throws(() => recordImplementationVerification(root, document.slug, canonical, validation.report), /exact canonical check/);
  fs.writeFileSync(path.join(root, validation.report), originalReport);
  const done = await runSpecificationLifecycle(root, {
    slug: document.slug, task: "Implement the public catalog", through: "verification",
    execute: () => { assert.fail("An already verified lifecycle must not rerun implementation."); },
  });
  assert.equal(done.status, "completed");
  assert.equal(done.phases.length, 0);
  fs.writeFileSync(path.join(root, "tests/catalog.test.js"),
    "require('node:test')('failing acceptance', () => require('node:assert/strict').equal(false, true));\n");
  const failed = await synchronizeAfterCopilotChanges(root, ["tests/catalog.test.js"], "ingest-knowledge", {
    canonicalFeature: document.slug, approveSync: async () => true,
    syncProject: () => ({ counts: { failed: 0 }, graphify: { status: "not-installed" } }),
    discoverTools: () => ({ tools: [] }), updateCodeGraph: () => ({ status: "ready" }),
    runWorkflow: runChecks,
    generateProjectDocumentation: () => { assert.fail("Failed checks must not refresh documentation."); },
    onValidation: result => { validation = result; },
  });
  assert.equal(failed, 1);
  assert.equal(validation.status, "failed");
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  assert.equal(featureStatus(root, document.slug).implementation.status, "stale");
});

test("one explicit lifecycle request advances both source modes through validated tasks without repeating phases", async () => {
  for (const brownfield of [false, true]) {
    const { root, sources, document } = fixture({ brownfield });
    const called = [];
    const result = await runSpecificationLifecycle(root, {
      slug: document.slug, task: `Build ${brownfield ? "brownfield" : "greenfield"} catalog without deploying or installing dependencies.`,
      through: "tasks", execute: async (task, phase) => {
        called.push(phase);
        assert.match(task, /without deploying or installing dependencies/);
        if (phase === "specification") publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
        if (phase === "plan") publishPhase(root, document.slug, phase, JSON.stringify(technicalPlan(root)));
        if (phase === "tasks") publishPhase(root, document.slug, phase, JSON.stringify(tasks(root)));
        return 0;
      },
    });
    assert.deepEqual(called, ["specification", "plan", "tasks"]);
    assert.equal(result.status, "completed");
    assert.equal(read(root, result.report).product_acceptance, "not-verified");
    assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  }
});

test("lifecycle stops on real decisions, source drift, execution failures and non-advancing phases", async () => {
  const pending = fixture({ question: true });
  const blocked = await runSpecificationLifecycle(pending.root, {
    slug: pending.document.slug, task: "Build the catalog", through: "verification",
    execute: async (_task, phase) => {
      assert.equal(phase, "specification");
      publishFunctionalSpec(pending.root, JSON.stringify(pending.document), pending.sources, { automatic: true });
      return 0;
    },
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.phases.length, 1);
  assert.match(blocked.reason, /clarify/);
  const failure = fixture();
  const failed = await runSpecificationLifecycle(failure.root, {
    slug: failure.document.slug, task: "Build the catalog", through: "tasks", execute: async () => 1,
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.phases.length, 1);
  const stalled = fixture();
  let count = 0;
  await assert.rejects(runSpecificationLifecycle(stalled.root, {
    slug: stalled.document.slug, task: "Build the catalog", through: "tasks",
    execute: async () => { count++; return 0; },
  }), /did not advance/);
  assert.equal(count, 1);
  const drift = fixture();
  publishFunctionalSpec(drift.root, JSON.stringify(drift.document), drift.sources, { automatic: true });
  fs.appendFileSync(path.join(drift.root, drift.file), "\nNew business policy.\n");
  const drifted = await runSpecificationLifecycle(drift.root, {
    slug: drift.document.slug, task: "Build catalog", through: "tasks",
    execute: () => { assert.fail("Drift must stop before any model execution."); },
  });
  assert.equal(drifted.status, "blocked");
  assert.match(drifted.reason, /source-drift/);
});
