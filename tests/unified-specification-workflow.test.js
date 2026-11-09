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
const { featureStatus, canonicalArtifacts, advanceValidatedStages, resolveDecision, workspace, approveStage, approveSpecifications, currentDigest } = require("../packages/spec-engine/src/lifecycle");
const { validatePhase, publishPhase, publishPhaseWithApproval, renderPhase, recoverAuthoring, prepareImplementationValidation } = require("../packages/spec-engine/src/phases");
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
      id: "UC-001", slug: "catalog-search", title: "Search the public book catalog", actor: "ACT-001",
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
function technicalPlan(root, { approveRequirements = true } = {}) {
  if (approveRequirements && !featureStatus(root, "public-catalog").specification_approved) {
    approveStage(root, { slug: "public-catalog", reviewer: "Fixture product owner",
      confirmSha256: currentDigest(root, "public-catalog", "specification") });
  }
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
async function execute(root, task, plan, responses, prompts = [], options = {}) {
  let sends = 0;
  const session = sessionId => ({
    sessionId,
    async sendAndWait({ prompt }) {
      prompts.push(prompt);
      assert.ok(sends < responses.length, "No unbounded or duplicate generation");
      return { data: { content: JSON.stringify(responses[sends++]) } };
    },
    async disconnect() {},
  });
  return runCopilotTask(root, task, plan, {
    ...options,
    approved: true, contextPackage: prepareApprovedSpecContext(root, plan),
    clientFactory: () => ({
      async start() {}, async stop() {},
      async createSession() {
        return session(`20000000-0000-4000-8000-${String(++executionSessionCount).padStart(12, "0")}`);
      },
      async resumeSession(sessionId) { return session(sessionId); },
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
    assert.equal(fs.existsSync(path.join(root, workspace(document.slug, root), "plan.md")), false);
    publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
    assert.equal(featureStatus(root, document.slug).next, "author-tasks");
    publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
    const status = featureStatus(root, document.slug);
    assert.equal(status.next, "implement-and-verify");
    assert.equal(status.implementation_verified, false);
    const markdown = fs.readFileSync(path.join(root, workspace(document.slug, root), "tasks.md"), "utf8");
    assert.ok(markdown.indexOf("**TASK-001**") < markdown.indexOf("**TASK-002**"));
    for (const name of ["spec.md", "catalog-search.md", "specification.json", "manifest.json", "decisions.json",
      "decisions.md", "lifecycle.json", "plan.md", "plan.json", "tasks.md", "tasks.json"]) {
      assert.ok(fs.existsSync(path.join(root, workspace(document.slug, root), name)), name);
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
    assert.equal(node.authority, "approved-specification");
    for (const chunk of chunkDocument(root, lexical)) {
      assert.equal(chunk.source_id, lexical.source_id);
      assert.equal(chunk.source_sha256, node.sha256);
      assert.equal(chunk.authority, node.authority);
    }
  }
  assert.ok(searchKnowledge(root, "Anonymous public catalog design", 100)
    .some(item => item.source_path === `${workspace("public-catalog", root)}/plan.md`));
  assert.ok(!index.documents.some(item => /\/(?:reviews|history)\/|lifecycle\.json$/.test(item.source_path)));
  const rerouted = routeTask(root, "Draft greenfield functional specifications");
  assert.ok(!rerouted.knowledge.some(item => item.source_path.startsWith("docs/specifications/")));
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

test("phase revisions request confirmation, preserve history and invalidate dependent tasks", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const original = technicalPlan(root);
  original.open_questions = ["Which catalog availability policy should the implementation enforce?"];
  publishPhase(root, document.slug, "plan", JSON.stringify(original));
  const directory = workspace(document.slug, root);
  const priorJson = fs.readFileSync(path.join(root, directory, "plan.json"), "utf8");
  const priorMarkdown = fs.readFileSync(path.join(root, directory, "plan.md"), "utf8");
  const candidate = technicalPlan(root);
  candidate.design[0].description += " The owner selected the documented public availability policy.";
  let confirmations = 0;
  const task = "Create plan for public-catalog after resolving the open question";
  const route = () => routeTask(root, task);
  assert.equal(route().specification_workspace.requested_stage, "plan");
  await assert.rejects(() => execute(root, task,
    route(), [candidate], [], { approvePhaseRevision: async () => { confirmations++; return false; } }), /revision was not approved/);
  assert.equal(confirmations, 1);
  assert.equal(fs.readFileSync(path.join(root, directory, "plan.json"), "utf8"), priorJson);
  assert.equal(fs.existsSync(path.join(root, ".mcpee/reports/phase-revisions")), false);
  const updated = await execute(root, task,
    route(), [candidate], [], { approvePhaseRevision: async revision => {
      confirmations++;
      assert.equal(revision.stage, "plan");
      assert.deepEqual(revision.invalidated_paths, []);
      return true;
    } });
  assert.equal(confirmations, 2);
  assert.equal(updated.phase.status.next, "author-tasks");
  const history = read(root, updated.phase.revision);
  assert.equal(history.generated_by, "mcpee");
  assert.equal(history.artifacts.find(file => file.path.endsWith("/plan.json")).content, priorJson);
  assert.equal(history.artifacts.find(file => file.path.endsWith("/plan.md")).content, priorMarkdown);
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  const oldTasks = fs.readFileSync(path.join(root, directory, "tasks.json"), "utf8");
  const revised = technicalPlan(root);
  revised.design[0].description += " Return titles in a stable deterministic order.";
  const revision = await publishPhaseWithApproval(root, document.slug, "plan", JSON.stringify(revised), async proposal => {
    assert.deepEqual(proposal.invalidated_paths, [`${directory}/tasks.json`, `${directory}/tasks.md`]);
    return true;
  });
  assert.equal(revision.status.next, "author-tasks");
  assert.equal(featureStatus(root, document.slug).reviews.tasks.approved, false);
  assert.equal(fs.existsSync(path.join(root, directory, "tasks.json")), false);
  assert.equal(read(root, revision.revision).artifacts.find(file => file.path.endsWith("/tasks.json")).content, oldTasks);
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  assert.equal(featureStatus(root, document.slug).next, "implement-and-verify");
  await publishPhaseWithApproval(root, document.slug, "plan", JSON.stringify(revised),
    () => { assert.fail("Identical publication must not prompt again."); });
});

test("saved phase recovery confirms revisions without another model call and restores files on write failure", async t => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
  const directory = workspace(document.slug, root);
  const previous = ["plan.json", "plan.md"].map(file => ({
    path: `${directory}/${file}`, content: fs.readFileSync(path.join(root, directory, file), "utf8"),
  }));
  const revised = technicalPlan(root);
  revised.design[0].description += " Preserve deterministic ordering for repeated searches.";
  const candidate = ".mcpee/reports/authoring/abcdef01/plan-2.txt";
  const response = JSON.stringify(revised);
  fs.mkdirSync(path.dirname(path.join(root, candidate)), { recursive: true });
  fs.writeFileSync(path.join(root, candidate), response);
  fs.writeFileSync(path.join(root, candidate.replace(".txt", ".json")), JSON.stringify({
    generated_by: "mcpee", stage: "plan", feature: document.slug, response_path: candidate,
    response_sha256: crypto.createHash("sha256").update(response).digest("hex"),
  }));
  let confirmSha256;
  assert.throws(() => recoverAuthoring(root, candidate), error => {
    confirmSha256 = error.message.match(/confirm SHA-256 ([a-f0-9]{64})/)?.[1];
    return Boolean(confirmSha256);
  });
  const rename = fs.renameSync;
  let failed = false;
  const mock = t.mock.method(fs, "renameSync", (from, to) => {
    if (!failed && to === path.join(root, directory, "plan.md")) {
      failed = true;
      throw new Error("Injected phase publication failure");
    }
    return rename(from, to);
  });
  try {
    assert.throws(() => recoverAuthoring(root, candidate, [], { confirmSha256 }), /Injected phase publication failure/);
  } finally {
    mock.mock.restore();
  }
  for (const file of previous) assert.equal(fs.readFileSync(path.join(root, file.path), "utf8"), file.content);
  assert.deepEqual(fs.readdirSync(path.join(root, ".mcpee/reports/phase-revisions")), []);
  const recovered = recoverAuthoring(root, candidate, [], { confirmSha256 });
  assert.equal(recovered.result.status.next, "author-tasks");
  assert.deepEqual(read(root, recovered.result.revision).artifacts, previous);
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  const changedTasks = tasks(root);
  changedTasks.tasks[0].description += " Assert the deterministic ordering contract.";
  const tasksRevision = await publishPhaseWithApproval(root, document.slug, "tasks",
    JSON.stringify(changedTasks), async () => true);
  assert.equal(tasksRevision.status.next, "implement-and-verify");
  assert.equal(read(root, tasksRevision.revision).stage, "tasks");
});

test("phase revision confirmation is bound to the exact candidate and current owner files", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
  const candidate = technicalPlan(root);
  candidate.design[0].description += " Keep public catalog results consistently ordered.";
  const filename = path.join(root, workspace(document.slug, root), "plan.md");
  const ownerContent = fs.readFileSync(filename, "utf8") + "\nOwner: preserve this additional constraint.\n";
  await assert.rejects(() => publishPhaseWithApproval(root, document.slug, "plan", JSON.stringify(candidate),
    async () => { fs.writeFileSync(filename, ownerContent); return true; }), /Phase conflict/);
  assert.equal(fs.readFileSync(filename, "utf8"), ownerContent);
  assert.equal(fs.existsSync(path.join(root, ".mcpee/reports/phase-revisions")), false);
  assert.throws(() => publishPhase(root, document.slug, "plan", JSON.stringify(candidate)), /confirm SHA-256/);
  await assert.rejects(() => publishPhaseWithApproval(root, document.slug, "plan", JSON.stringify(candidate)), /not approved/);
});

test("invalid references, omitted cases, cyclic dependencies and owner edits never advance", () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const invalid = technicalPlan(root);
  invalid.design[0].use_cases = ["UC-099"];
  assert.throws(() => publishPhase(root, document.slug, "plan", JSON.stringify(invalid)), /Unknown use case/);
  assert.equal(fs.existsSync(path.join(root, workspace(document.slug, root), "plan.md")), false);
  publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
  const cyclic = tasks(root);
  cyclic.tasks[1].depends_on = ["TASK-002"];
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(cyclic)), /Cyclic/);
  const stale = tasks(root);
  stale.plan_sha256 = "a".repeat(64);
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(stale)), /current validated plan/);
  fs.appendFileSync(path.join(root, workspace(document.slug, root), "spec.md"), "\nOwner clarification changes the product contract.\n");
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
    read(root, `${workspace("public-catalog", root)}/manifest.json`).sources[0].sha256);
  assert.equal(read(root, `${result.authoringEvidence}/specification-2.json`).status, "validated");
  assert.ok(searchKnowledge(root, "Public catalog specifications", 100)
    .some(item => item.source_path === `${workspace("public-catalog", root)}/spec.md`));
  const planRoute = routeTask(root, "Create plan for public-catalog");
  const phase = await execute(root, "Create plan for public-catalog", planRoute, [technicalPlan(root)]);
  assert.equal(phase.phase.status.next, "author-tasks");
  const tasksRoute = routeTask(root, "Create tasks for public-catalog");
  const delivery = await execute(root, "Create tasks for public-catalog", tasksRoute, [tasks(root)]);
  assert.equal(delivery.phase.status.next, "implement-and-verify");
  assert.equal(delivery.phase.status.implementation_verified, false);
  assert.ok(searchKnowledge(root, "Anonymous catalog implementation tasks", 100)
    .some(item => item.source_path === `${workspace("public-catalog", root)}/tasks.md`),
  JSON.stringify(read(root, ".mcpee/indexes/knowledge-index.json").documents.map(item => item.source_path)));
});

