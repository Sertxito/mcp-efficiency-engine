"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");
const { initializeProject } = require("../packages/core/src/project");
const { prepareFunctionalSources, publishFunctionalSpec } = require("../packages/spec-engine/src/functional");
const {
  featureStatus, currentDigest, approveStage, resolveDecision, refreshWorkspaceIndex, migrateDrafts, listFeatures,
} = require("../packages/spec-engine/src/lifecycle");
const { listBrownfieldSpecs, prepareApprovedSpecContext, checkSpecDrift } = require("../packages/spec-engine/src/brownfield");
const { createPlan } = require("../packages/planning-engine/src/planning");
const { runCopilotTask } = require("../packages/execution-engine/src/copilot");
const { routeTask } = require("../packages/routing-engine/src/route");
const { syncProject } = require("../packages/source-engine/src/sync");

const digest = (content) => crypto.createHash("sha256").update(content).digest("hex");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-canonical-spec-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  const file = "knowledge/sources/business/library.md";
  fs.writeFileSync(path.join(root, file), "# Library\n\nReaders may search the public catalog without signing in.\n");
  const document = {
    language: "en", title: "Public library catalog", slug: "public-catalog",
    summary: "Help readers find books through an anonymous public catalog.",
    scope: ["Search the public book catalog without authentication."],
    non_goals: ["Borrowing and member administration are not included."],
    actors: [{ id: "ACT-001", name: "Library reader", goal: "Discover a book in the public catalog." }],
    use_cases: [{
      id: "UC-001", title: "Search the public library catalog", actor: "ACT-001",
      goal: "Find a book without registering for a member account.",
      dependencies: [], open_questions: [], basis: "documented",
      trigger: "The reader submits a catalog search.",
      preconditions: ["The public catalog is available."],
      main_flow: ["The reader supplies a book title.", "The catalog returns matching public books."],
      alternatives: ["No matching title produces a visible no-results state."],
      postconditions: ["The reader sees matching book information."],
      rules: ["The public search must not require authentication."],
      acceptance_criteria: [{ given: "An anonymous reader visits the catalog.", when: "They search for a title.", then: "They see public results without signing in." }],
      evidence: [{ path: file, line: 3, quote: "Readers may search the public catalog without signing in." }],
    }],
    open_questions: ["Which book metadata must be displayed with each search result?"],
    coverage: [{ path: file, line: 1, status: "covered", use_cases: ["UC-001"], reason: "The anonymous public search is specified in UC-001." }],
  };
  const sources = prepareFunctionalSources(root, [file]);
  const result = publishFunctionalSpec(root, JSON.stringify(document), sources);
  return { root, file, document, sources, result, slug: document.slug };
}
function approve(root, slug, stage) {
  return approveStage(root, { slug, stage, reviewer: "Product owner", confirmSha256: currentDigest(root, slug, stage) });
}
function resolve(root, slug) {
  return resolveDecision(root, { slug, id: "Q-001", answer: "Display the title and author for every catalog result.", reviewer: "Product owner" });
}

