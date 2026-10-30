"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { initializeProject } = require("../packages/core/src/project");
const { readCatalog } = require("../packages/copilot-renderer/src/render");
const { detectProjectCapabilities } = require("../packages/copilot-renderer/src/project-capabilities");
const { syncProject } = require("../packages/source-engine/src/sync");
const { discoverBrownfieldSpec, ratifyBrownfieldSpec, listBrownfieldSpecs } = require("../packages/spec-engine/src/brownfield");
const { isSpecificationTask, prepareFunctionalSources, validateFunctionalSpec, publishFunctionalSpec } = require("../packages/spec-engine/src/functional");
const { runCopilotTask, createCopilotHooks } = require("../packages/execution-engine/src/copilot");
const { routeTask } = require("../packages/routing-engine/src/route");

const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-functional-spec-"));
  roots.push(root);
  initializeProject(root);
  const file = "knowledge/sources/business/league.md";
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), "# League\n\n## Registration\nRegistration is closed until the organizer publishes an authorized link.\n\n## Teams\nOfficial teams consist of four participants.\n");
  return { root, file, sources: prepareFunctionalSources(root, [file]) };
}
function draft(file) {
  return {
    language: "en", title: "League public participation", slug: "league-public-participation",
    summary: "Help prospective participants understand official teams and registration availability.",
    scope: ["Display the public registration state and official team size."],
    non_goals: ["Do not create accounts or collect private participant details."],
    actors: [{ id: "ACT-001", name: "Prospective participant", goal: "Understand when and how their team can participate." }],
    use_cases: [{
      id: "UC-001", title: "Check team registration availability", actor: "ACT-001", basis: "documented",
      trigger: "The visitor opens the public participation page.",
      preconditions: ["The organizer has not yet published an authorized registration link."],
      main_flow: ["The visitor reads the official team size of four participants.", "The page explains that registration remains closed."],
      alternatives: ["When the authorized link is published, show the confirmed participation destination."],
      postconditions: ["The visitor understands registration availability without submitting personal information."],
      rules: ["An official team consists of four participants."],
      acceptance_criteria: [{ given: "Registration has no authorized destination.", when: "A visitor opens participation information.", then: "A closed state is visible without a broken registration link." }],
      evidence: [{ path: file, line: 4, quote: "Registration is closed until the organizer publishes an authorized link." },
        { path: file, line: 7, quote: "Official teams consist of four participants." }],
    }],
    open_questions: ["Who confirms the registration opening date and authorized link?"],
    coverage: [
      { path: file, line: 3, status: "covered", use_cases: ["UC-001"], reason: "Registration state and unavailable destination are explicitly described." },
      { path: file, line: 6, status: "covered", use_cases: ["UC-001"], reason: "The visitor reads the confirmed official team size." },
    ],
  };
}
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

test("specification intent distinguishes authoring from ordinary audits and coding", () => {
  for (const task of ["Prepara las especificaciones funcionales de League", "Genera casos de uso del documento", "Draft functional specifications", "hazme el greenfield", "brownfield del proyecto"]) {
    assert.equal(isSpecificationTask(task), true, task);
  }
  for (const task of ["Fix a bug in the greenfield detector", "Review the functional specification", "Explain use cases", "Create a website", "Write tests for the specification parser"]) {
    assert.equal(isSpecificationTask(task), false, task);
  }
});

test("MCPEE-only manifests and its caches are not application-code evidence", () => {
  const { root } = fixture();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { "mcp-efficiency-engine": "^0.1.36" } }));
  fs.writeFileSync(path.join(root, "package-lock.json"), "{}");
  fs.mkdirSync(path.join(root, ".codegraph"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codegraph", "cache.js"), "export const cache = true;");
  let detected = detectProjectCapabilities(root, readCatalog().catalog);
  assert.equal(detected.has_code_signals, false);
  assert.deepEqual(detected.code_evidence_files, []);
  syncProject(root);
  const discovery = discoverBrownfieldSpec(root);
  const allEvidence = discovery.proposals.flatMap((proposal) =>
    JSON.parse(fs.readFileSync(path.join(root, proposal.evidencePath), "utf8")).sources);
  assert.deepEqual(allEvidence.map(({ path: file }) => file), ["knowledge/sources/business/league.md"]);
  const proposal = fs.readFileSync(path.join(root, discovery.proposals[0].specPath), "utf8");
  assert.match(proposal, /Evidence inventory/);
  assert.match(proposal, /No source-derived test cases/);
  assert.doesNotMatch(proposal, /Owner-confirmed normal behavior|\.cases-1\.md/);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { "mcp-efficiency-engine": "^0.1.36", express: "^5" } }));
  detected = detectProjectCapabilities(root, readCatalog().catalog);
  assert.equal(detected.has_code_signals, true);
  assert.deepEqual(detected.detected_technologies.map(({ id }) => id), ["node"]);
});