test("phase authoring uses current manifest paths after specification approval relocates the bundle", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  approveStage(root, {
    slug: document.slug, stage: "specification", reviewer: "Fixture product owner",
    confirmSha256: currentDigest(root, document.slug, "specification"),
  });

  const directory = workspace(document.slug, root);
  const manifest = read(root, `${directory}/manifest.json`);
  assert.equal(directory, `docs/specifications/approved/${document.slug}`);
  const task = `Create plan for ${document.slug}`;
  const plan = routeTask(root, task);
  const candidate = {
    title: "Anonymous public catalog design",
    specification_sha256: featureStatus(root, document.slug).reviews.specification.sha256,
    design: [{ id: "DESIGN-001", description: "Implement title lookup without authentication.",
      use_cases: ["UC-001"], paths: ["src/catalog.js"] }],
    checks: [{ id: "CHECK-001", command: "node --test tests/catalog.test.js",
      expected: "Anonymous matching-title and no-results assertions pass." }],
    risks: [], open_questions: [],
  };
  const prompts = [];
  await execute(root, task, plan, [candidate], prompts);

  assert.match(prompts[0], new RegExp(`${directory}/manifest\\.json`));
  assert.ok(manifest.cases.every(item => prompts[0].includes(item.path)));
  assert.doesNotMatch(prompts[0], new RegExp(`docs/specifications/reviewed/${document.slug}/`));
});

test("phase routes include only approved contracts for the selected feature", () => {
  const { root, sources, document } = fixture();
  for (const [slug, title] of [
    [document.slug, document.title],
    ["secondary-catalog", "Secondary catalog specifications"],
  ]) {
    const feature = structuredClone(document);
    feature.slug = slug;
    feature.title = title;
    if (slug !== document.slug) {
      feature.use_cases[0].id = "UC-002";
      feature.use_cases[0].slug = "secondary-search";
      feature.coverage.forEach(section => { section.use_cases = ["UC-002"]; });
    }
    publishFunctionalSpec(root, JSON.stringify(feature), sources, { automatic: true });
    approveStage(root, {
      slug, stage: "specification", reviewer: "Fixture product owner",
      confirmSha256: currentDigest(root, slug, "specification"),
    });
  }

  const selected = routeTask(root, "Create plan for public-catalog");
  assert.equal(selected.specification_workspace.requires_feature_selection, false);
  assert.deepEqual(selected.approved_specs.map(spec => spec.slug), ["public-catalog"]);

  const unselected = routeTask(root, "Create plan for the approved specifications");
  assert.equal(unselected.specification_workspace.requires_feature_selection, true);
  assert.deepEqual(unselected.approved_specs, []);
});

test("onboarding reconciles exact citation coordinates without another model call and preserves the original response", async () => {
  const { root, document, plan } = fixture();
  document.use_cases[0].evidence[0].line = 1;
  const prompts = [];
  const result = await execute(root, "Draft greenfield functional specifications", plan,
    [document], prompts, { proposalOnly: true });
  assert.equal(prompts.length, 1);
  const candidate = `${result.authoringEvidence}/specification-1.txt`;
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, candidate), "utf8")).use_cases[0].evidence[0].line, 1);
  const metadata = read(root, `${result.authoringEvidence}/specification-1.json`);
  assert.equal(metadata.citation_corrections[0].line, 4);
  assert.notEqual(metadata.publication_sha256, metadata.response_sha256);
  assert.equal(featureStatus(root, document.slug).document_state, "proposed");
  assert.equal(read(root, result.specification.manifestPath).citation_corrections.length, 1);
  const recovered = recoverAuthoring(root, candidate);
  assert.equal(recovered.result.lifecycle.document_state, "proposed");
});

test("bounded units use the normal executor, persist selected evidence and recover without another generation", async () => {
  const { root, file, document } = fixture();
  const { buildSpecificationScopes } = require("../packages/spec-engine/src/scopes");
  const scope = buildSpecificationScopes(root).scopes.find(item => item.sources.some(source => source.path === file));
  assert.ok(scope);
  const prompts = [];
  document.coverage.unshift({ path: file, line: 1, status: "out-of-scope", use_cases: [],
    reason: "The document heading identifies the catalog, not an independently executable requirement." });
  const result = await execute(root, scope.task, routeTask(root, scope.task), [document], prompts, { proposalOnly: true });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /4: Readers search the public catalog without authentication/);
  const metadataPath = `${result.authoringEvidence}/specification-1.json`;
  const metadata = read(root, metadataPath);
  assert.equal(metadata.authoring_scope.unit_version, 2);
  assert.equal(metadata.source_snapshot[0].coverage_role, "primary");
  assert.deepEqual(metadata.source_snapshot[0].selected_ranges, scope.source_selections[0].ranges);
  assert.equal(recoverAuthoring(root, metadata.response_path).result.lifecycle.document_state, "proposed");
  metadata.source_snapshot[0].coverage_role = "context";
  fs.writeFileSync(path.join(root, metadataPath), JSON.stringify(metadata));
  assert.throws(() => recoverAuthoring(root, metadata.response_path), /Recovery sources do not match/);
});

test("specification, plan and task authoring share Spanish-safe placeholder checks", () => {
  const { root, document, sources } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  plan.design[0].description = "El método de búsqueda conserva todo el contrato del catálogo público.";
  validatePhase(root, document.slug, "plan", JSON.stringify(plan));
  const invalid = structuredClone(plan);
  invalid.design[0].description = "TODO: definir el método de búsqueda.";
  assert.throws(() => validatePhase(root, document.slug, "plan", JSON.stringify(invalid)), /Concrete phase content/);
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  const taskDocument = tasks(root);
  taskDocument.tasks[0].description = "Verificar que el método devuelve todo el listado público esperado.";
  validatePhase(root, document.slug, "tasks", JSON.stringify(taskDocument));
  taskDocument.tasks[0].description = "TBD completar pruebas de búsqueda.";
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(taskDocument)), /Concrete phase content/);
});

test("proposal prompts exclude implementation-only context while preserving policy and exact coverage", async () => {
  const { root, document, plan } = fixture();
  const irrelevant = "unrelated-stack-and-graph-evidence-".repeat(12000);
  plan.project_stack = { ...plan.project_stack, unrelated: irrelevant };
  plan.impact_preflight = { unrelated: irrelevant };
  plan.technical_guidance = [{ id: "implementation-only", content: irrelevant }];
  const prompts = [];
  await execute(root, "Draft greenfield functional specifications", plan,
    [document], prompts, { proposalOnly: true });
  assert.equal(prompts.length, 1);
  assert.ok(Buffer.byteLength(prompts[0]) < 25000, Buffer.byteLength(prompts[0]));
  assert.doesNotMatch(prompts[0], /unrelated-stack-and-graph-evidence/);
  assert.match(prompts[0], /policy_controls/);
  assert.match(prompts[0], /Selected sources and required section coverage/);
  assert.match(prompts[0], /end_line/);
  assert.equal(featureStatus(root, document.slug).authoritative, false);
  assert.equal(featureStatus(root, document.slug).document_state, "proposed");
});

test("proposal repairs publish a fully validated expanded candidate and preserve the original small model response", async () => {
  const { root, document, plan } = fixture();
  const invalid = structuredClone(document);
  invalid.coverage[0].status = "complete";
  const replacement = { replacements: [{ path: "/coverage/0/status", value: "covered" }] };
  const prompts = [];
  const result = await execute(root, "Draft greenfield functional specifications", plan,
    [invalid, replacement], prompts, { proposalOnly: true });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /RFC 6901 JSON Pointer/);
  const metadata = read(root, `${result.authoringEvidence}/specification-2.json`);
  assert.deepEqual(read(root, metadata.response_path), document);
  assert.deepEqual(read(root, metadata.model_response_path), replacement);
  assert.notEqual(metadata.model_response_sha256, metadata.response_sha256);
  assert.equal(metadata.repair_base_sha256,
    crypto.createHash("sha256").update(JSON.stringify(invalid)).digest("hex"));
  assert.ok(JSON.stringify(replacement).length < JSON.stringify(document).length / 10);
  assert.equal(featureStatus(root, document.slug).authoritative, false);
  assert.equal(recoverAuthoring(root, metadata.response_path).result.lifecycle.document_state, "proposed");
});

test("malformed replacement paths retain diagnostics and do not discard the last complete repair base", async () => {
  const { root, document, plan } = fixture();
  const invalid = structuredClone(document);
  invalid.coverage[0].status = "complete";
  const prompts = [];
  const result = await execute(root, "Draft greenfield functional specifications", plan,
    [invalid, { replacements: [{ path: "/use_cases/99/evidence", value: [] }] },
      { replacements: [{ path: "/coverage/0/status", value: "covered" }] }],
    prompts, { proposalOnly: true });
  assert.equal(prompts.length, 3);
  assert.match(prompts[2], /specification-1\.txt/);
  assert.match(prompts[2], /Repair must replace an existing own field/);
  assert.equal(read(root, `${result.authoringEvidence}/specification-2.json`).status, "invalid");
  assert.deepEqual(read(root, `${result.authoringEvidence}/specification-3.txt`), document);
});