test("one workspace links real artifacts and exposes clarification before approval", (t) => {
  const { root, slug, result } = fixture(t);
  assert.equal(result.path, `specs/${slug}/spec.md`);
  assert.equal(result.workspacePath, "specs/README.md");
  assert.equal(featureStatus(root, slug).next, "clarify");
  assert.throws(() => approve(root, slug, "specification"), /Resolve open decisions/);
  const next = resolve(root, slug);
  assert.equal(next.next, "review-specification");
  assert.throws(() => approveStage(root, { slug, reviewer: "Owner", confirmSha256: "0".repeat(64) }), /digest does not match/);
  assert.throws(() => approveStage(root, { slug, stage: "plan", reviewer: "Owner", confirmSha256: "0".repeat(64) }), /Approve specification/);
  assert.equal(approve(root, slug, "specification").next, "author-plan");
  const created = createPlan(root, { slug, title: "Public catalog architecture" });
  assert.deepEqual(created.files, [`specs/${slug}/plan.md`]);
  assert.throws(() => approve(root, slug, "plan"), /substantive.*without placeholders/);
  fs.writeFileSync(path.join(root, `specs/${slug}/plan.md`),
    "# Catalog design\n\nImplement [the behavior](spec.md), specifically UC-001, with an anonymous local catalog search. Keep member administration excluded. Validate public access with an automated request test.\n");
  assert.equal(approve(root, slug, "plan").next, "author-tasks");
  fs.writeFileSync(path.join(root, `specs/${slug}/tasks.md`),
    "# Catalog tasks\n\nFollow [the specification](spec.md) and [the technical plan](plan.md).\n\n- [ ] T1: Implement the anonymous UC-001 search handler; no prerequisites.\n- [ ] T2: Test anonymous UC-001 access and no-results behavior; depends on T1.\n");
  const ready = approve(root, slug, "tasks");
  assert.equal(ready.status, "ready-for-implementation");
  assert.equal(ready.implementation_verified, false);
  const history = path.join(root, `specs/${slug}/reviews`);
  assert.equal(fs.readdirSync(history).length, 3);
  const snapshots = fs.readdirSync(history).map((name) => fs.readFileSync(path.join(history, name), "utf8"));
  assert.ok(snapshots.some((content) => content.includes("Display the title and author")));
  fs.appendFileSync(path.join(root, `specs/${slug}/plan.md`), "\nChange the storage decision after review.\n");
  assert.equal(featureStatus(root, slug).reviews.plan.approved, false);
  assert.equal(featureStatus(root, slug).reviews.tasks.approved, false);
  assert.equal(featureStatus(root, slug).reviews.specification.approved, true);
  assert.deepEqual(fs.readdirSync(history).map((name) => fs.readFileSync(path.join(history, name), "utf8")), snapshots);
  const index = fs.readFileSync(path.join(root, "specs/README.md"), "utf8");
  assert.match(index, /public-catalog\/spec\.md/);
  assert.match(index, /NOT verified or delivered/);
});

test("canonical approvals bind cases and decisions, and remain normative when source code drifts", (t) => {
  const { root, slug, file } = fixture(t);
  resolve(root, slug);
  approve(root, slug, "specification");
  const approved = listBrownfieldSpecs(root).filter((entry) => entry.kind === "canonical-functional");
  assert.equal(approved.length, 1);
  const context = prepareApprovedSpecContext(root, { approved_specs: approved });
  assert.match(context.content, /Find a book without registering/);
  assert.match(context.content, /Display the title and author/);
  fs.appendFileSync(path.join(root, file), "\nNew source information requiring review.\n");
  assert.equal(featureStatus(root, slug).next, "synchronize-and-review-source-drift");
  assert.equal(listBrownfieldSpecs(root).filter((entry) => entry.kind === "canonical-functional").length, 1);
  assert.match(prepareApprovedSpecContext(root, { approved_specs: approved }).content, /Source drift: drifted/);
  assert.equal(checkSpecDrift(root).drifted, 1);
  fs.appendFileSync(path.join(root, `specs/${slug}/UC-001.md`), "\nOwner changes after review.\n");
  assert.throws(() => prepareApprovedSpecContext(root, { approved_specs: approved }), /approval changed/);
});

test("missing canonical approval blocks planning and execution before SDK construction", async (t) => {
  const { root, slug } = fixture(t);
  let started = false;
  for (const stage of ["plan", "tasks", "implementation"]) {
    await assert.rejects(runCopilotTask(root, "Execute the requested phase", {
      workflow: { id: "refine-backlog" }, agent: { id: "product" },
      specification_workspace: { requested_stage: stage, features: [{ id: slug }] },
    }, { approved: true, clientFactory: () => { started = true; } }), /Specification phase blocked/);
  }
  assert.equal(started, false);
  assert.throws(() => createPlan(root, { slug, title: "An unauthorized plan" }), /Approve the functional specification/);
  syncProject(root);
  const authored = routeTask(root, "Haz el greenfield con la documentación, sin implementar");
  assert.equal(authored.specification_workspace.requested_stage, "specification");
  assert.deepEqual(authored.knowledge.map((item) => item.source_path), ["knowledge/sources/business/library.md"]);
});