test("an installation without product sources creates no scaffolding-only proposals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-empty-spec-"));
  roots.push(root);
  initializeProject(root);
  fs.writeFileSync(path.join(root, "package.json"), '{"dependencies":{"mcp-efficiency-engine":"^0.1.36"}}');
  syncProject(root);
  assert.equal(discoverBrownfieldSpec(root).status, "empty");
});

test("converted document authoring uses normalized text and binds both original and text hashes", () => {
  const { root, file } = fixture();
  const original = "knowledge/sources/business/league.pdf";
  fs.writeFileSync(path.join(root, original), Buffer.from("%PDF synthetic fixture, not a document converter test"));
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, original))).digest("hex");
  fs.writeFileSync(path.join(root, "knowledge/traceability/source-manifest.json"),
    JSON.stringify({ generated_by: "mcpee", sources: [{ path: original, sha256, status: "processed", normalized_path: file }] }));
  const sources = prepareFunctionalSources(root, [original]);
  assert.equal(sources[0].path, file);
  assert.equal(sources[0].original_path, original);
  validateFunctionalSpec(root, JSON.stringify(draft(file)), sources);
  fs.appendFileSync(path.join(root, original), "\nChanged source.");
  assert.throws(() => validateFunctionalSpec(root, JSON.stringify(draft(file)), sources), /source changed/);
  assert.throws(() => prepareFunctionalSources(root, [original]), /no current converted text/);
});