test("resumed structured authoring receives the recorded failure first and fresh repair diagnostics on later attempts", async () => {
  const { root, document, plan } = fixture();
  const task = "Draft greenfield functional specifications";
  const invalid = structuredClone(document);
  invalid.coverage[0].status = "complete";
  await assert.rejects(execute(root, task, plan, [invalid, invalid, invalid]), /3 bounded attempts/);
  const sessionDirectory = path.join(root, ".mcpee/state/resumable-sessions");
  const sessionId = fs.readdirSync(sessionDirectory).find(file => file.endsWith(".json")).slice(0, -5);
  const prompts = [];
  const result = await execute(root, task, plan, [invalid, document], prompts, { resumeSessionId: sessionId });
  assert.equal(result.sessionId, sessionId);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Continue the interrupted MCPEE task/);
  assert.match(prompts[0], /Last persisted failure:/);
  assert.match(prompts[0], /3 bounded attempts/);
  assert.match(prompts[1], /^Repair the previous specification JSON/);
  assert.match(prompts[1], /Exact validator diagnostic:/);
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
  assert.equal(fs.existsSync(path.join(root, workspace(document.slug, root), "spec.md")), false);
  const attemptsRoot = path.join(root, ".mcpee", "reports", "authoring");
  const [attempt] = fs.readdirSync(attemptsRoot);
  assert.equal(fs.readdirSync(path.join(attemptsRoot, attempt)).length, 2);
});

test("tasks retain functional prerequisites while documentation links remain traceability", async () => {
  const { root, file, document } = fixture();
  fs.appendFileSync(path.join(root, file), "\n## Details\nReaders open details for a matching book title.\n");
  const details = structuredClone(document.use_cases[0]);
  Object.assign(details, { id: "UC-002", slug: "book-details", title: "Read matching book details",
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
  plan.design.push({ id: "DESIGN-003", description: "Synchronize catalog and book-details documentation before implementation.",
    use_cases: ["UC-001", "UC-002"], paths: ["docs/catalog.md"] });
  const specificationOnlyPlan = structuredClone(plan);
  specificationOnlyPlan.design[0].paths = [`${workspace(document.slug, root)}/spec.md`];
  assert.throws(() => validatePhase(root, document.slug, "plan", JSON.stringify(specificationOnlyPlan)),
    /Design DESIGN-001 must include a concrete product implementation path/);
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  const delivery = tasks(root);
  delivery.tasks.push({ id: "TASK-003", description: "Implement matching-title details and check their public availability.",
    use_cases: ["UC-002"], paths: ["src/details.js", "tests/details.test.js"], depends_on: [], checks: ["CHECK-002"] });
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)), /prerequisite UC-001/);
  delivery.tasks[2].depends_on = ["TASK-002"];
  validatePhase(root, document.slug, "tasks", JSON.stringify(delivery));

  delivery.tasks[1].id = "TASK-004";
  delivery.tasks[0].depends_on = ["TASK-004"];
  delivery.tasks[1].depends_on = ["TASK-001"];
  const documentation = { id: "TASK-001", description: "Synchronize catalog and book-details documentation before implementation.",
    use_cases: ["UC-002"], paths: ["docs/catalog.md"], depends_on: [], checks: ["CHECK-001"] };
  delivery.tasks.unshift(documentation);
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)),
    /Task TASK-001 must include or depend on work for prerequisite UC-001.*Mark documentation-only work/);
  documentation.depends_on = ["TASK-003"];
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)), /Cyclic task dependencies/);
  documentation.depends_on = [];
  const invalid = structuredClone(delivery);
  documentation.kind = "documentation";
  documentation.use_cases.unshift("UC-001");
  assert.deepEqual(validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)), delivery);
  assert.throws(() => validatePhase(root, document.slug, "tasks",
    JSON.stringify({ ...delivery, tasks: [documentation] })), /implementation work; documentation links/);

  delivery.tasks[3].depends_on = ["TASK-001"];
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)), /prerequisite UC-001/);
  delivery.tasks[3].depends_on = ["TASK-002"];
  documentation.kind = "unsupported";
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)), /Invalid option/);
  documentation.kind = "documentation";
  documentation.paths = ["docs/unplanned.md"];
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)), /unplanned path/);
  documentation.paths = ["docs/catalog.md"];
  documentation.checks = ["CHECK-999"];
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)), /unknown validation check/);
  documentation.checks = ["CHECK-001"];
  documentation.depends_on = ["TASK-003"];
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)), /Cyclic task dependencies/);
  documentation.depends_on = [];

  const prompts = [];
  const result = await execute(root, "Create tasks for public-catalog",
    routeTask(root, "Create tasks for public-catalog"), [invalid, delivery], prompts);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Documentation use_cases are traceability only/);
  assert.match(prompts[0], /A reminder that an already deferred decision or its operational data remains pending for a later phase is not an open question/);
  assert.match(prompts[0], /If it is genuinely required for this phase, state the specific blocking question/);
  assert.match(prompts[1], /Do not add dependencies that create a cycle/);
  assert.equal(result.phase.status.next, "implement-and-verify");
  const directory = workspace(document.slug, root);
  assert.deepEqual(read(root, `${directory}/tasks.json`), delivery);
  const markdown = fs.readFileSync(path.join(root, directory, "tasks.md"), "utf8");
  assert.match(markdown, /Kind: documentation \| Related cases \(traceability only\)/);
  assert.ok(markdown.indexOf("**TASK-001**") < markdown.indexOf("**TASK-004**"));
  assert.ok(markdown.indexOf("**TASK-004**") < markdown.indexOf("**TASK-003**"));

  const grouped = structuredClone(delivery);
  grouped.tasks.find(task => task.id === "TASK-003").use_cases.push("UC-001");
  grouped.tasks.find(task => task.id === "TASK-003").depends_on = ["TASK-001"];
  validatePhase(root, document.slug, "tasks", JSON.stringify(grouped));

  const finalDocumentation = structuredClone(delivery);
  finalDocumentation.tasks[2].depends_on = [];
  finalDocumentation.tasks[0].depends_on = ["TASK-003"];
  validatePhase(root, document.slug, "tasks", JSON.stringify(finalDocumentation));
  const finalMarkdown = renderPhase("tasks", finalDocumentation);
  assert.ok(finalMarkdown.indexOf("**TASK-003**") < finalMarkdown.indexOf("**TASK-001**"));
});

test("implementation tasks cannot use specification documents as their only target paths", () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  const specPath = `${workspace(document.slug, root)}/spec.md`;
  plan.design[0].paths.push(specPath);
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  const delivery = tasks(root);
  delivery.tasks[0].paths = [specPath];
  assert.throws(() => validatePhase(root, document.slug, "tasks", JSON.stringify(delivery)),
    /Implementation task TASK-002 must include a concrete product implementation path/);
});