test("navigation preserves owner edits and manual drafts stay visibly unvalidated", (t) => {
  const { root } = fixture(t);
  const index = path.join(root, "specs/README.md");
  fs.appendFileSync(index, "\nOwner-maintained links.\n");
  assert.equal(refreshWorkspaceIndex(root).status, "updated-preserving-owner-readme");
  assert.match(fs.readFileSync(index, "utf8"), /Owner-maintained links/);
  assert.match(fs.readFileSync(path.join(root, "specs/MCPEE.md"), "utf8"), /public-catalog/);
  createPlan(root, { slug: "manual-feature", title: "Manual draft without authoring" });
  const manual = listFeatures(root).find((feature) => feature.id === "manual-feature");
  assert.equal(manual.status, "unvalidated-manual-draft");
  assert.equal(manual.reviews.specification.approved, false);
});

test("owner edits to the decision register are never overwritten by automatic resolution", (t) => {
  const { root, slug } = fixture(t);
  const file = path.join(root, `specs/${slug}/decisions.md`);
  fs.appendFileSync(file, "\nAn owner-added constraint must be preserved.\n");
  assert.throws(() => resolve(root, slug), /owner edits/);
  assert.match(fs.readFileSync(file, "utf8"), /owner-added constraint/);
  assert.equal(featureStatus(root, slug).pending_decisions, 1);
});

test("manual imports cannot bypass phase approval or start a model", async (t) => {
  const { root } = fixture(t);
  let started = false;
  await assert.rejects(runCopilotTask(root, "Implement the imported draft", {
    workflow: { id: "refine-backlog" }, agent: { id: "product" },
    specification_workspace: { requested_stage: "implementation", features: [{ id: "manual", status: "unvalidated-manual-draft" }] },
  }, { approved: true, clientFactory: () => { started = true; } }), /unvalidated manual draft/);
  assert.equal(started, false);
});

test("migration copies atomic drafts with working links, preserves originals and never transfers approval", (t) => {
  const { root, slug, result } = fixture(t);
  const canonical = path.join(root, `specs/${slug}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, result.manifestPath)));
  const old = `docs/specifications/${slug}`;
  fs.mkdirSync(path.join(root, old), { recursive: true });
  const originalIndex = `# Existing atomic draft\n\n[UC-001](${slug}/UC-001.md)\n`;
  fs.writeFileSync(path.join(root, `${old}.md`), originalIndex);
  const caseContent = `# UC-001\n\n[Source](../../../knowledge/sources/business/library.md#L3)\n[Product index](../${slug}.md)\n`;
  fs.writeFileSync(path.join(root, old, "UC-001.md"), caseContent);
  manifest.index = `${old}.md`;
  manifest.cases[0].path = `${old}/UC-001.md`;
  manifest.cases[0].sha256 = digest(caseContent);
  fs.writeFileSync(path.join(root, old, "manifest.json"), JSON.stringify(manifest));
  for (const name of ["spec.md", "UC-001.md", "manifest.json", "decisions.json", "decisions.md", "lifecycle.json"]) {
    fs.unlinkSync(path.join(canonical, name));
  }
  fs.rmdirSync(canonical);
  fs.writeFileSync(path.join(root, "docs/specifications/manual-draft.md"), "# Existing manual specification\n\nPreserve this human draft without claiming it is approved.\n");
  const migration = migrateDrafts(root);
  assert.ok(migration.some((item) => item.status === "copied-draft-not-approved"));
  assert.ok(migration.some((item) => item.status === "copied-unvalidated-manual-draft"));
  assert.equal(fs.readFileSync(path.join(root, `${old}.md`), "utf8"), originalIndex);
  assert.equal(fs.readFileSync(path.join(root, old, "UC-001.md"), "utf8"), caseContent);
  assert.equal(featureStatus(root, slug).reviews.specification.approved, false);
  for (const file of ["spec.md", "UC-001.md"]) {
    const markdown = fs.readFileSync(path.join(canonical, file), "utf8");
    for (const match of markdown.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      assert.ok(fs.existsSync(path.resolve(canonical, decodeURIComponent(match[1]))), match[1]);
    }
  }
  assert.ok(migrateDrafts(root).every((item) => item.status === "preserved-existing-destination"));
});

test("CLI exposes one entry point and explicit phase digests without a model run", (t) => {
  const { root, slug } = fixture(t);
  const cli = path.join(__dirname, "../packages/cli/bin/mcpee.js");
  const status = JSON.parse(execFileSync(process.execPath, [cli, "specs", "status", "--slug", slug, "--json", "--project", root], { encoding: "utf8" }));
  assert.equal(status.next, "clarify");
  assert.match(status.reviews.specification.sha256, /^[a-f0-9]{64}$/);
});
