"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { initializeProject } = require("../packages/core/src/project");
const { prepareFunctionalSources, publishFunctionalSpec } = require("../packages/spec-engine/src/functional");
const { featureStatus, currentDigest, approveStage, reviewSpecification, readFeature, migrateDrafts } = require("../packages/spec-engine/src/lifecycle");
const { publishPhase } = require("../packages/spec-engine/src/phases");
const { listBrownfieldSpecs, prepareApprovedSpecContext } = require("../packages/spec-engine/src/brownfield");
const { relocateFeature, relocateDocuments } = require("../packages/spec-engine/src/relocation");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

function fixture(t, automatic = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-docs-lifecycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  const source = "knowledge/sources/business/about.md";
  fs.writeFileSync(path.join(root, source), "# Staff\nVisitors can read staff profiles.\n");
  const document = {
    language: "en", title: "About the organization", slug: "about-us",
    summary: "Visitors discover the staff of the organization.",
    scope: ["Display the public staff profiles."], non_goals: ["Editing private staff records is not included."],
    actors: [{ id: "ACT-001", name: "Visitor", goal: "Discover the people in the organization." }],
    use_cases: [{
      id: "UC-001", slug: "about-us-staff", title: "Browse the public staff profiles",
      actor: "ACT-001", goal: "Read the published profiles of the staff.", basis: "documented",
      dependencies: [], open_questions: [], trigger: "The visitor opens the staff page.",
      preconditions: ["Staff profiles have been published."],
      main_flow: ["The visitor opens the staff page.", "The page displays published staff profiles."],
      alternatives: ["No staff profiles produces an explicit empty state."],
      postconditions: ["The visitor sees the published staff information."],
      rules: ["Only public staff profiles are displayed."],
      acceptance_criteria: [{ given: "Staff profiles have been published.", when: "The visitor opens the page.", then: "Published staff profiles are displayed." }],
      evidence: [{ path: source, line: 2, quote: "Visitors can read staff profiles." }],
    }],
    open_questions: [], coverage: [{ path: source, line: 1, status: "covered", use_cases: ["UC-001"], reason: "The staff profile capability implements this source requirement." }],
  };
  const sources = prepareFunctionalSources(root, [source]);
  const published = publishFunctionalSpec(root, JSON.stringify(document), sources, { automatic });
  return { root, document, sources, published, slug: document.slug };
}

function approve(root, slug, stage = "specification") {
  return approveStage(root, { slug, stage, reviewer: "Product owner", confirmSha256: currentDigest(root, slug, stage) });
}

test("docs is the entry point; proposals move to reviewed without becoming authoritative, then explicit approval moves them to approved", t => {
  const { root, slug, published } = fixture(t);
  assert.equal(published.path, "docs/specifications/proposed/about-us/spec.md");
  assert.equal(featureStatus(root, slug).authoritative, false);
  assert.equal(listBrownfieldSpecs(root).find(item => item.slug === slug).status, "proposed");
  const reviewed = reviewSpecification(root, { slug, reviewer: "Reviewer", confirmSha256: currentDigest(root, slug, "specification") });
  assert.equal(reviewed.document_state, "reviewed");
  assert.equal(reviewed.authoritative, false);
  assert.equal(fs.existsSync(path.join(root, published.path)), false);
  const approved = approve(root, slug);
  assert.equal(approved.document_state, "approved");
  assert.equal(approved.authoritative, true);
  assert.equal(approved.authority_basis, "explicit-approval");
  const spec = listBrownfieldSpecs(root).find(item => item.slug === slug);
  assert.match(prepareApprovedSpecContext(root, { approved_specs: [spec] }).content, /published profiles/);
  const entry = fs.readFileSync(path.join(root, "docs/README.md"), "utf8");
  assert.match(entry, /specifications\/README.md/);
  const index = fs.readFileSync(path.join(root, "docs/specifications/README.md"), "utf8");
  assert.match(index, /approved\/about-us\/about-us-staff.md/);
  for (const file of [approved.path, "docs/specifications/approved/about-us/about-us-staff.md"]) {
    const markdown = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of markdown.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), decodeURIComponent(match[1]))), match[1]);
    }
  }
});

test("automatic structural phase validation never grants documentary authority; late explicit approval preserves downstream phase bindings", t => {
  const { root, slug } = fixture(t, true);
  assert.equal(featureStatus(root, slug).document_state, "reviewed");
  assert.equal(featureStatus(root, slug).authoritative, false);
  assert.equal(listBrownfieldSpecs(root).find(item => item.slug === slug).status, "reviewed");
  publishPhase(root, slug, "plan", JSON.stringify({
    title: "Staff profile presentation", specification_sha256: currentDigest(root, slug, "specification"),
    design: [{ id: "DESIGN-001", description: "Expose public staff information in the application.", use_cases: ["UC-001"], paths: ["src/staff.js"] }],
    checks: [{ id: "CHECK-001", command: "node --test tests/staff.test.js", expected: "Only published staff profiles are displayed." }],
    risks: [], open_questions: [],
  }));
  publishPhase(root, slug, "tasks", JSON.stringify({
    title: "Deliver public staff profiles", specification_sha256: currentDigest(root, slug, "specification"),
    plan_sha256: currentDigest(root, slug, "plan"),
    tasks: [{ id: "TASK-001", description: "Implement and validate public staff profiles.", use_cases: ["UC-001"],
      paths: ["src/staff.js"], depends_on: [], checks: ["CHECK-001"] }], open_questions: [],
  }));
  const approved = approve(root, slug);
  assert.equal(approved.authoritative, true);
  assert.equal(approved.reviews.tasks.approved, true);
  const { directory } = readFeature(root, slug);
  const plan = JSON.parse(fs.readFileSync(path.join(root, directory, "plan.json"), "utf8"));
  assert.equal(plan.specification_sha256, approved.reviews.specification.sha256);
  assert.match(fs.readFileSync(path.join(root, directory, "plan.md"), "utf8"), /\[UC-001\]\(about-us-staff.md\)/);
});