test("readable specifications preserve flows, acceptance criteria, traceability and owner edits", () => {
  const { root, file, sources } = fixture();
  const response = JSON.stringify(draft(file));
  const result = publishFunctionalSpec(root, response, sources);
  assert.equal(result.path, "docs/specifications/league-public-participation.md");
  assert.match(result.content, /### UC-001 - Check team registration availability/);
  assert.match(result.content, /Main flow/);
  assert.match(result.content, /Given:?\*\*/);
  assert.match(result.content, /league\.md#L4/);
  assert.equal(publishFunctionalSpec(root, response, sources).content, result.content);
  fs.appendFileSync(path.join(root, result.path), "\nOwner changes\n");
  assert.throws(() => publishFunctionalSpec(root, response, sources), /already exists with different content/);
  assert.match(fs.readFileSync(path.join(root, result.path), "utf8"), /Owner changes/);
  const spanish = draft(file);
  spanish.language = "es";
  spanish.slug = "league-participacion";
  assert.match(publishFunctionalSpec(root, JSON.stringify(spanish), sources).content, /## Casos de uso/);
});

test("validation rejects empty, generic, ungrounded and incompletely mapped output", () => {
  const { root, file, sources } = fixture();
  for (const [modify, message] of [
    [(data) => { data.use_cases = []; }, /structured deliverable/],
    [(data) => { data.use_cases[0].main_flow = ["TODO fill this in"]; }, /structured deliverable/],
    [(data) => { data.use_cases[0].title = "Owner-confirmed normal behavior"; }, /structured deliverable/],
    [(data) => { data.use_cases[0].title = "Valid input"; }, /structured deliverable/],
    [(data) => { data.use_cases[0].evidence[0].quote = "An invented registration rule."; }, /Unsupported evidence/],
    [(data) => { data.use_cases[0].evidence[0].path = "../outside.md"; }, /Unsupported evidence/],
    [(data) => { data.use_cases[0].actor = "ACT-999"; }, /Unknown actor/],
    [(data) => { data.coverage.pop(); }, /missing section coverage/],
    [(data) => { data.coverage[0].use_cases = []; }, /Invalid use-case mapping/],
    [(data) => { data.coverage[0].use_cases = ["UC-999"]; }, /Invalid use-case mapping/],
    [(data) => { data.coverage.push(data.coverage[0]); }, /Duplicate source section/],
    [(data) => { data.use_cases[0].evidence.pop(); }, /Unsupported covered section/],
  ]) {
    const data = draft(file);
    modify(data);
    assert.throws(() => publishFunctionalSpec(root, JSON.stringify(data), sources), message);
    assert.equal(fs.existsSync(path.join(root, "docs/specifications")), false);
  }
  assert.throws(() => validateFunctionalSpec(root, "Discovery completed; please fill in the templates.", sources), /incomplete/);
  fs.appendFileSync(path.join(root, file), "\nChanged business rules.\n");
  assert.throws(() => validateFunctionalSpec(root, JSON.stringify(draft(file)), sources), /source changed/);
});

test("authored behavior fills matching review proposals without manual copying or automatic approval", () => {
  const { root, file, sources } = fixture();
  syncProject(root);
  const result = publishFunctionalSpec(root, JSON.stringify(draft(file)), sources);
  assert.equal(result.reviews.length, 1);
  const review = result.reviews[0];
  assert.equal(review.status, "draft-filled-for-review");
  const content = fs.readFileSync(path.join(root, review.path), "utf8");
  assert.match(content, /Check team registration availability/);
  assert.doesNotMatch(content, /<!-- Replace this prompt|<!-- Add observable/);
  assert.ok(listBrownfieldSpecs(root).every(({ status }) => status !== "approved"));
  syncProject(root);
  assert.equal(fs.readFileSync(path.join(root, review.path), "utf8"), content);
  const repeat = publishFunctionalSpec(root, JSON.stringify(draft(file)), sources);
  assert.equal(repeat.reviews[0].status, "preserved-existing-review");
  assert.throws(() => ratifyBrownfieldSpec(root, { slug: review.slug, reviewer: "Fixture owner", confirmSha256: "0".repeat(64) }), /Proposal changed/);
  ratifyBrownfieldSpec(root, { slug: review.slug, reviewer: "Fixture owner", confirmSha256: review.sha256 });
  assert.ok(listBrownfieldSpecs(root).some(({ status }) => status === "approved"));
});

test("missing product sources fail before creating an SDK client", async () => {
  const { root } = fixture();
  let started = false;
  await assert.rejects(runCopilotTask(root, "Draft functional specifications", {
    workflow: { id: "refine-backlog" }, agent: { id: "product" }, knowledge: [],
  }, { approved: true, clientFactory: () => { started = true; } }), /no product sources/);
  assert.equal(started, false);
});

test("specification authoring denies model writes and shell actions without another approval", async () => {
  const { root, file } = fixture();
  const hooks = createCopilotHooks(root, { specificationAuthoring: true,
    approveTool: async () => { throw new Error("An authoring run must not ask to implement or execute commands."); } });
  const invocation = { sessionId: "read-only-author" };
  assert.equal((await hooks.onPreToolUse({ toolName: "view", toolArgs: { path: file } }, invocation)).permissionDecision, "allow");
  assert.equal((await hooks.onPreToolUse({ toolName: "create_file", toolArgs: { path: "src/app.js" } }, invocation)).permissionDecision, "deny");
  assert.equal((await hooks.onPreToolUse({ toolName: "powershell", toolArgs: { command: "node --version" } }, invocation)).permissionDecision, "deny");
});

test("the executor persists a validated deliverable and fails instead of reporting empty-template success", async () => {
  const { root, file } = fixture();
  let response = "Static discovery completed.";
  let prompt;
  let disconnected = 0;
  const client = {
    async start() {},
    async stop() {},
    async createSession() {
      return {
        sessionId: "functional-fixture",
        async sendAndWait(message) { prompt = message.prompt; return { data: { content: response } }; },
        async disconnect() { disconnected += 1; },
      };
    },
  };
  const plan = { workflow: { id: "refine-backlog" }, agent: { id: "product" }, knowledge: [{ source_path: file }] };
  await assert.rejects(runCopilotTask(root, "Draft functional specifications", plan,
    { approved: true, clientFactory: () => client }), /specification incomplete/);
  assert.match(prompt, /Static discovery is an evidence inventory, NOT the requested deliverable/);
  assert.match(prompt, /Do not implement application code/);
  response = JSON.stringify(draft(file));
  const result = await runCopilotTask(root, "Draft functional specifications", plan,
    { approved: true, clientFactory: () => client });
  assert.equal(disconnected, 2);
  assert.equal(result.specification.status, "draft-structurally-validated");
  assert.deepEqual(result.changedPaths, [result.specification.path]);
  assert.match(fs.readFileSync(path.join(root, result.specification.path), "utf8"), /Registration remains closed|registration remains closed/);
});

test("functional routing takes priority over document and frontend keywords", () => {
  const { root, file } = fixture();
  syncProject(root);
  const toolRoot = path.join(root, ".mcpee/tools/npm/node_modules/@colbymchenry");
  for (const name of ["codegraph", `codegraph-${process.platform}-${process.arch}`]) {
    fs.mkdirSync(path.join(toolRoot, name), { recursive: true });
    fs.writeFileSync(path.join(toolRoot, name, "package.json"), '{"version":"1.6.2"}');
  }
  fs.writeFileSync(path.join(toolRoot, "codegraph/npm-shim.js"), 'process.stdout.write("[]");');
  fs.writeFileSync(path.join(root, ".mcpee/state/codegraph.json"), JSON.stringify({ generated_by: "mcpee", status: "ready" }));
  const plan = routeTask(root, "Prepara las especificaciones funcionales greenfield de la web a partir del documento");
  assert.equal(plan.agent.id, "product");
  assert.equal(plan.functional_specification.mode, "greenfield");
  assert.ok(plan.skills.some(({ id }) => id === "requirements-discovery"));
  assert.equal(plan.knowledge[0].source_path, file);
});
