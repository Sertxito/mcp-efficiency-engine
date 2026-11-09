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
const { featureStatus, currentDigest, approveStage, approveSpecifications, reviewSpecification, readFeature, migrateDrafts, migrateReviewHistory } = require("../packages/spec-engine/src/lifecycle");
const { publishPhase, validatePhase } = require("../packages/spec-engine/src/phases");
const { listBrownfieldSpecs, prepareApprovedSpecContext } = require("../packages/spec-engine/src/brownfield");
const { analyzeImpacts } = require("../packages/knowledge-engine/src/unified");
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
  const { syncProject } = require("../packages/source-engine/src/sync");
  const discovery = syncProject(root, { generateDocumentation: false, tools: [], graphify: { installed: false } });
  const unrelatedEvidencePath = path.join(root, discovery.specifications.proposals[0].evidencePath);
  const unrelatedEvidence = JSON.parse(fs.readFileSync(unrelatedEvidencePath, "utf8"));
  unrelatedEvidence.proposal_sha256 = "0".repeat(64);
  fs.writeFileSync(unrelatedEvidencePath, JSON.stringify(unrelatedEvidence));
  const unrelatedBefore = fs.readFileSync(unrelatedEvidencePath);
  assert.equal(published.path, "docs/specifications/proposed/about-us/spec.md");
  assert.equal(featureStatus(root, slug).authoritative, false);
  assert.equal(listBrownfieldSpecs(root).find(item => item.slug === slug).status, "proposed");
  const reviewed = reviewSpecification(root, { slug, reviewer: "Reviewer", confirmSha256: currentDigest(root, slug, "specification") });
  assert.equal(reviewed.document_state, "reviewed");
  assert.equal(reviewed.authoritative, false);
  const indexedPaths = () => JSON.parse(fs.readFileSync(path.join(root, ".mcpee/indexes/source-inventory.json"), "utf8"))
    .sources.map(source => source.path);
  assert.ok(indexedPaths().includes(`docs/specifications/reviewed/${slug}/spec.md`));
  assert.ok(!indexedPaths().includes(published.path));
  assert.equal(fs.existsSync(path.join(root, published.path)), false);
  const approved = approve(root, slug);
  assert.equal(approved.document_state, "approved");
  assert.equal(approved.authoritative, true);
  assert.equal(approved.authority_basis, "explicit-approval");
  const graph = JSON.parse(fs.readFileSync(path.join(root, ".mcpee/graphs/unified/graph.json"), "utf8"));
  const approvedCase = readFeature(root, slug).manifest.cases[0];
  assert.ok(graph.nodes.some(node => node.type === "source" && node.source_path === approvedCase.path));
  assert.ok(!graph.nodes.some(node => node.type === "source" &&
    node.source_path === `docs/specifications/reviewed/${slug}/${path.posix.basename(approvedCase.path)}`));
  assert.equal(analyzeImpacts(root, [approvedCase.path]).status, "ready");
  assert.ok(indexedPaths().includes(approved.path));
  assert.ok(!indexedPaths().some(file => file.startsWith(`docs/specifications/reviewed/${slug}/`)));
  assert.ok(fs.readFileSync(unrelatedEvidencePath).equals(unrelatedBefore));
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