test("task authoring blocks a previously approved specification-only plan before starting the SDK", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  const directory = workspace(document.slug, root);
  plan.design[0].paths = [`${directory}/spec.md`];
  fs.writeFileSync(path.join(root, directory, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  const manifest = read(root, `${directory}/manifest.json`);
  fs.writeFileSync(path.join(root, directory, "plan.md"), renderPhase("plan", plan, manifest.cases));
  const lifecyclePath = path.join(root, directory, "lifecycle.json");
  const lifecycle = JSON.parse(fs.readFileSync(lifecyclePath, "utf8"));
  lifecycle.approvals.plan.sha256 = currentDigest(root, document.slug, "plan");
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(lifecycle, null, 2)}\n`);
  assert.equal(featureStatus(root, document.slug).reviews.plan.approved, true);

  const task = "Create tasks for public-catalog";
  const route = routeTask(root, task);
  let started = false;
  await assert.rejects(() => runCopilotTask(root, task, route, {
    approved: true,
    contextPackage: prepareApprovedSpecContext(root, route),
    clientFactory: () => { started = true; throw new Error("SDK must not start"); },
  }), /Design DESIGN-001 must include a concrete product implementation path/);
  assert.equal(started, false);
  assert.equal(fs.existsSync(path.join(root, directory, "tasks.json")), false);
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
  const scopedPlanRequest = routeTask(root,
    "En el proyecto actual, genera SOLO el plan técnico de `public-catalog` usando la especificación Greenfield aprobada y sus casos de uso canónicos. Mantén las decisiones aplazadas a la próxima fase y no las resuelvas ni reabras. La entrega solicitada es únicamente el plan técnico: no generes tasks.md ni tareas en ningún tracker, no implementes ni modifiques código.");
  assert.equal(scopedPlanRequest.specification_workspace.requested_stage, "plan");
  assert.deepEqual(scopedPlanRequest.specification_workspace.features.map(feature => feature.id), ["public-catalog"]);
  assert.equal(scopedPlanRequest.functional_specification, undefined);
  assert.equal(scopedPlanRequest.workflow.id, "change-architecture");

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
  for (const task of [
    "Revisión técnica de solo lectura de public-catalog: diagnóstico desviado a generación de tareas. Esto NO es una solicitud de generar especificaciones, planes, tareas ni implementar public-catalog.",
    "Explica por qué public-catalog falló con «Crea tareas para public-catalog»; no generes tareas ni implementes.",
  ]) {
    const review = routeTask(root, task);
    assert.equal(review.specification_workspace.requested_stage, "review", task);
    assert.equal(review.functional_specification, undefined, task);
    assert.notEqual(review.workflow.id, "deliver-feature", task);
  }
});

test("negative and quoted requests select review workflows while read-only endpoints remain implementation", () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  for (const [task, workflow] of [
    ["Do not implement the public-catalog feature.", "understand-project"],
    ["No implementes public-catalog.", "understand-project"],
    ["Do not create tasks for public-catalog.", "understand-project"],
    ["Explain the phrase 'create tasks' for public-catalog.", "ingest-knowledge"],
    ["Explain 'generate functional specifications' for public-catalog.", "ingest-knowledge"],
  ]) {
    const route = routeTask(root, task);
    assert.equal(route.specification_workspace.requested_stage, "review", task);
    assert.equal(route.workflow.id, workflow, task);
    assert.equal(route.functional_specification, undefined, task);
  }
  for (const task of [
    "Implement a read-only endpoint for public-catalog.",
    "Implementa una API de solo lectura para public-catalog.",
    "Don't change dependencies; implement a read-only endpoint for public-catalog.",
  ]) {
    const route = routeTask(root, task);
    assert.equal(route.specification_workspace.requested_stage, "implementation", task);
    assert.equal(route.workflow.id, "deliver-feature", task);
    assert.equal(route.functional_specification, undefined, task);
  }
});

test("only an actual typed risky action creates a plan approval gate; Markdown newline formatting does not", () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  plan.risks = [{ description: "Local synthetic tests do not establish production acceptance.", requires_approval: true }];
  assert.throws(() => validatePhase(root, document.slug, "plan", JSON.stringify(plan)), /actual typed risky action/);
  plan.risks[0].requires_approval = false;
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  fs.writeFileSync(path.join(root, `${workspace("public-catalog", root)}/plan.md`), renderPhase("plan", plan).trimEnd().replace(/\n/g, "\r\n"));
  assert.equal(advanceValidatedStages(root, document.slug).reviews.plan.validation, "machine-validated");
  fs.appendFileSync(path.join(root, `${workspace("public-catalog", root)}/plan.md`), "\nOwner changes the actual implementation contract.\n");
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
  const canonical = path.join(root, `${workspace("public-catalog", root)}/spec.md`);
  fs.appendFileSync(canonical, "\nOwner contract change.\n");
  assert.throws(() => recoverAuthoring(root, candidate, [file]), /revision requires explicit confirmation/i);
  assert.match(fs.readFileSync(canonical, "utf8"), /Owner contract change/);
});

test("recovering a brownfield onboarding candidate preserves its exact scope and proposed state", () => {
  const { root, document, file } = fixture();
  const { buildSpecificationScopes, validateSpecificationScopeTask, prepareScopeSources } = require("../packages/spec-engine/src/scopes");
  const scope = buildSpecificationScopes(root).scopes.find(scope => scope.sources.some(source => source.path === file));
  document.coverage.unshift({ path: file, line: 1, status: "out-of-scope", use_cases: [],
    reason: "The document title identifies the catalog; it adds no independent requirement." });
  const candidate = ".mcpee/reports/authoring/abcdef02/specification-1.txt";
  const response = JSON.stringify(document);
  fs.mkdirSync(path.dirname(path.join(root, candidate)), { recursive: true });
  fs.writeFileSync(path.join(root, candidate), response);
  const metadata = { generated_by: "mcpee", stage: "specification", response_path: candidate,
    response_sha256: crypto.createHash("sha256").update(response).digest("hex"),
    source_snapshot: prepareScopeSources(root, scope).map(({ lines, ...source }) => source),
    proposal_only: true, authoring_scope: validateSpecificationScopeTask(root, scope.task),
    authoring_task: scope.task };
  fs.writeFileSync(path.join(root, candidate.replace(".txt", ".json")), JSON.stringify(metadata));
  assert.throws(() => recoverAuthoring(root, candidate, [file]), /complete original authoring scope/);
  const recovered = recoverAuthoring(root, candidate);
  assert.equal(recovered.result.lifecycle.document_state, "proposed");
  assert.equal(recovered.result.lifecycle.authoritative, false);
  assert.equal(recovered.result.lifecycle.reviews.specification.approved, false);
  assert.deepEqual(read(root, recovered.result.manifestPath).authoring_scope, metadata.authoring_scope);
});

test("canonical validation plan revisions preserve prior workflow specs", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  const canonical = prepareImplementationValidation(root, document.slug);
  const previousWorkflowPath = `.mcpee/workflows/${canonical.spec.workflow_id}-${canonical.tasks_sha256}.json`;
  const previousWorkflow = { ...canonical.spec, task: "Verify the previous plan revision." };
  fs.mkdirSync(path.dirname(path.join(root, previousWorkflowPath)), { recursive: true });
  fs.writeFileSync(path.join(root, previousWorkflowPath), `${JSON.stringify(previousWorkflow, null, 2)}\n`);
  let workflowUsed;
  let validation;
  const syncOptions = {
    canonicalFeature: document.slug,
    approveSync: async () => true,
    syncProject: () => ({ counts: { failed: 0 }, graphify: { status: "not-installed" } }),
    discoverTools: () => ({ tools: [] }),
    updateCodeGraph: () => ({ status: "ready" }),
    runWorkflow: async (_project, file) => {
      workflowUsed = file;
      return { status: "failed", id: crypto.randomUUID(), file: ".mcpee/reports/evaluations/failed.json" };
    },
    onValidation: result => { validation = result; },
  };
  assert.equal(await synchronizeAfterCopilotChanges(root, [], "ingest-knowledge", syncOptions), 1);
  assert.equal(validation.status, "blocked");
  assert.deepEqual([...validation.missing_paths].sort(), ["src/catalog.js", "tests/catalog.test.js"]);
  assert.equal(workflowUsed, undefined);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/catalog.js"), "module.exports = {};\n");
  fs.writeFileSync(path.join(root, "tests/catalog.test.js"), "require('node:test')('catalog', () => {});\n");
  const exitCode = await synchronizeAfterCopilotChanges(root, [], "ingest-knowledge", syncOptions);
  const revision = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  assert.equal(exitCode, 1);
  assert.equal(validation.status, "failed");
  assert.equal(workflowUsed, `.mcpee/workflows/${canonical.spec.workflow_id}-${canonical.tasks_sha256}-${revision}.json`);
  assert.deepEqual(read(root, previousWorkflowPath), previousWorkflow);
  assert.deepEqual(read(root, workflowUsed), canonical.spec);
});

test("canonical validation resolves bundle self-references authored in an earlier lifecycle stage", () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const directory = workspace(document.slug, root);
  const stale = ["proposed", "reviewed", "approved"].find(state => !directory.startsWith(`docs/specifications/${state}/`));
  const selfReferences = [`docs/specifications/${stale}/${document.slug}/spec.md`,
    `docs/specifications/${stale}/${document.slug}/decisions.md`, `docs/specifications/${stale}/${document.slug}/reviews`];
  const plan = technicalPlan(root);
  plan.design[0].paths.push(...selfReferences);
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  const delivery = tasks(root);
  delivery.tasks[0].paths.push(...selfReferences);
  publishPhase(root, document.slug, "tasks", JSON.stringify(delivery));
  const current = workspace(document.slug, root);
  fs.mkdirSync(path.join(root, current, "reviews"), { recursive: true });
  const { evidence } = prepareImplementationValidation(root, document.slug).spec;
  assert.ok(evidence.every(file => !file.startsWith(`docs/specifications/${stale}/`)));
  assert.ok(evidence.includes(`${current}/decisions.md`));
  assert.equal(evidence.filter(file => file === `${current}/spec.md`).length, 1);
  assert.ok(!evidence.includes(`${current}/reviews`));
});

test("explicit canonical workflows support dotnet, PowerShell and cloud tools without automatic permissions", async () => {
  for (const brownfield of [false, true]) {
    const { root, sources, document } = fixture({ brownfield });
    publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
    const plan = technicalPlan(root);
    plan.checks = [
      { id: "CHECK-001", command: "dotnet test tests/App.Tests/App.Tests.csproj --no-build", expected: "Canonical application tests pass without restoring dependencies." },
      { id: "CHECK-002", command: "pwsh -NoProfile -File scripts/smoke-test.ps1", expected: "The canonical script records actual runtime verification results." },
      { id: "CHECK-003", command: "az bicep build --file infra/main.bicep --stdout", expected: "The canonical Bicep file compiles without cloud deployment." },
    ];
    publishPhase(root, document.slug, "plan", JSON.stringify(plan));
    const delivery = tasks(root);
    delivery.tasks[0].checks = ["CHECK-001", "CHECK-002"];
    publishPhase(root, document.slug, "tasks", JSON.stringify(delivery));
    assert.throws(() => prepareImplementationValidation(root, document.slug), /explicit workflow at .mcpee\/workflows\/spec-public-catalog.json/);
    const workflowPath = ".mcpee/workflows/spec-public-catalog.json";
    const workflow = { workflow_id: "spec-public-catalog", task: "Verify canonical implementation checks",
      steps: plan.checks.map((check, index) => ({
        id: check.id.toLowerCase(), command: check.command, label: check.expected,
        tool: ["dotnet", "pwsh", "azure-cli"][index],
        args: [
          ["test", "tests/App.Tests/App.Tests.csproj", "--no-build"],
          ["-NoProfile", "-File", "scripts/smoke-test.ps1"],
          ["bicep", "build", "--file", "infra/main.bicep", "--stdout"],
        ][index],
        timeout_ms: 300000, requires_approval: false,
      })) };
    fs.mkdirSync(path.dirname(path.join(root, workflowPath)), { recursive: true });
    const save = () => fs.writeFileSync(path.join(root, workflowPath), JSON.stringify(workflow));
    save();
    const canonical = prepareImplementationValidation(root, document.slug);
    assert.deepEqual(canonical.commands, []);
    assert.equal(canonical.explicit_workflow, workflowPath);
    assert.ok(canonical.spec.evidence.includes(workflowPath));
    assert.deepEqual(canonical.spec.steps.map(step => step.tool), ["dotnet", "pwsh", "azure-cli"]);
    assert.ok(canonical.spec.steps.every(step => step.requires_approval));
    assert.equal(canonical.spec.steps[0].timeout_ms, 300000);
    const route = routeTask(root, "Create tasks for public-catalog");
    route.specification_workspace.requested_stage = "implementation";
    const contextPackage = prepareApprovedSpecContext(root, route);
    await assert.rejects(runCopilotTask(root, "Implement public-catalog", route, {
      approved: true, contextPackage,
      clientFactory: () => { throw new Error("Reached SDK construction after explicit workflow preflight"); },
    }), /Reached SDK construction after explicit workflow preflight/);
    let canonicalPrompt, nestedDecision;
    await runCopilotTask(root, "Implement public-catalog", route, {
      approved: true, contextPackage,
      clientFactory: () => ({
        async start() {}, async stop() {},
        async createSession(config) {
          return { sessionId: crypto.randomUUID(), async disconnect() {},
            async sendAndWait(message) {
              canonicalPrompt = message.prompt;
              nestedDecision = await config.hooks.onPreToolUse({ toolName: "powershell",
                toolArgs: { command: "& .\\node_modules\\.bin\\mcpee.cmd specs status --slug public-catalog" } },
              { sessionId: crypto.randomUUID() });
              return { data: { content: "Blocked." } };
            } };
        },
      }),
    });
    assert.equal(nestedDecision.permissionDecision, "deny");
    assert.match(canonicalPrompt, /request it through the normal tool call so the MCPEE approval hook asks the user/);
    assert.match(canonicalPrompt, /Do not invoke any mcpee CLI command yourself, including mcpee specs status/);
    assert.match(canonicalPrompt, /unknown or interrupted outcome is not ambiguity/);
    assert.match(canonicalPrompt, brownfield ? /Every planned path exists/
      : /Planned paths that do not exist yet \(\d+\)[\s\S]*- src\/catalog\.js/);
    const permissions = createPermissionRequestHandler(root, { validationCommands: canonical.commands });
    assert.deepEqual(await permissions({ kind: "shell", fullCommandText: plan.checks[0].command }, { sessionId: "explicit-workflow" }),
      { kind: "user-not-available" });
    workflow.steps[0].command += " --filter Changed";
    save();
    assert.throws(() => prepareImplementationValidation(root, document.slug), /exact command of CHECK-001/);
    workflow.steps[0].command = plan.checks[0].command;
    workflow.steps[0].cwd = "../outside";
    save();
    assert.throws(() => prepareImplementationValidation(root, document.slug), /project-relative/);
    delete workflow.steps[0].cwd;
    workflow.steps[0].tool = "not-in-catalog";
    save();
    assert.throws(() => prepareImplementationValidation(root, document.slug), /outside the MCPEE catalog/);
    workflow.steps[0].tool = "dotnet";
    workflow.steps.pop();
    save();
    assert.throws(() => prepareImplementationValidation(root, document.slug), /map every plan check exactly once/);
    fs.writeFileSync(path.join(root, workflowPath), " ".repeat(256 * 1024 + 1));
    assert.throws(() => prepareImplementationValidation(root, document.slug), /workflow exceeds 262144 bytes/);
  }
});

for (const state of ["proposed", "reviewed", "stale-approval"]) test(`out-of-scope drift can be reviewed before approval from ${state} without granting authority`, async () => {
  const { previewSourceDrift, recordSourceDriftReview } = require("../packages/spec-engine/src/source-drift-review");
  const { root, sources, document } = fixture({ question: true });
  const auxiliary = ".vscode/mcp.json";
  fs.mkdirSync(path.join(root, ".vscode"), { recursive: true });
  fs.writeFileSync(path.join(root, auxiliary), '{"servers":{}}\n');
  const selected = prepareFunctionalSources(root, [...sources.map(source => source.original_path || source.path), auxiliary]);
  document.coverage.push({ path: auxiliary, line: 1, status: "out-of-scope", use_cases: [],
    reason: "Editor integration is outside the public catalog behavior." });
  publishFunctionalSpec(root, JSON.stringify(document), selected, { automatic: true, proposalOnly: state === "proposed" });
  const decision = { slug: document.slug, id: "Q-001", answer: "The owner will choose this policy in a later product phase.",
    reviewer: "Owner", resolution: "deferred" };
  if (state === "proposed") fs.appendFileSync(path.join(root, auxiliary), " \n");
  resolveDecision(root, decision);
  if (state === "stale-approval") {
    approveStage(root, { slug: document.slug, reviewer: "Owner",
      confirmSha256: currentDigest(root, document.slug, "specification") });
  }
  if (state !== "proposed") fs.appendFileSync(path.join(root, auxiliary), " \n");
  if (state === "stale-approval") {
    resolveDecision(root, { ...decision, answer: "The owner explicitly defers this policy to the next catalog release." });
  }
  const before = featureStatus(root, document.slug);
  assert.equal(before.specification_approved, false);
  assert.deepEqual(before.drift, [auxiliary]);
  assert.throws(() => approveStage(root, { slug: document.slug, reviewer: "Owner",
    confirmSha256: before.reviews.specification.sha256 }), /Source drift blocks approval/);
  const directory = workspace(document.slug, root);
  const files = ["manifest.json", "spec.md", "specification.json", "decisions.json", "decisions.md", "lifecycle.json"];
  const bytes = files.map(file => fs.readFileSync(path.join(root, directory, file)));
  const preview = previewSourceDrift(root, document.slug, auxiliary);
  const { createMcpServer } = require("../packages/mcp-server/src/server");
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
  const server = createMcpServer({ projectRoot: root, packageRoot: path.resolve(__dirname, ".."),
    spawnProcess: () => assert.fail("Drift review must not start a model process.") });
  const client = new Client({ name: "draft-drift-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  let review;
  try {
    const result = await client.callTool({ name: "mcpee_specs_drift_preview",
      arguments: { slug: document.slug, source_path: auxiliary } });
    assert.ok(!result.isError, result.content[0].text);
    assert.equal(JSON.parse(result.content[0].text).review_sha256, preview.review_sha256);
    const recorded = await client.callTool({ name: "mcpee_specs_drift_review", arguments: {
      slug: document.slug, source_path: auxiliary, reviewer: "Owner",
      findings: "Reviewed the editor configuration change; it remains outside catalog scope.",
      confirm_sha256: preview.review_sha256,
    } });
    assert.ok(!recorded.isError, recorded.content[0].text);
    review = JSON.parse(recorded.content[0].text);
  } finally {
    await client.close();
    await server.close();
  }
  const reviewBytes = fs.readFileSync(path.join(root, review.path));
  const reviewed = featureStatus(root, document.slug);
  assert.deepEqual(reviewed.drift, []);
  assert.equal(reviewed.specification_approved, false);
  assert.equal(reviewed.authoritative, false);
  assert.equal(reviewed.deferred_decisions, 1);
  assert.equal(reviewed.next, state === "reviewed" ? "author-plan" : "review-specification");
  assert.throws(() => prepareImplementationValidation(root, document.slug), /requires current validated specification, plan and tasks/);
  for (const [index, file] of files.entries()) {
    assert.deepEqual(fs.readFileSync(path.join(root, directory, file)), bytes[index], file);
  }
  const approval = approveSpecifications(root, {
    specifications: [{ slug: document.slug, sha256: reviewed.reviews.specification.sha256 }],
    reviewer: "Owner", reason: "The owner explicitly approves the current catalog specification.",
  });
  assert.equal(approval.status, "completed");
  assert.equal(approval.results.length, 1);
  const approved = featureStatus(root, document.slug);
  assert.equal(approved.specification_approved, true);
  assert.deepEqual(approved.drift, []);
  assert.equal(approved.reviewed_source_drift[0].review, review.path);
  assert.deepEqual(fs.readFileSync(path.join(root, review.path)), reviewBytes);
  if (state === "proposed") {
    const transition = approved.transitions.at(-1);
    const reportPath = path.join(root, transition.report);
    const original = fs.readFileSync(reportPath);
    const altered = JSON.parse(original);
    altered.files.find(file => file.to.endsWith("/decisions.json")).sha256 = "0".repeat(64);
    fs.writeFileSync(reportPath, JSON.stringify(altered));
    assert.deepEqual(featureStatus(root, document.slug).drift, [auxiliary]);
    fs.writeFileSync(reportPath, original);
    assert.deepEqual(featureStatus(root, document.slug).drift, []);
  }
  assert.deepEqual(resolveDecision(root, state === "stale-approval"
    ? { ...decision, answer: "The owner explicitly defers this policy to the next catalog release." } : decision), approved);
  publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root)));
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  assert.equal(featureStatus(root, document.slug).next, "implement-and-verify");
  resolveDecision(root, { ...decision, answer: "The owner now explicitly defers this policy to a different product release." });
  const changed = featureStatus(root, document.slug);
  assert.equal(changed.specification_approved, false);
  assert.deepEqual(changed.drift, [auxiliary]);
  assert.equal(changed.reviewed_source_drift, undefined);
  assert.throws(() => recordSourceDriftReview(root, { slug: document.slug, sourcePath: auxiliary,
    reviewer: "Owner", findings: "Reviewed the configuration change.", confirmSha256: preview.review_sha256 }), /changed/);
});

for (const brownfield of [false, true]) test(`${brownfield ? "brownfield" : "greenfield"} out-of-scope drift review binds exact source and approved bundle without mutating either`, () => {
  const { previewSourceDrift, recordSourceDriftReview } = require("../packages/spec-engine/src/source-drift-review");
  const { root, sources, document, file } = fixture({ brownfield });
  const auxiliary = ".vscode/mcp.json";
  fs.mkdirSync(path.join(root, ".vscode"), { recursive: true });
  fs.writeFileSync(path.join(root, auxiliary), '{"servers":{"other":{"command":"node"}}}\n');
  const selected = prepareFunctionalSources(root, [...sources.map(source => source.original_path || source.path), auxiliary]);
  document.coverage.push({ path: auxiliary, line: 1, status: "out-of-scope",
    use_cases: [], reason: "This integration configuration contains no catalog behavior requirements." });
  publishFunctionalSpec(root, JSON.stringify(document), selected, { automatic: true });
  const plan = technicalPlan(root);
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  const directory = workspace(document.slug, root);
  const manifestBefore = fs.readFileSync(path.join(root, directory, "manifest.json"));
  const specDigest = currentDigest(root, document.slug, "specification");
  fs.appendFileSync(path.join(root, auxiliary), " \n");
  assert.deepEqual(featureStatus(root, document.slug).drift, [auxiliary]);
  const preview = previewSourceDrift(root, document.slug, auxiliary);
  assert.equal(preview.specification_sha256, specDigest);
  const { execFileSync } = require("node:child_process");
  const cliPreview = JSON.parse(execFileSync(process.execPath, [
    path.join(__dirname, "..", "packages", "cli", "bin", "mcpee.js"),
    "specs", "drift-preview", "--project", root, "--slug", document.slug, "--source", auxiliary,
  ], { encoding: "utf8" }));
  assert.equal(cliPreview.review_sha256, preview.review_sha256);
  const manifestPath = path.join(root, directory, "manifest.json");
  const documentPath = path.join(root, directory, "specification.json");
  const lifecyclePath = path.join(root, directory, "lifecycle.json");
  const originalDocument = fs.readFileSync(documentPath, "utf8");
  const originalLifecycle = fs.readFileSync(lifecyclePath, "utf8");
  for (const kind of ["covered", "deferred", "cited", "mismatch"]) {
    const manifest = JSON.parse(manifestBefore.toString("utf8"));
    const specification = JSON.parse(originalDocument);
    if (kind === "cited") {
      specification.use_cases[0].evidence.push({ path: auxiliary, line: 1, quote: "servers" });
    } else {
      const coverage = { ...manifest.coverage.find(entry => entry.path === auxiliary),
        status: kind === "mismatch" ? "deferred" : kind };
      specification.coverage.push(coverage);
      if (kind !== "mismatch") manifest.coverage.push(coverage);
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    fs.writeFileSync(documentPath, JSON.stringify(specification));
    const lifecycle = JSON.parse(originalLifecycle);
    lifecycle.approvals.specification.sha256 = currentDigest(root, document.slug, "specification");
    fs.writeFileSync(lifecyclePath, JSON.stringify(lifecycle));
    assert.throws(() => previewSourceDrift(root, document.slug, auxiliary), /Only sources entirely recorded/, kind);
  }
  fs.writeFileSync(manifestPath, manifestBefore);
  fs.writeFileSync(documentPath, originalDocument);
  fs.writeFileSync(lifecyclePath, originalLifecycle);
  assert.throws(() => recordSourceDriftReview(root, { slug: document.slug, sourcePath: auxiliary,
    reviewer: "Owner", findings: "Reviewed the configuration change and its scope.", confirmSha256: "0".repeat(64) }), /confirmation digest/);
  assert.throws(() => previewSourceDrift(root, document.slug, file), /has not changed/);
  fs.appendFileSync(path.join(root, file), "\nChange business requirements.\n");
  assert.throws(() => previewSourceDrift(root, document.slug, file), /Only sources entirely recorded/);
  fs.writeFileSync(path.join(root, file), "# Public catalog\n\n## Search\nReaders search the public catalog without authentication.\n");
  const record = recordSourceDriftReview(root, { slug: document.slug, sourcePath: auxiliary,
    reviewer: "Owner", findings: "Reviewed the integration change; it remains outside the catalog scope.",
    confirmSha256: preview.review_sha256 });
  assert.equal(featureStatus(root, document.slug).next, "implement-and-verify");
  assert.equal(featureStatus(root, document.slug).reviewed_source_drift[0].review, record.path);
  assert.deepEqual(fs.readFileSync(path.join(root, directory, "manifest.json")), manifestBefore);
  assert.equal(currentDigest(root, document.slug, "specification"), specDigest);
  assert.deepEqual(prepareImplementationValidation(root, document.slug).spec.steps.map(step => step.id), ["check-001"]);
  const status = featureStatus(root, document.slug);
  const verificationPath = path.join(root, directory, "verification.json");
  const implementationRecord = {
    schema_version: 1, generated_by: "mcpee", scope: "planned-implementation-checks",
    product_acceptance: "not-verified", specification_sha256: specDigest,
    plan_sha256: status.reviews.plan.sha256, tasks_sha256: status.reviews.tasks.sha256,
    report: null, report_sha256: null, evaluation_id: null, completed_at: new Date().toISOString(),
    files: [{ path: auxiliary, sha256: preview.current_sha256 }],
    use_cases: [{ id: "UC-001", tasks: ["TASK-001"], checks: ["CHECK-001"], paths: ["src/catalog.js"] }],
  };
  fs.writeFileSync(verificationPath, JSON.stringify(implementationRecord));
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  implementationRecord.source_drift_reviews = prepareImplementationValidation(root, document.slug).source_drift_reviews;
  fs.writeFileSync(verificationPath, JSON.stringify(implementationRecord));
  assert.equal(featureStatus(root, document.slug).implementation_verified, true);
  const reviewPath = path.join(root, record.path);
  const reviewContent = fs.readFileSync(reviewPath, "utf8");
  const altered = JSON.parse(reviewContent);
  altered.findings = "Someone modified these review findings.";
  fs.writeFileSync(reviewPath, JSON.stringify(altered));
  assert.throws(() => featureStatus(root, document.slug), /Invalid source drift review/);
  fs.writeFileSync(reviewPath, reviewContent);
  fs.unlinkSync(reviewPath);
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  recordSourceDriftReview(root, { slug: document.slug, sourcePath: auxiliary, reviewer: "Owner",
    findings: "Reviewed the integration change; it remains outside the catalog scope.",
    confirmSha256: preview.review_sha256 });
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  fs.appendFileSync(path.join(root, auxiliary), " \n");
  assert.deepEqual(featureStatus(root, document.slug).drift, [auxiliary]);
  assert.throws(() => recordSourceDriftReview(root, { slug: document.slug, sourcePath: auxiliary,
    reviewer: "Owner", findings: "Reviewed the integration change.", confirmSha256: preview.review_sha256 }), /changed/);
  fs.unlinkSync(path.join(root, auxiliary));
  assert.deepEqual(featureStatus(root, document.slug).drift, [auxiliary]);
});

test("manual and unmapped checks do not prevent implementation or become passing verification", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  plan.checks.push(
    { id: "CHECK-002", command: "Manual review: inspect the catalog design.", expected: "A human reviews the catalog design." },
    { id: "CHECK-003", kind: "manual", command: "Review keyboard access manually.", expected: "A human reviews keyboard accessibility." },
    { id: "CHECK-004", kind: "automated", command: "npm run test:browser", expected: "Browser tests pass using the configured runner." },
  );
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  const delivery = tasks(root);
  delivery.tasks[0].checks.push("CHECK-002", "CHECK-003", "CHECK-004");
  publishPhase(root, document.slug, "tasks", JSON.stringify(delivery));
  const canonical = prepareImplementationValidation(root, document.slug, { allowPending: true });
  assert.deepEqual(canonical.spec.steps.map(step => step.id), ["check-001"]);
  assert.deepEqual(canonical.pending_checks.map(check => [check.id, check.kind]),
    [["CHECK-002", "manual"], ["CHECK-003", "manual"], ["CHECK-004", "automated"]]);
  assert.deepEqual(canonical.commands, [plan.checks[0].command]);
  assert.throws(() => recordImplementationVerification(root, document.slug, canonical,
    `.mcpee/reports/workflows/${crypto.randomUUID()}.json`), /checks remain pending/);
  const route = routeTask(root, "Create tasks for public-catalog");
  route.specification_workspace.requested_stage = "implementation";
  await assert.rejects(runCopilotTask(root, "Implement public-catalog", route, {
    approved: true, contextPackage: prepareApprovedSpecContext(root, route),
    clientFactory: () => { throw new Error("Reached implementation SDK"); },
  }), /Reached implementation SDK/);
  let observed;
  const missingOptions = {
    canonicalFeature: document.slug, approveSync: async () => true,
    syncProject: () => ({ counts: { failed: 0 }, graphify: { status: "not-installed" } }),
    discoverTools: () => ({ tools: [] }), updateCodeGraph: () => ({ status: "ready" }),
    onValidation: value => { observed = value; },
  };
  assert.equal(await synchronizeAfterCopilotChanges(root, [], "deliver-feature", missingOptions), 1);
  assert.deepEqual(observed.pending_checks, canonical.pending_checks);
  for (const file of ["src/catalog.js", "tests/catalog.test.js"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "module.exports = {};\n");
  }
  fs.writeFileSync(path.join(root, "tests/catalog.test.js"),
    "require('node:test')('catalog check', () => require('node:assert/strict').equal(1, 1));\n");
  assert.equal(await synchronizeAfterCopilotChanges(root, [], "deliver-feature", {
    ...missingOptions,
    runWorkflow: async () => ({ status: "failed", id: crypto.randomUUID(), file: ".mcpee/reports/evaluations/failure.json" }),
  }), 1);
  assert.equal(observed.status, "failed");
  assert.deepEqual(observed.pending_checks, canonical.pending_checks);
  const result = await synchronizeAfterCopilotChanges(root, [], "deliver-feature", {
    canonicalFeature: document.slug, approveSync: async () => true,
    syncProject: () => ({ counts: { failed: 0 }, graphify: { status: "not-installed" } }),
    discoverTools: () => ({ tools: [] }), updateCodeGraph: () => ({ status: "ready" }),
    runWorkflow: async (project, file, options) => {
      const marker = process.env.NODE_TEST_CONTEXT;
      delete process.env.NODE_TEST_CONTEXT;
      try {
        return await executeRunSpec(project, loadRunSpec(project, file), {
          approveStep: options.approveStep, impactPreflight: { status: "ready" },
        });
      } finally {
        if (marker !== undefined) process.env.NODE_TEST_CONTEXT = marker;
      }
    },
    onValidation: value => { observed = value; },
  });
  assert.equal(result, 1);
  assert.equal(observed.status, "blocked");
  assert.deepEqual(observed.pending_checks, canonical.pending_checks);
  assert.equal(read(root, observed.report).status, "passed");
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  assert.equal(fs.existsSync(path.join(root, workspace(document.slug, root), "verification.json")), false);
  const workflowPath = ".mcpee/workflows/spec-public-catalog.json";
  fs.mkdirSync(path.dirname(path.join(root, workflowPath)), { recursive: true });
  fs.writeFileSync(path.join(root, workflowPath), JSON.stringify({
    workflow_id: "spec-public-catalog", task: "Verify selected checks",
    steps: [{ id: "check-004", label: "Browser check", command: plan.checks[3].command,
      tool: "npm", args: ["run", "test:browser"] }],
  }));
  const adapted = prepareImplementationValidation(root, document.slug, { allowPending: true });
  assert.deepEqual(adapted.spec.steps.map(step => step.id), ["check-004"]);
  assert.deepEqual(adapted.pending_checks.map(check => check.id), ["CHECK-002", "CHECK-003", "CHECK-001"]);
  const workflow = read(root, workflowPath);
  workflow.steps.push({ id: "check-002", label: "Not a human review",
    command: plan.checks[1].command, tool: "node", args: ["--version"] });
  fs.writeFileSync(path.join(root, workflowPath), JSON.stringify(workflow));
  assert.throws(() => prepareImplementationValidation(root, document.slug, { allowPending: true }), /map every plan check exactly once/);
});

test("canonical hooks and shell permissions reject nested MCPEE before requesting approval", async () => {
  const { root } = fixture();
  let approvals = 0;
  const hooks = createCopilotHooks(root, { canonicalImplementation: true, interactive: true,
    approveTool: async () => { approvals++; return true; } });
  const command = "& .\\node_modules\\.bin\\mcpee.cmd specs status --slug public-catalog";
  const result = await hooks.onPreToolUse({ toolName: "powershell", toolArgs: { command } },
    { sessionId: crypto.randomUUID() });
  assert.equal(result.permissionDecision, "deny");
  assert.match(result.permissionDecisionReason, /owns canonical/);
  const permission = createPermissionRequestHandler(root, { canonicalImplementation: true, interactive: true,
    approvePermission: async () => { approvals++; return true; } });
  assert.equal((await permission({ kind: "shell", fullCommandText: command },
    { sessionId: crypto.randomUUID() })).kind, "reject");
  assert.equal(approvals, 0);
  assert.equal((await permission({ kind: "shell", fullCommandText: "npm install next" },
    { sessionId: crypto.randomUUID() })).kind, "approved");
  assert.equal(approvals, 1);
});

test("no runnable canonical checks leave verification blocked without creating a workflow", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  plan.checks[0] = { id: "CHECK-001", command: "Manual review: inspect the completed implementation.",
    expected: "A human reviews the completed implementation." };
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  for (const file of ["src/catalog.js", "tests/catalog.test.js"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "module.exports = {};\n");
  }
  let observed;
  assert.equal(await synchronizeAfterCopilotChanges(root, [], "deliver-feature", {
    canonicalFeature: document.slug, approveSync: async () => true,
    syncProject: () => ({ counts: { failed: 0 }, graphify: { status: "not-installed" } }),
    discoverTools: () => ({ tools: [] }), updateCodeGraph: () => ({ status: "ready" }),
    runWorkflow: async () => { throw new Error("No workflow should run"); },
    onValidation: value => { observed = value; },
  }), 1);
  assert.equal(observed.status, "blocked");
  assert.deepEqual(observed.pending_checks.map(check => check.id), ["CHECK-001"]);
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
});

test("manual review evidence completes mixed verification and becomes stale on changes", async () => {
  const { previewManualReview, recordManualReview } = require("../packages/spec-engine/src/manual-review");
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  plan.checks.push({ id: "CHECK-002", kind: "manual", command: "Review keyboard access manually.",
    expected: "A human reviews keyboard accessibility." });
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  const delivery = tasks(root);
  delivery.tasks[0].checks.push("CHECK-002");
  publishPhase(root, document.slug, "tasks", JSON.stringify(delivery));
  assert.throws(() => previewManualReview(root, document.slug, "CHECK-002"), /all planned evidence files/);
  for (const file of ["src/catalog.js", "tests/catalog.test.js"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), file.startsWith("tests")
      ? "require('node:test')('catalog', () => require('node:assert/strict').equal(1, 1));\n"
      : "module.exports = {};\n");
  }
  assert.throws(() => previewManualReview(root, document.slug, "CHECK-001"), /Not a canonical manual check/);
  const preview = previewManualReview(root, document.slug, "CHECK-002");
  recordManualReview(root, { slug: document.slug, id: "CHECK-002", reviewer: "Owner", outcome: "failed",
    findings: "Keyboard behavior failed.", confirmSha256: preview.review_sha256 });
  assert.deepEqual(prepareImplementationValidation(root, document.slug, { allowPending: true })
    .pending_checks.map(check => check.id), ["CHECK-002"]);
  assert.throws(() => recordManualReview(root, { slug: document.slug, id: "CHECK-002", reviewer: "Owner", outcome: "passed",
    findings: "Reviewed keyboard behavior.", confirmSha256: "0".repeat(64) }), /confirmation digest/);
  const review = recordManualReview(root, { slug: document.slug, id: "CHECK-002", reviewer: "Owner", outcome: "passed",
    findings: "Reviewed keyboard behavior and focus order.", confirmSha256: preview.review_sha256 });
  const canonical = prepareImplementationValidation(root, document.slug, { allowPending: true });
  assert.equal(canonical.pending_checks, undefined);
  assert.equal(canonical.manual_reviews[0].path, review.path);
  const options = {
    canonicalFeature: document.slug, approveSync: async () => true,
    syncProject: () => ({ counts: { failed: 0 }, graphify: { status: "not-installed" } }),
    discoverTools: () => ({ tools: [] }), updateCodeGraph: () => ({ status: "ready" }),
    generateProjectDocumentation: () => ({ files: [], counts: { written: 0, preserved: 0 } }),
    runWorkflow: async (project, file, options) => {
      const marker = process.env.NODE_TEST_CONTEXT;
      delete process.env.NODE_TEST_CONTEXT;
      try {
        return await executeRunSpec(project, loadRunSpec(project, file), {
          approveStep: options.approveStep, impactPreflight: { status: "ready" },
        });
      } finally { if (marker !== undefined) process.env.NODE_TEST_CONTEXT = marker; }
    },
  };
  assert.equal(await synchronizeAfterCopilotChanges(root, [], "deliver-feature", options), 0);
  assert.equal(featureStatus(root, document.slug).implementation_verified, true);
  assert.equal(featureStatus(root, document.slug).implementation.manual_reviews[0].reviewer, "Owner");
  recordManualReview(root, { slug: document.slug, id: "CHECK-002", reviewer: "Owner", outcome: "failed",
    findings: "A subsequent review found an accessibility issue.", confirmSha256: preview.review_sha256 });
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  assert.deepEqual(prepareImplementationValidation(root, document.slug, { allowPending: true })
    .pending_checks.map(check => check.id), ["CHECK-002"]);
  fs.appendFileSync(path.join(root, "src/catalog.js"), "// changed\n");
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  assert.deepEqual(prepareImplementationValidation(root, document.slug, { allowPending: true })
    .pending_checks.map(check => check.id), ["CHECK-002"]);
  assert.throws(() => recordManualReview(root, { slug: document.slug, id: "CHECK-002", reviewer: "Owner", outcome: "passed",
    findings: "Reviewed keyboard behavior.", confirmSha256: preview.review_sha256 }), /evidence changed/);
});

test("manual-only checks can be finalized without inventing automated results", () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  plan.checks[0] = { id: "CHECK-001", kind: "manual", command: "Review the implementation manually.",
    expected: "A human inspects the implementation." };
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  for (const file of ["src/catalog.js", "tests/catalog.test.js"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "module.exports = {};\n");
  }
  const cli = (...args) => require("node:child_process").spawnSync(process.execPath,
    [path.resolve(__dirname, "../packages/cli/bin/mcpee.js"), ...args, "--project", root],
    { cwd: root, encoding: "utf8", timeout: 60000 });
  const previewOutput = cli("specs", "manual-preview", "--slug", document.slug, "--id", "CHECK-001");
  assert.equal(previewOutput.status, 0, previewOutput.stderr);
  const preview = JSON.parse(previewOutput.stdout);
  const saved = cli("specs", "manual-review", "--slug", document.slug, "--id", "CHECK-001",
    "--reviewer", "Owner", "--outcome", "passed", "--findings", "Inspected implementation and verified its behavior.",
    "--confirm-sha256", preview.review_sha256);
  assert.equal(saved.status, 0, saved.stderr);
  const canonical = prepareImplementationValidation(root, document.slug, { allowPending: true });
  assert.deepEqual(canonical.spec.steps, []);
  const finalized = cli("workflow", "run", "--spec", ".mcpee/workflows/spec-public-catalog.json");
  assert.equal(finalized.status, 0, finalized.stderr);
  const record = read(root, `${workspace(document.slug, root)}/verification.json`);
  assert.equal(record.report, null);
  assert.equal(record.evaluation_id, null);
  assert.equal(featureStatus(root, document.slug).implementation_verified, true);
  fs.appendFileSync(path.join(root, record.manual_reviews[0].path), " ");
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
});

test("canonical workflow CLI constructs evidence and records exact passing verification with per-step approval", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  plan.checks[0].command = "node --version";
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  for (const file of ["src/catalog.js", "tests/catalog.test.js"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "module.exports = {};\n");
  }
  const workflowPath = ".mcpee/workflows/spec-public-catalog.json";
  fs.mkdirSync(path.dirname(path.join(root, workflowPath)), { recursive: true });
  fs.writeFileSync(path.join(root, workflowPath), JSON.stringify({
    workflow_id: "spec-public-catalog", task: "Verify canonical runtime version",
    steps: [{ id: "check-001", label: plan.checks[0].expected, command: "node --version",
      tool: "node", args: ["--version"], requires_approval: true }],
  }));
  syncProject(root, { generateDocumentation: false, discoverSpecifications: false,
    tools: [], graphify: { installed: false } });
  let approvals = 0;
  const broker = await require("../packages/mcp-server/src/server").createApprovalBroker(async (kind, details) => {
    assert.equal(kind, "workflow-step");
    assert.equal(details.tool, "node");
    assert.deepEqual(details.args, ["--version"]);
    approvals++;
    return true;
  });
  try {
    const output = await new Promise((resolve, reject) => {
      const child = require("node:child_process").spawn(process.execPath, [
        path.resolve(__dirname, "../packages/cli/bin/mcpee.js"), "workflow", "run",
        "--project", root, "--spec", workflowPath,
      ], { cwd: root, env: { ...process.env,
        MCPEE_APPROVAL_BROKER_URL: broker.url, MCPEE_APPROVAL_BROKER_TOKEN: broker.token } });
      let text = "";
      child.stdout.on("data", chunk => { text += chunk; });
      child.stderr.on("data", chunk => { text += chunk; });
      child.on("error", reject);
      child.on("close", code => resolve({ code, text }));
    });
    assert.equal(output.code, 0, output.text);
    assert.equal(approvals, 1);
    assert.equal(featureStatus(root, document.slug).implementation_verified, true);
  } finally { broker.close(); }
});

test("explicit workflows require invocation approval and bind adapter content to actual verification evidence", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  plan.checks[0].command = "node --version";
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
  const workflowPath = ".mcpee/workflows/spec-public-catalog.json";
  fs.mkdirSync(path.dirname(path.join(root, workflowPath)), { recursive: true });
  const workflow = { workflow_id: "spec-public-catalog", task: "Verify canonical runtime version",
    steps: [{ id: "check-001", label: plan.checks[0].expected, command: "node --version",
      tool: "node", args: ["--version"], cwd: "tests", requires_approval: false }] };
  fs.writeFileSync(path.join(root, workflowPath), JSON.stringify(workflow));
  fs.writeFileSync(path.join(root, ".mcpee/workflows/deliver-feature.json"), '{"workflow_id":"unrelated-workflow"}');
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "src/catalog.js"), "module.exports = {};\n");
  fs.writeFileSync(path.join(root, "tests/catalog.test.js"), "require('node:test')('catalog', () => {});\n");
  const adapterBefore = fs.readFileSync(path.join(root, workflowPath));
  const cliResult = require("node:child_process").spawnSync(process.execPath, [
    path.resolve(__dirname, "../packages/cli/bin/mcpee.js"), "workflow", "run",
    "--project", root, "--spec", workflowPath.replace(/\//g, "\\"),
  ], { cwd: root, encoding: "utf8", timeout: 30000,
    env: { ...process.env, MCPEE_APPROVAL_BROKER_URL: "", MCPEE_APPROVAL_BROKER_TOKEN: "" } });
  assert.equal(cliResult.status, 1, cliResult.stderr);
  assert.doesNotMatch(cliResult.stderr, /requires at least one project evidence file/);
  assert.match(cliResult.stdout, /blocked/);
  assert.ok(fs.readFileSync(path.join(root, workflowPath)).equals(adapterBefore));
  const canonical = prepareImplementationValidation(root, document.slug);
  let approved = false, approvalCalls = 0, actualReport;
  const options = {
    canonicalFeature: document.slug, approveSync: async () => true,
    syncProject: () => ({ counts: { failed: 0 }, graphify: { status: "not-installed" } }),
    discoverTools: () => ({ tools: [] }), updateCodeGraph: () => ({ status: "ready" }),
    beforeRun: () => {}, approveStep: async () => { approvalCalls++; return approved; },
    runWorkflow: async (project, file, options) => {
      const report = await executeRunSpec(project, loadRunSpec(project, file), {
        approveStep: options.approveStep, impactPreflight: { status: "ready" },
      });
      if (report.status === "passed") actualReport = report.file;
      return report;
    },
    generateProjectDocumentation: () => ({ files: [], counts: { written: 0, preserved: 0 } }),
  };
  assert.equal(await synchronizeAfterCopilotChanges(root, [], "deliver-feature", options), 1);
  assert.equal(approvalCalls, 1);
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  approved = true;
  assert.equal(await synchronizeAfterCopilotChanges(root, [], "deliver-feature", options), 0);
  assert.equal(approvalCalls, 2);
  assert.equal(featureStatus(root, document.slug).implementation_verified, true);
  const record = read(root, `${workspace(document.slug, root)}/verification.json`);
  assert.ok(record.files.some(file => file.path === workflowPath && file.sha256 === canonical.workflow_sha256));
  workflow.steps[0].args = ["--help"];
  fs.writeFileSync(path.join(root, workflowPath), JSON.stringify(workflow));
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  assert.throws(() => recordImplementationVerification(root, document.slug, canonical, actualReport), /Canonical phases changed/);
});

test("canonical local implementation checks complete without a routed ingestion workflow or per-test approval", async () => {
  const { root, sources, document } = fixture();
  publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
  const plan = technicalPlan(root);
  plan.design.push({ id: "DESIGN-002", description: "Document anonymous catalog lookup and its empty response.",
    use_cases: ["UC-001"], paths: ["docs/catalog.md"] });
  publishPhase(root, document.slug, "plan", JSON.stringify(plan));
  const delivery = tasks(root);
  delivery.tasks.push({ id: "TASK-003", kind: "documentation",
    description: "Document anonymous catalog lookup after its implementation checks.",
    use_cases: ["UC-001"], paths: ["docs/catalog.md"], depends_on: ["TASK-002"], checks: ["CHECK-001"] });
  publishPhase(root, document.slug, "tasks", JSON.stringify(delivery));
  fs.writeFileSync(path.join(root, "docs/catalog.md"), "# Anonymous catalog\n\nSearch matching book titles without authentication.\n");
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
  assert.equal(featureStatus(root, document.slug).document_state, "approved");
  assert.equal(featureStatus(root, document.slug).authority_basis, "explicit-approval");
  assert.equal(fs.existsSync(path.join(root, "docs/specifications/reviewed/public-catalog")), false);
  assert.equal(featureStatus(root, document.slug).next, "review-product-acceptance");
  assert.equal(featureStatus(root, document.slug).implementation.product_acceptance, "not-verified");
  const verification = read(root, `${workspace("public-catalog", root)}/verification.json`);
  assert.deepEqual(verification.use_cases[0].tasks.sort(), ["TASK-001", "TASK-002"]);
  assert.deepEqual(verification.use_cases[0].checks, ["CHECK-001"]);
  assert.ok(!verification.use_cases[0].paths.includes("docs/catalog.md"));
  assert.ok(verification.files.some(file => file.path === "docs/catalog.md"));
  assert.ok(canonicalArtifacts(root).some(file => file.path.endsWith("/verification.json")));
  const report = read(root, validation.report);
  const originalReport = fs.readFileSync(path.join(root, validation.report), "utf8");
  report.checks[0].args = ["--version"];
  fs.writeFileSync(path.join(root, validation.report), JSON.stringify(report));
  assert.equal(featureStatus(root, document.slug).implementation_verified, false);
  assert.throws(() => recordImplementationVerification(root, document.slug,
    prepareImplementationValidation(root, document.slug), validation.report), /exact canonical check/);
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
  assert.equal(featureStatus(root, document.slug).authoritative, true);
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

test("greenfield and brownfield share bundle transitions, explicit approval gates and separate phase validation", async () => {
  for (const brownfield of [false, true]) {
    const { root, sources, document } = fixture({ brownfield });
    publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic: true });
    publishPhase(root, document.slug, "plan", JSON.stringify(technicalPlan(root, { approveRequirements: false })));
    const reviewed = featureStatus(root, document.slug);
    assert.equal(reviewed.specification_approved, false);
    assert.equal(reviewed.document_state, "reviewed");
    assert.deepEqual(reviewed.transitions.map(item => item.to), ["proposed", "reviewed"]);
    assert.equal(reviewed.reviews.plan.approved, true);
    assert.equal(reviewed.reviews.tasks.present, false);
    for (const task of ["Create tasks for public-catalog", "Implement public-catalog"]) {
      const plan = routeTask(root, "Create tasks for public-catalog");
      if (task.startsWith("Implement")) plan.specification_workspace.requested_stage = "implementation";
      await assert.rejects(runCopilotTask(root, task, plan, {
        approved: true, clientFactory: () => { assert.fail("Unapproved requirements must stop before SDK construction."); },
      }), /requires explicit specification approval/);
    }
    const result = await runSpecificationLifecycle(root, {
      slug: document.slug, task: "Generate and implement public-catalog", through: "verification",
      execute: () => { assert.fail("A generation request must not fabricate requirement approval."); },
    });
    assert.equal(result.status, "blocked");
    assert.match(result.reason, /approve-specification/);
    approveStage(root, { slug: document.slug, reviewer: "Fixture product owner",
      confirmSha256: currentDigest(root, document.slug, "specification") });
    const approved = featureStatus(root, document.slug);
    assert.equal(approved.next, "author-tasks");
    assert.deepEqual(approved.transitions.map(item => item.to), ["proposed", "reviewed", "approved"]);
    assert.equal(approved.reviews.plan.approved, true);
    assert.equal(approved.reviews.tasks.approved, false);
    publishPhase(root, document.slug, "tasks", JSON.stringify(tasks(root)));
    const ready = featureStatus(root, document.slug);
    assert.equal(ready.next, "implement-and-verify");
    assert.equal(ready.document_state, "approved");
    assert.equal(ready.implementation_verified, false);
    assert.deepEqual(ready.transitions, approved.transitions);
    for (const stage of ["specification", "plan", "tasks"]) {
      assert.equal(ready.reviews[stage].approved, true);
      assert.ok(ready.reviews[stage].path.startsWith("docs/specifications/approved/public-catalog/"));
    }
    const file = path.join(root, workspace(document.slug, root), "tasks.md");
    fs.appendFileSync(file, "\nOwner changes task validation requirements.\n");
    const changed = featureStatus(root, document.slug);
    assert.equal(changed.document_state, "approved");
    assert.equal(changed.specification_approved, true);
    assert.equal(changed.reviews.plan.approved, true);
    assert.equal(changed.reviews.tasks.approved, false);
    assert.equal(changed.next, "review-tasks");
  }
});

test("lifecycle reconciliation requires matching terminal run and exited child, preserving the original", () => {
  const { root } = fixture();
  const { reconcileInterruptedLifecycle } = require("../packages/spec-engine/src/orchestration");
  const id = crypto.randomUUID(), runId = crypto.randomUUID();
  const reportPath = `.mcpee/reports/lifecycles/${id}.json`, runPath = `.mcpee/state/runs/${runId}.json`;
  fs.mkdirSync(path.dirname(path.join(root, reportPath)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(root, runPath)), { recursive: true });
  const now = Date.now();
  const report = { generated_by: "mcpee", id, status: "running", task_sha256: "a".repeat(64),
    started_at: new Date(now).toISOString(), phases: [{ phase: "implementation", status: "running" }] };
  const child = require("node:child_process").spawnSync(process.execPath, ["-e", ""]);
  const run = { generated_by: "mcpee", run_id: runId, status: "cancelled",
    task_sha256: report.task_sha256, started_at: now - 100, updated_at: now + 100, child_pid: child.pid };
  const original = JSON.stringify(report);
  fs.writeFileSync(path.join(root, reportPath), original);
  const save = () => fs.writeFileSync(path.join(root, runPath), JSON.stringify(run));
  run.child_pid = process.pid; save();
  assert.throws(() => reconcileInterruptedLifecycle(root, id, runId), /may still be running/);
  run.child_pid = child.pid; run.task_sha256 = "b".repeat(64); save();
  assert.throws(() => reconcileInterruptedLifecycle(root, id, runId), /do not match/);
  run.task_sha256 = report.task_sha256; save();
  const reconciled = reconcileInterruptedLifecycle(root, id, runId);
  assert.equal(reconciled.status, "interrupted");
  assert.equal(reconciled.phases[0].status, "interrupted");
  assert.equal(fs.readFileSync(path.join(root, reconciled.reconciliation.previous_report), "utf8"), original);
  assert.throws(() => reconcileInterruptedLifecycle(root, id, runId), /do not match/);
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