test("current-workspace migration is idempotent and edited cases invalidate authority", t => {
  const { root, slug } = fixture(t, true);
  const status = featureStatus(root, slug);
  const directory = readFeature(root, slug).directory;
  assert.equal(status.authoritative, false);
  assert.throws(() => relocateFeature(root, slug, "approved"), /Only explicit/);
  assert.equal(featureStatus(root, slug).document_state, "reviewed");
  assert.deepEqual(migrateDrafts(root), []);
  assert.equal(fs.existsSync(path.join(root, directory, "spec.md")), true);
  const caseFile = path.join(root, directory, "about-us-staff.md");
  fs.appendFileSync(caseFile, "\nOwner clarification.\n");
  const stale = featureStatus(root, slug);
  assert.equal(stale.reviews.specification.approved, false);
  assert.equal(stale.authoritative, false);
});

test("legacy root workspaces migrate with exact review snapshots and human versus machine authority preserved", t => {
  for (const explicit of [false, true]) {
    const { root, slug } = fixture(t, true);
    if (explicit) approve(root, slug);
    const old = `specs/${slug}`;
    relocateDocuments(root, readFeature(root, slug).directory, old, { rewriteJson: true });
    const manifestFile = path.join(root, old, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.index_sha256 = hash(fs.readFileSync(path.join(root, manifest.index)));
    for (const item of manifest.cases) item.sha256 = hash(fs.readFileSync(path.join(root, item.path)));
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    const lifecycleFile = path.join(root, old, "lifecycle.json");
    const lifecycle = JSON.parse(fs.readFileSync(lifecycleFile, "utf8"));
    lifecycle.approvals.specification.sha256 = currentDigest(root, slug, "specification");
    fs.writeFileSync(lifecycleFile, JSON.stringify(lifecycle, null, 2) + "\n");
    const snapshotFile = lifecycle.approvals.specification.snapshot;
    const snapshot = fs.readFileSync(path.join(root, snapshotFile));
    const result = migrateDrafts(root);
    assert.ok(result.some(item => item.status === "moved-preserving-review-evidence"));
    const status = featureStatus(root, slug);
    assert.equal(status.authoritative, explicit);
    assert.equal(status.document_state, explicit ? "approved" : "reviewed");
    assert.equal(status.reviews.specification.approved, true);
    assert.equal(fs.existsSync(path.join(root, old)), false);
    const movedLifecycle = readFeature(root, slug).lifecycle;
    assert.deepEqual(fs.readFileSync(path.join(root, movedLifecycle.approvals.specification.snapshot)), snapshot);
    const report = JSON.parse(fs.readFileSync(path.join(root, movedLifecycle.approvals.specification.relocation), "utf8"));
    assert.equal(report.authority_granted, false);
    assert.equal(report.authority_preserved, explicit);
    assert.deepEqual(migrateDrafts(root), []);
  }
});

test("manual drafts move with working source links; conflicts preserve both originals", t => {
  const { root } = fixture(t);
  fs.mkdirSync(path.join(root, "specs/manual-note"), { recursive: true });
  fs.writeFileSync(path.join(root, "specs/manual-note/spec.md"),
    "# Manual staff note\n\n[Requirements](../../knowledge/sources/business/about.md)\n");
  fs.writeFileSync(path.join(root, "specs/manual-note/notes.json"), "owner draft, not yet valid JSON\n");
  migrateDrafts(root);
  const draft = "docs/specifications/proposed/manual-note/spec.md";
  assert.match(fs.readFileSync(path.join(root, draft), "utf8"), /(?:\.\.\/){4}knowledge\/sources/);
  assert.equal(fs.existsSync(path.join(root, "specs/manual-note")), false);
  assert.equal(fs.readFileSync(path.join(root, "docs/specifications/proposed/manual-note/notes.json"), "utf8"), "owner draft, not yet valid JSON\n");
  fs.mkdirSync(path.join(root, "specs/conflict"), { recursive: true });
  fs.writeFileSync(path.join(root, "specs/conflict/spec.md"), "# Original\n");
  fs.mkdirSync(path.join(root, "docs/specifications/proposed/conflict"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/specifications/proposed/conflict/spec.md"), "# Owner version\n");
  assert.throws(() => migrateDrafts(root), /multiple states/);
  assert.equal(fs.readFileSync(path.join(root, "specs/conflict/spec.md"), "utf8"), "# Original\n");
  assert.equal(fs.readFileSync(path.join(root, "docs/specifications/proposed/conflict/spec.md"), "utf8"), "# Owner version\n");
});

test("failed relocation removes partial output and can be retried without losing the source", t => {
  const { root, slug, published } = fixture(t);
  const original = fs.readFileSync(path.join(root, published.path));
  const write = fs.writeFileSync;
  fs.writeFileSync = function (filename, ...args) {
    if (String(filename).replaceAll("\\", "/").endsWith("/reviewed/about-us/lifecycle.json")) {
      throw new Error("Injected relocation failure");
    }
    return write.call(this, filename, ...args);
  };
  try {
    assert.throws(() => relocateFeature(root, slug, "reviewed"), /Injected relocation failure/);
  } finally {
    fs.writeFileSync = write;
  }
  assert.deepEqual(fs.readFileSync(path.join(root, published.path)), original);
  assert.equal(fs.existsSync(path.join(root, "docs/specifications/reviewed/about-us")), false);
  assert.equal(relocateFeature(root, slug, "reviewed").document_state, "reviewed");
});

test("historical inventories and indexes move out of engine state with current references rebased", t => {
  const { root } = fixture(t);
  fs.mkdirSync(path.join(root, ".mcpee/specs/proposed"), { recursive: true });
  fs.mkdirSync(path.join(root, ".mcpee/specs/reviews/old"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mcpee/specs/proposed/old.md"),
    "# Historical inventory\n\n[Source](../../../knowledge/sources/business/about.md)\n[Review](../reviews/old/index.md)\n");
  fs.writeFileSync(path.join(root, ".mcpee/specs/reviews/old/index.md"), "# Review\n\n[Inventory](../../proposed/old.md)\n");
  const result = migrateDrafts(root);
  assert.equal(result.filter(item => item.status === "moved-preserving-evidence").length, 2);
  const proposal = "docs/generated/specification-evidence/old.md";
  assert.match(fs.readFileSync(path.join(root, proposal), "utf8"), /\[Review\]\(reviews\/old\/index.md\)/);
  const index = fs.readFileSync(path.join(root, "docs/generated/specification-evidence/reviews/old/index.md"), "utf8");
  assert.match(index, /\[Inventory\]\(\.\.\/\.\.\/old.md\)/);
  assert.equal(fs.existsSync(path.join(root, ".mcpee/specs/proposed")), false);
  assert.equal(fs.existsSync(path.join(root, ".mcpee/specs/reviews")), false);
});

test("owner documentation entry points are preserved and conflicting fallback edits are reported", t => {
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, "docs/README.md"), "# Owner's project guide\n");
  migrateDrafts(root);
  assert.equal(fs.readFileSync(path.join(root, "docs/README.md"), "utf8"), "# Owner's project guide\n");
  assert.match(fs.readFileSync(path.join(root, "docs/MCPEE.md"), "utf8"), /specifications\/README.md/);
  fs.writeFileSync(path.join(root, "docs/MCPEE.md"), "# Owner's second guide\n");
  assert.throws(() => migrateDrafts(root), /both contain owner edits/);
  assert.equal(fs.readFileSync(path.join(root, "docs/MCPEE.md"), "utf8"), "# Owner's second guide\n");
});

test("the CLI separates exact-digest review from authoritative approval and returns the moved paths", t => {
  const { root, slug } = fixture(t);
  const cli = path.resolve(__dirname, "../packages/cli/bin/mcpee.js");
  const invoke = (action, digest) => JSON.parse(execFileSync(process.execPath, [
    cli, "specs", action, "--project", root, "--slug", slug, "--reviewer", "Product owner",
    "--confirm-sha256", digest, "--json",
  ], { encoding: "utf8" }));
  const reviewed = invoke("review", currentDigest(root, slug, "specification"));
  assert.equal(reviewed.document_state, "reviewed");
  assert.equal(reviewed.authoritative, false);
  assert.equal(reviewed.reviews.specification.approved, false);
  const approved = invoke("approve", reviewed.reviews.specification.sha256);
  assert.equal(approved.document_state, "approved");
  assert.equal(approved.authoritative, true);
  assert.match(approved.path, /^docs\/specifications\/approved\/about-us\//);
});

test("migration rejects owner-owned extraction state before moving or rewriting anything", t => {
  const { root } = fixture(t);
  fs.mkdirSync(path.join(root, ".mcpee/specs/proposed"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mcpee/specs/proposed/owner.md"), "# Existing draft\n");
  fs.writeFileSync(path.join(root, ".mcpee/specs/latest.json"), '{"note":"user-owned"}');
  assert.throws(() => migrateDrafts(root), /user-owned review state/);
  assert.equal(fs.readFileSync(path.join(root, ".mcpee/specs/latest.json"), "utf8"), '{"note":"user-owned"}');
  assert.equal(fs.readFileSync(path.join(root, ".mcpee/specs/proposed/owner.md"), "utf8"), "# Existing draft\n");
});