test("automatic validation records proposed and reviewed; explicit batch approval is required before tasks", t => {
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
  const tasks = {
    title: "Deliver public staff profiles", specification_sha256: currentDigest(root, slug, "specification"),
    plan_sha256: currentDigest(root, slug, "plan"),
    tasks: [{ id: "TASK-001", description: "Implement and validate public staff profiles.", use_cases: ["UC-001"],
      paths: ["src/staff.js"], depends_on: [], checks: ["CHECK-001"] }], open_questions: [],
  };
  assert.equal(featureStatus(root, slug).next, "approve-specification");
  assert.throws(() => validatePhase(root, slug, "tasks", JSON.stringify(tasks)), /Explicit specification approval/);
  const digest = currentDigest(root, slug, "specification");
  assert.throws(() => approveSpecifications(root, { specifications: [{ slug, sha256: "0".repeat(64) }],
    reviewer: "Product owner", reason: "Approve the current specifications." }), /no batch approval was started/);
  assert.equal(featureStatus(root, slug).authoritative, false);
  const result = approveSpecifications(root, { specifications: [{ slug, sha256: digest }],
    reviewer: "Product owner", reason: "Approve the current specifications." });
  const approved = featureStatus(root, slug);
  assert.equal(approved.authoritative, true);
  assert.equal(result.status, "completed");
  assert.deepEqual(approved.transitions.map(item => item.to), ["proposed", "reviewed", "approved"]);
  assert.equal(approved.document_approval.instruction_report, result.report);
  assert.equal(readFeature(root, slug).lifecycle.approval_history[0].validation_source, "mcpee-automatic");
  tasks.specification_sha256 = approved.reviews.specification.sha256;
  tasks.plan_sha256 = approved.reviews.plan.sha256;
  publishPhase(root, slug, "tasks", JSON.stringify(tasks));
  assert.equal(featureStatus(root, slug).reviews.tasks.approved, true);
  const { directory } = readFeature(root, slug);
  const plan = JSON.parse(fs.readFileSync(path.join(root, directory, "plan.json"), "utf8"));
  assert.equal(plan.specification_sha256, approved.reviews.specification.sha256);
  assert.match(fs.readFileSync(path.join(root, directory, "plan.md"), "utf8"), /\[UC-001\]\(about-us-staff.md\)/);
});

test("batch approval preflights all digests and refuses to relocate an active run", t => {
  const { root, slug, document, sources } = fixture(t, true);
  const second = { ...document, slug: "other-staff" };
  publishFunctionalSpec(root, JSON.stringify(second), sources, { automatic: true });
  const specifications = [{ slug, sha256: currentDigest(root, slug, "specification") }];
  const input = { specifications, reviewer: "Product owner", reason: "Approve this batch." };
  assert.throws(() => approveSpecifications(root, { ...input,
    specifications: [...specifications, { slug: second.slug, sha256: "0".repeat(64) }] }), /no batch approval was started/);
  assert.equal(featureStatus(root, slug).authoritative, false);
  assert.throws(() => approveSpecifications(root, { ...input, specifications: [...specifications, ...specifications] }), /unique list/);
  assert.throws(() => approveSpecifications(root, { ...input, reason: "" }), /explicit user approval instruction/);
  const runs = path.join(root, ".mcpee/state/runs");
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, "active.json"), JSON.stringify({ run_id: "active-fixture", status: "running", owner_pid: process.pid }));
  assert.throws(() => approveSpecifications(root, input), /during active run active-fixture/);
  assert.equal(featureStatus(root, slug).document_state, "reviewed");
  assert.equal(fs.existsSync(path.join(runs, "admission.lock")), false);
  fs.unlinkSync(path.join(runs, "active.json"));
  const lock = path.join(runs, "admission.lock");
  fs.writeFileSync(lock, "{}");
  assert.throws(() => approveSpecifications(root, input), /run admission is busy/);
  assert.equal(fs.existsSync(lock), true);
  fs.unlinkSync(lock);
  const result = JSON.parse(execFileSync(process.execPath, [
    path.resolve(__dirname, "../packages/cli/bin/mcpee.js"), "specs", "approve", "--all-current",
    "--reviewer", input.reviewer, "--reason", input.reason, "--project", root, "--json",
  ], { encoding: "utf8" }));
  assert.equal(result.results.length, 2);
  assert.equal(featureStatus(root, slug).specification_approved, true);
  assert.equal(featureStatus(root, second.slug).specification_approved, true);
  assert.equal(fs.existsSync(lock), false);
});

test("MCP approval records an explicit user order without a model or per-proposal elicitation", async t => {
  const { root, slug } = fixture(t, true);
  const { createMcpServer } = require("../packages/mcp-server/src/server");
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
  const server = createMcpServer({ projectRoot: root, packageRoot: path.resolve(__dirname, ".."),
    spawnProcess: () => { assert.fail("Specification approval must not start a model process."); } });
  const client = new Client({ name: "approval-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const status = await client.callTool({ name: "mcpee_specs_status", arguments: {} });
  const features = JSON.parse(status.content[0].text);
  assert.equal(features[0].specification_approved, false);
  const input = { specifications: [{ slug, sha256: features[0].reviews.specification.sha256 }],
    reviewer: "Product owner", reason: "Approve the current specs." };
  const stale = await client.callTool({ name: "mcpee_specs_approve", arguments: {
    ...input, specifications: [{ slug, sha256: "0".repeat(64) }],
  } });
  assert.equal(stale.isError, true);
  const approval = await client.callTool({ name: "mcpee_specs_approve", arguments: input });
  assert.ok(!approval.isError);
  assert.equal(JSON.parse(approval.content[0].text).status, "completed");
  assert.equal(featureStatus(root, slug).document_state, "approved");
});

test("a failed approval relocation retains prior validation and does not grant authority", t => {
  const { root, slug } = fixture(t, true);
  const lifecycle = readFeature(root, slug).lifecycle;
  fs.mkdirSync(path.join(root, "docs/specifications/approved", slug));
  assert.throws(() => approve(root, slug), /destination already exists/);
  assert.deepEqual(readFeature(root, slug).lifecycle, lifecycle);
  assert.equal(featureStatus(root, slug).specification_approved, false);
});

test("legacy reviews rename to history without changing snapshot bytes or phase digests", t => {
  const { root, slug } = fixture(t, true);
  approve(root, slug);
  const { directory, lifecycle } = readFeature(root, slug);
  const history = path.join(root, directory, "history");
  const reviews = path.join(root, directory, "reviews");
  fs.renameSync(history, reviews);
  for (const approval of [...Object.values(lifecycle.approvals), ...(lifecycle.approval_history || [])]) {
    approval.snapshot = approval.snapshot.replace("/history/", "/reviews/");
  }
  lifecycle.approval_history[0].snapshot = lifecycle.approval_history[0].snapshot.replace("/approved/", "/reviewed/");
  fs.writeFileSync(path.join(root, directory, "lifecycle.json"), JSON.stringify(lifecycle));
  const before = featureStatus(root, slug);
  const evidence = fs.readdirSync(reviews).map(name => [name, hash(fs.readFileSync(path.join(reviews, name)))]);
  const result = migrateReviewHistory(root, slug);
  assert.equal(result.status, "renamed-preserving-evidence");
  assert.equal(fs.existsSync(reviews), false);
  assert.deepEqual(fs.readdirSync(history).map(name => [name, hash(fs.readFileSync(path.join(history, name)))]), evidence);
  const after = featureStatus(root, slug);
  assert.deepEqual(after.reviews, before.reviews);
  assert.equal(after.specification_approved, true);
  for (const approval of [...Object.values(readFeature(root, slug).lifecycle.approvals),
    ...readFeature(root, slug).lifecycle.approval_history]) {
    assert.ok(approval.snapshot.includes("/history/"));
    assert.ok(fs.existsSync(path.join(root, approval.snapshot)));
  }
  assert.equal(migrateReviewHistory(root, slug).status, "unchanged");
  const stale = readFeature(root, slug).lifecycle;
  stale.approval_history[0].snapshot = stale.approval_history[0].snapshot.replace("/approved/", "/reviewed/");
  fs.writeFileSync(path.join(root, directory, "lifecycle.json"), JSON.stringify(stale));
  assert.equal(migrateReviewHistory(root, slug).status, "repaired-history-references");
  assert.ok(fs.existsSync(path.join(root, readFeature(root, slug).lifecycle.approval_history[0].snapshot)));
  assert.equal(migrateReviewHistory(root, slug).status, "unchanged");
});

test("history migration conflicts and write failures preserve existing review evidence", t => {
  const { root, slug } = fixture(t, true);
  const { directory, lifecycle } = readFeature(root, slug);
  const history = path.join(root, directory, "history");
  const reviews = path.join(root, directory, "reviews");
  fs.renameSync(history, reviews);
  fs.mkdirSync(history);
  assert.throws(() => migrateReviewHistory(root, slug), /conflicts/);
  assert.ok(fs.existsSync(reviews));
  fs.rmdirSync(history);
  const rename = fs.renameSync;
  let failed = false;
  const mock = t.mock.method(fs, "renameSync", (from, to) => {
    if (!failed && to === path.join(root, directory, "lifecycle.json")) {
      failed = true;
      throw new Error("Injected history state write failure");
    }
    return rename(from, to);
  });
  try {
    assert.throws(() => migrateReviewHistory(root, slug), /Injected history state write failure/);
  } finally {
    mock.mock.restore();
  }
  assert.ok(fs.existsSync(reviews));
  assert.equal(fs.existsSync(history), false);
  assert.deepEqual(readFeature(root, slug).lifecycle, lifecycle);
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
