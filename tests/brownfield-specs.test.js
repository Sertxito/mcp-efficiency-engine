"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, test } = require("node:test");
const {
  checkSpecDrift,
  discoverBrownfieldSpec,
  listBrownfieldSpecs,
  ratifyBrownfieldSpec,
  prepareApprovedSpecContext,
} = require("../packages/spec-engine/src/brownfield");
const { partitionDomains, renderCasePages, renderObservationPages } = require("../packages/spec-engine/src/domains");
const { initializeProject } = require("../packages/core/src/project");
const { collectContextFiles, runCopilotTask } = require("../packages/execution-engine/src/copilot");
const { buildUnifiedGraph } = require("../packages/knowledge-engine/src/unified");

const roots = [];

function makeProject(sourceText = "export function calculateTotal() {}\n") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-brownfield-spec-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "knowledge", "traceability"), { recursive: true });
  fs.mkdirSync(path.join(root, "knowledge", "extracted"), { recursive: true });
  const sourcePath = "src/billing.js";
  const sourceFile = path.join(root, sourcePath);
  fs.writeFileSync(sourceFile, sourceText);
  const sourceHash = crypto.createHash("sha256").update(sourceText).digest("hex");
  const extractedPath = "knowledge/extracted/billing.json";
  const testPath = "tests/billing.test.js";
  const testText = 'test("rejects an invoice without a customer", () => {});\n';
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, testPath), testText);
  const testExtractedPath = "knowledge/extracted/billing-tests.json";
  const testHash = crypto.createHash("sha256").update(testText).digest("hex");
  fs.writeFileSync(path.join(root, testExtractedPath), JSON.stringify({
    generated_by: "mcpee",
    source_path: testPath,
    sha256: testHash,
    lines: 1,
    headings: [],
    symbol_locations: [],
  }));
  const extracted = {
    generated_by: "mcpee",
    source_path: sourcePath,
    sha256: sourceHash,
    lines: sourceText.trimEnd().split("\n").length,
    headings: [{ title: "Billing contract", line: 1 }],
    symbol_locations: [{ name: "calculateTotal", line: 1 }],
  };
  fs.writeFileSync(path.join(root, extractedPath), JSON.stringify(extracted));
  fs.writeFileSync(path.join(root, "knowledge", "traceability", "source-manifest.json"), JSON.stringify({
    generated_by: "mcpee",
    sources: [
      {
        path: sourcePath,
        sha256: sourceHash,
        category: "source-code",
        status: "processed",
        extracted_path: extractedPath,
      },
      {
        path: testPath,
        sha256: testHash,
        category: "tests",
        status: "processed",
        extracted_path: testExtractedPath,
      },
    ],
  }));
  return { root, sourcePath, sourceFile, sourceText };
}

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test("brownfield discovery creates an evidence-linked proposal without asserting requirements", () => {
  const { root } = makeProject();
  const result = discoverBrownfieldSpec(root);
  const proposal = fs.readFileSync(path.join(root, result.specPath), "utf8");
  const evidence = JSON.parse(fs.readFileSync(path.join(root, result.evidencePath), "utf8"));

  assert.equal(result.status, "created");
  assert.match(proposal, /not an approved specification/);
  assert.match(proposal, /<!-- Replace this prompt/);
  assert.match(proposal, /src\/billing\.js/);
  assert.match(proposal, /calculateTotal/);
  assert.match(proposal, /rejects an invoice without a customer/);
  assert.equal(evidence.status, "proposed");
  assert.equal(evidence.sources[0].path, "src/billing.js");
  assert.equal(evidence.sources[0].sha256, crypto.createHash("sha256").update("export function calculateTotal() {}\n").digest("hex"));
  assert.deepEqual(evidence.sources[1].test_cases.map((testCase) => testCase.name), [
    "rejects an invoice without a customer",
  ]);
  assert.equal(evidence.sources[1].test_cases[0].execution, "not-verified");

  const repeat = discoverBrownfieldSpec(root);
  assert.equal(repeat.status, "preserved");
  assert.equal(repeat.sha256, result.sha256);
  assert.equal(listBrownfieldSpecs(root).length, 1);
  const latest = JSON.parse(fs.readFileSync(path.join(root, ".mcpee", "specs", "latest.json"), "utf8"));
  assert.equal(latest.coverage.source_relationships.status, "not-available");
});

function addSource(root, sourcePath, text, category = "source-code") {
  const filename = path.join(root, sourcePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, text);
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  const extractedPath = `knowledge/extracted/${crypto.createHash("sha256").update(sourcePath).digest("hex")}.json`;
  fs.writeFileSync(path.join(root, extractedPath), JSON.stringify({
    generated_by: "mcpee", source_path: sourcePath, sha256: hash,
    lines: text.split("\n").length, headings: [], symbol_locations: [],
  }));
  const manifestPath = path.join(root, "knowledge", "traceability", "source-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.sources.push({
    path: sourcePath, sha256: hash, category, status: "processed", extracted_path: extractedPath,
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}

function completeProposal(root, proposal) {
  const filename = path.join(root, proposal.specPath);
  const text = fs.readFileSync(filename, "utf8")
    .replace("<!-- Replace this prompt with behavior confirmed by the accountable owner. -->",
      "Preserve the invoice amount confirmed by the owner.")
    .replace("<!-- Add observable, testable criteria and link each criterion to evidence. -->",
      "Given invoice lines, verify the approved sum and error contract.");
  fs.writeFileSync(filename, text);
  return crypto.createHash("sha256").update(text).digest("hex");
}

function buildFixtureGraph(root) {
  const filename = path.join(root, "knowledge", "traceability", "source-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
  fs.mkdirSync(path.join(root, "knowledge", "normalized"), { recursive: true });
  for (const [index, source] of manifest.sources.entries()) {
    source.normalized_path = `knowledge/normalized/${index}.md`;
    fs.writeFileSync(path.join(root, source.normalized_path), fs.readFileSync(path.join(root, source.path), "utf8"));
    const metadataPath = path.join(root, source.extracted_path);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    metadata.headings = metadata.headings.map((heading) => ({ ...heading, level: 1 }));
    metadata.symbols = metadata.symbol_locations.map((symbol) => symbol.name);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  }
  fs.writeFileSync(filename, JSON.stringify(manifest));
  return buildUnifiedGraph(root);
}

test("cross-domain references bind target drift, render navigable evidence and survive ratification", () => {
  const { root, sourceFile } = makeProject();
  addSource(root, "modules/accounts/account.spec.ts", [
    "import { calculateTotal } from '../../src/billing';",
    "test('uses billing', () => {",
    "  expect(calculateTotal()).toBeDefined();",
    "});",
  ].join("\n"), "tests");
  buildFixtureGraph(root);
  const result = discoverBrownfieldSpec(root);
  const proposal = result.proposals.find((item) => item.domain === "account");
  assert.ok(proposal);
  const evidence = JSON.parse(fs.readFileSync(path.join(root, proposal.evidencePath), "utf8"));
  assert.ok(!evidence.sources.some((source) => source.path === "src/billing.js"));
  const relationship = evidence.sources.flatMap((source) => source.facts).find((fact) => fact.kind === "source-relationship");
  assert.equal(relationship.target, "src/billing.js");
  assert.equal(relationship.relationship, "tests_source");
  const pages = proposal.observationPaths.map((filename) => fs.readFileSync(path.join(root, filename), "utf8"));
  assert.ok(pages.some((text) => /target: \[src\/billing\.js\]/.test(text)));
  const sha256 = completeProposal(root, proposal);
  fs.appendFileSync(sourceFile, "// changed dependency\n");
  assert.throws(() => ratifyBrownfieldSpec(root, { slug: proposal.slug, reviewer: "Fixture", confirmSha256: sha256 }), /source drift/);
  fs.writeFileSync(sourceFile, "export function calculateTotal() {}\n");
  const approved = ratifyBrownfieldSpec(root, { slug: proposal.slug, reviewer: "Fixture", confirmSha256: sha256 });
  assert.ok(approved);
  fs.appendFileSync(sourceFile, "// changed dependency\n");
  const drift = checkSpecDrift(root).specifications.find((spec) => spec.specification_status === "approved");
  assert.ok(drift.changed.includes("src/billing.js"));
  fs.unlinkSync(sourceFile);
  const missing = checkSpecDrift(root).specifications.find((spec) => spec.specification_status === "approved");
  assert.ok(missing.missing.includes("src/billing.js"));
});

test("fake imports inside comments and strings never become dependency evidence", () => {
  const { root } = makeProject();
  addSource(root, "modules/accounts/account.ts", [
    'const example = "require(\'../../src/billing\')";',
    "/* documentation",
    "require('../../src/billing');",
    "*/",
    "const value = 1; // require('../../src/billing');",
    "export const actual = require('../../src/billing');",
  ].join("\n"));
  buildFixtureGraph(root);
  const result = discoverBrownfieldSpec(root);
  const evidence = result.proposals.map((proposal) => JSON.parse(fs.readFileSync(path.join(root, proposal.evidencePath), "utf8")));
  const relationships = evidence.flatMap((item) => item.sources.flatMap((source) => source.facts))
    .filter((fact) => fact.kind === "source-relationship");
  assert.equal(relationships.length, 1);
  assert.equal(relationships[0].line, 6);
  assert.equal(relationships[0].target, "src/billing.js");
});

test("explicitly skipped C#, Python and Pester tests remain distinct from conditional skip declarations", () => {
  const { root } = makeProject();
  addSource(root, "tests/AccountTests.cs", [
    '[Fact(Skip = "requires service")] public void Disabled() { Assert.True(true); }',
    '[Fact] public void Enabled() { var options = new { Skip = "not an attribute" }; Assert.False(false); }',
  ].join("\n"), "tests");
  addSource(root, "tests/test_account.py", [
    "@pytest.mark.skip(reason='requires service')",
    "def test_disabled():",
    "    assert True",
    "@pytest.mark.skipif(condition)",
    "def test_conditional():",
    "    assert True",
  ].join("\n"), "tests");
  addSource(root, "tests/Account.Tests.ps1", [
    "It 'disabled' -Skip { $true | Should -BeTrue }",
    "It 'enabled' -Skip:$false { $true | Should -BeTrue }",
  ].join("\n"), "tests");
  const result = discoverBrownfieldSpec(root);
  const cases = result.proposals.flatMap((proposal) =>
    JSON.parse(fs.readFileSync(path.join(root, proposal.evidencePath), "utf8")).sources.flatMap((source) => source.test_cases));
  for (const name of ["Disabled", "test_disabled", "disabled"]) {
    const item = cases.find((candidate) => candidate.name === name);
    assert.equal(item.declaration, "disabled");
    assert.equal(item.body_evidence.assertions.length, 1);
  }
  for (const name of ["Enabled", "test_conditional", "enabled"]) {
    assert.equal(cases.find((candidate) => candidate.name === name).declaration, "declared");
  }
});

test("domain review covers each source once and extracts cited contract and test-case candidates", () => {
  const { root } = makeProject();
  addSource(root, "backend/API/Contracts/Requests/Auth/RegisterRequest.cs", [
    "public sealed class RegisterRequest {",
    "  [Required]",
    "  [StringLength(128, MinimumLength = 8)]",
    "  public string Password { get; set; }",
    "}",
  ].join("\n"));
  addSource(root, "backend/API/Controllers/AuthController.cs", '[Authorize]\n[HttpPost("register")]\npublic class AuthController {}\n');
  addSource(root, "frontend/src/app/core/auth/auth.guard.spec.ts",
    'it("denies unauthenticated access", () => {});\nit.skip("pending case", () => {});\n', "tests");
  addSource(root, "backend/App/Services/BillingService.cs", "public class BillingService {}\n");
  const result = discoverBrownfieldSpec(root);
  assert.equal(result.domainCount, 2);
  assert.equal(result.proposals.length, 2);
  const manifests = result.proposals.map((proposal) =>
    JSON.parse(fs.readFileSync(path.join(root, proposal.evidencePath), "utf8")));
  const paths = manifests.flatMap((manifest) => manifest.sources.map((source) => source.path));
  assert.equal(new Set(paths).size, result.sourceCount);
  assert.equal(paths.length, result.sourceCount);
  const auth = result.proposals.find((proposal) => proposal.domain === "auth");
  const markdown = fs.readFileSync(path.join(root, auth.specPath), "utf8");
  assert.match(markdown, /Password declares Required/);
  assert.match(markdown, /StringLength\(128, MinimumLength = 8\)/);
  assert.match(markdown, /input lengths 7, 8, 128, 129/);
  assert.match(markdown, /#L2\)/);
  assert.match(markdown, /negative-candidate/);
  assert.match(markdown, /boundary-candidate/);
  assert.match(markdown, /Missing identity or wrong role/);
  assert.match(markdown, /disabled-not-run/);
  assert.match(markdown, /denies unauthenticated access/);
  const authEvidence = manifests.find((manifest) => manifest.domain === "auth");
  assert.equal(authEvidence.format_version, 8);
  const validation = authEvidence.test_cases.find((item) => item.title === "Password: Required");
  assert.equal(validation.behavior, "observed-declaration");
  assert.equal(validation.automation, "not-assessed");
  assert.equal(validation.execution, "not-run-by-discovery");
  const authorization = authEvidence.test_cases.find((item) => item.title === "Missing identity or wrong role/policy");
  assert.equal(authorization.behavior, "observed-declaration");
  const existingTest = authEvidence.test_cases.find((item) => item.title === "denies unauthenticated access");
  assert.equal(existingTest.behavior, "not-assessed");
  assert.equal(existingTest.automation, "declared");
  assert.equal(existingTest.execution, "not-verified");
  assert.equal(authEvidence.test_cases.find((item) => item.title === "pending case").automation, "declared-disabled");
  const generic = authEvidence.test_cases.find((item) => item.title === "Owner-confirmed normal behavior");
  assert.equal(generic.behavior, "not-assessed");
  assert.equal(generic.automation, "not-assessed");
  assert.ok(authEvidence.test_cases.every((item) => item.execution !== "not-implemented"));
  assert.match(markdown, /Product behavior \| Test automation \| Execution/);
  assert.doesNotMatch(markdown, /not-implemented/);
  const catalog = fs.readFileSync(path.join(root, auth.specPath.replace(/\.md$/, ".cases-1.md")), "utf8");
  assert.match(catalog, /coverage has not been linked or ruled out/);
  assert.match(catalog, /observed-declaration \| not-assessed \| not-run-by-discovery/);
  assert.ok(!markdown.includes("billing.js"));
  assert.ok(markdown.split("\n").length <= 200);
  const index = fs.readFileSync(path.join(root, result.indexPath), "utf8");
  assert.match(index, /2 candidate domains/);
  assert.match(index, /Review domain/);
});

for (const version of [4, 5, 6, 7]) test(`version ${version} case evidence remains verifiable and ratifiable without rewriting historical catalogs`, () => {
  const { root } = makeProject();
  const proposal = discoverBrownfieldSpec(root);
  const evidencePath = path.join(root, proposal.evidencePath);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  evidence.format_version = version;
  for (const item of evidence.test_cases) {
    if (version === 4) {
      delete item.behavior;
      delete item.automation;
      if (item.kind !== "declared") item.execution = "not-implemented";
    }
  }
  const oldSnapshot = evidence.snapshot_sha256;
  evidence.snapshot_sha256 = crypto.createHash("sha256").update(JSON.stringify({
    schema_version: 2, format_version: version, domain: evidence.domain,
    part: evidence.part, parts: evidence.parts, sources: evidence.sources, cases: evidence.test_cases,
  })).digest("hex");
  const specPath = path.join(root, proposal.specPath);
  fs.writeFileSync(specPath, fs.readFileSync(specPath, "utf8").replace(oldSnapshot, evidence.snapshot_sha256));
  fs.writeFileSync(evidencePath, JSON.stringify(evidence));
  const pages = renderCasePages({
    slug: proposal.slug, cases: evidence.test_cases, specPath: proposal.specPath,
    evidencePath: proposal.evidencePath, formatVersion: version,
  });
  if (version >= 6) pages.push(...renderObservationPages({
    slug: proposal.slug, sources: evidence.sources, specPath: proposal.specPath,
    evidencePath: proposal.evidencePath, formatVersion: version,
  }));
  for (const page of pages) fs.writeFileSync(path.join(root, page.path), page.content);
  if (version === 4) {
    assert.match(pages[0].content, /\| Evidence \| Execution \| Expected outcome/);
    assert.doesNotMatch(pages[0].content, /Product behavior/);
  } else if (version === 5) {
    assert.match(pages[0].content, /Generic scenarios have behavior not-assessed; their source link provides context only, not evidence that the scenario is implemented\./);
    assert.doesNotMatch(pages[0].content, /observed-syntax scenarios/);
  }
  assert.doesNotMatch(pages[0].content, /undefined/);
  const confirmed = completeProposal(root, proposal);
  ratifyBrownfieldSpec(root, { slug: proposal.slug, reviewer: "Legacy reviewer", confirmSha256: confirmed });
  assert.equal(fs.readFileSync(path.join(root, pages[0].path), "utf8"), pages[0].content);
});

test("every test case has a readable linked catalog page and approved catalogs preserve working links", () => {
  const { root } = makeProject();
  addSource(root, "tests/catalog.spec.ts",
    Array.from({ length: 95 }, (_, index) => `test("behavior case ${index}", () => {});`).join("\n"), "tests");
  const result = discoverBrownfieldSpec(root);
  for (const proposal of result.proposals) {
    const evidence = JSON.parse(fs.readFileSync(path.join(root, proposal.evidencePath), "utf8"));
    const pages = proposal.casePaths.map((casePath) => fs.readFileSync(path.join(root, casePath), "utf8"));
    assert.ok(pages.every((page) => page.split("\n").length <= 60));
    assert.equal(pages.reduce((total, page) => total + page.split("\n").filter((line) => line.startsWith("| TC-")).length, 0),
      evidence.test_cases.length);
    const hash = completeProposal(root, proposal);
    const approved = ratifyBrownfieldSpec(root, { slug: proposal.slug, reviewer: "Owner", confirmSha256: hash });
    const approvedText = fs.readFileSync(path.join(root, approved.specPath), "utf8");
    assert.match(approvedText, /\]\(evidence\.json\)/);
    for (const casePath of proposal.casePaths) {
      const copied = path.join(root, path.dirname(approved.specPath), path.basename(casePath));
      assert.ok(fs.existsSync(copied));
      const text = fs.readFileSync(copied, "utf8");
      assert.match(text, /\[Back to proposal\]\(spec\.md\)/);
      assert.match(text, /\]\(evidence\.json\)/);
    }
  }
});

test("editing generated case evidence cannot be hidden behind an unchanged proposal digest", () => {
  const { root } = makeProject();
  const result = discoverBrownfieldSpec(root);
  const proposal = result.proposals[0];
  const hash = completeProposal(root, proposal);
  fs.appendFileSync(path.join(root, proposal.casePaths[0]), "\nClaimed pass\n");
  assert.throws(() => ratifyBrownfieldSpec(root, {
    slug: proposal.slug, reviewer: "Owner", confirmSha256: hash,
  }), /test-case evidence changed/);
  assert.throws(() => discoverBrownfieldSpec(root), /edited review index/);
});

test("implementation and assertion catalogs are complete, immutable and copied on ratification", () => {
  const { root } = makeProject([
    "export function calculateTotal(value) {",
    "  if (value < 0) {",
    '    throw new Error("negative invoice");',
    "  }",
    "  return value;",
    "}",
  ].join("\n"));
  addSource(root, "tests/billing.spec.ts", [
    'it("rejects a negative invoice", () => {',
    '  expect(() => calculateTotal(-1)).toThrow("negative invoice");',
    "});",
    'it("keeps a positive invoice", () => {',
    "  expect(calculateTotal(7)).toBe(7);",
    "});",
  ].join("\n"), "tests");
  const proposal = discoverBrownfieldSpec(root);
  const evidence = JSON.parse(fs.readFileSync(path.join(root, proposal.evidencePath), "utf8"));
  const existing = evidence.test_cases.find((item) => item.title === "rejects a negative invoice");
  assert.deepEqual(existing.body_evidence.assertions.map((item) => item.line), [2]);
  assert.match(existing.review, /1 assertion statements observed/);
  assert.ok(evidence.test_cases.some((item) => item.kind === "implementation-candidate"));
  const observationPaths = proposal.proposals[0].observationPaths;
  const pages = observationPaths.map((item) => fs.readFileSync(path.join(root, item), "utf8"));
  assert.equal(pages.reduce((total, page) => total + page.split("\n").filter((line) => line.startsWith("| OBS-")).length, 0),
    evidence.sources.reduce((total, source) => total + source.facts.length, 0));
  assert.match(pages.join("\n"), /toThrow/);
  const hash = completeProposal(root, proposal);
  const filename = path.join(root, observationPaths[0]);
  const original = fs.readFileSync(filename, "utf8");
  fs.appendFileSync(filename, "\nFalse runtime claim\n");
  assert.throws(() => ratifyBrownfieldSpec(root, { slug: proposal.slug, reviewer: "Owner", confirmSha256: hash }), /evidence changed/);
  fs.writeFileSync(filename, original);
  const approved = ratifyBrownfieldSpec(root, { slug: proposal.slug, reviewer: "Owner", confirmSha256: hash });
  for (const page of observationPaths) {
    const text = fs.readFileSync(path.join(root, path.dirname(approved.specPath), path.basename(page)), "utf8");
    assert.match(text, /\[Back to proposal\]\(spec\.md\)/);
    assert.match(text, /\]\(evidence\.json\)/);
  }
});

test("quoted test examples are not extracted as real test declarations", () => {
  const { root } = makeProject();
  addSource(root, "tests/billing.spec.ts", [
    "const example = 'test(\"fake test\", () => {})';",
    "  it('real test', () => {",
    "    expect(calculateTotal(7)).toBe(7);",
    "  });",
  ].join("\n"), "tests");
  const proposal = discoverBrownfieldSpec(root);
  const evidence = JSON.parse(fs.readFileSync(path.join(root, proposal.evidencePath), "utf8"));
  const declarations = evidence.sources.flatMap((source) => source.test_cases);
  assert.ok(!declarations.some((item) => item.name === "fake test"));
  const real = declarations.find((item) => item.name === "real test");
  assert.equal(real.body_evidence.status, "block-inspected");
  assert.deepEqual(real.body_evidence.assertions.map((item) => item.line), [3]);
});

test("discovery reports unsupported implementation and failed source-processing gaps persistently", () => {
  const { root } = makeProject();
  addSource(root, "services/accounts.rb", "def accept(value)\n    value >= 8\nend\n");
  const manifestPath = path.join(root, "knowledge/traceability/source-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.sources.push({
    path: "attachments/broken.pdf", category: "office-documents", status: "requires-tool",
  }, {
    path: "attachments/broken.json", category: "configuration", status: "failed",
  });

  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = discoverBrownfieldSpec(root);
  assert.equal(result.coverage.indexed_sources, 5);
  assert.equal(result.coverage.included_sources, 3);
  assert.deepEqual(result.coverage.excluded_sources.map((item) => item.reason),
    ["source-processing-requires-tool", "source-processing-failed"]);
  assert.deepEqual(result.coverage.implementation_recognition.unsupported, ["services/accounts.rb"]);
  const latest = JSON.parse(fs.readFileSync(path.join(root, ".mcpee/specs/latest.json"), "utf8"));
  assert.deepEqual(latest.coverage, result.coverage);
  const index = fs.readFileSync(path.join(root, result.indexPath), "utf8");
  assert.match(index, /services\/accounts.rb: implementation syntax unsupported/);
  assert.match(index, /attachments\/broken.pdf: source-processing-requires-tool/);
  assert.match(index, /one mcpee init invocation/);
  assert.equal(discoverBrownfieldSpec(root).status, "preserved");
});

test("removing every indexed source clears only active drafts, retaining approved contracts and historical evidence", () => {
  const { root } = makeProject();
  const proposal = discoverBrownfieldSpec(root);
  const approved = ratifyBrownfieldSpec(root, {
    slug: proposal.slug, reviewer: "Acceptance fixture owner", confirmSha256: completeProposal(root, proposal),
  });
  const approvedPath = path.join(root, approved.specPath);
  const contract = fs.readFileSync(approvedPath, "utf8");
  fs.unlinkSync(path.join(root, "src/billing.js"));
  fs.unlinkSync(path.join(root, "tests/billing.test.js"));
  fs.writeFileSync(path.join(root, "knowledge/traceability/source-manifest.json"),
    JSON.stringify({ generated_by: "mcpee", sources: [] }));
  assert.deepEqual(discoverBrownfieldSpec(root), { status: "empty", sourceCount: 0 });
  assert.deepEqual(listBrownfieldSpecs(root).map((item) => item.status), ["approved"]);
  assert.ok(listBrownfieldSpecs(root, { includeArchived: true }).some((item) => item.status === "proposed"));
  assert.equal(fs.readFileSync(approvedPath, "utf8"), contract);
  assert.ok(fs.existsSync(path.join(root, proposal.specPath)));
  const drift = checkSpecDrift(root);
  assert.equal(drift.drifted, 1);
  assert.equal(drift.specifications[0].specification_status, "approved");
  assert.deepEqual(drift.specifications[0].missing, ["src/billing.js", "tests/billing.test.js"]);
});

test("missing manifests cannot silently hide current drafts or approved contracts", () => {
  const { root } = makeProject();
  const proposal = discoverBrownfieldSpec(root);
  const approved = ratifyBrownfieldSpec(root, {
    slug: proposal.slug, reviewer: "Owner", confirmSha256: completeProposal(root, proposal),
  });
  fs.unlinkSync(path.join(root, approved.evidencePath));
  assert.throws(() => listBrownfieldSpecs(root), /missing its evidence manifest/);
  assert.throws(() => checkSpecDrift(root), /missing its evidence manifest/);
  fs.unlinkSync(path.join(root, proposal.evidencePath));
  assert.throws(() => listBrownfieldSpecs(root), /Current review artifact is missing/);
});

test("large domains are bounded, deterministic and never discard source or test records", () => {
  const sources = Array.from({ length: 45 }, (_, index) => ({
    path: `src/features/payments/file-${index}.ts`,
    category: "source-code", facts: [], test_cases: [],
  }));
  sources.push({
    path: "tests/payments.spec.ts", category: "tests", facts: [],
    test_cases: Array.from({ length: 80 }, (_, index) => ({ name: `case ${index}`, line: index + 1 })),
  });
  const partitions = partitionDomains(sources);
  assert.ok(partitions.every((part) => part.sources.length <= 20));
  assert.deepEqual(partitionDomains([...sources].reverse()), partitions);
  assert.equal(partitions.flatMap((part) => part.sources).length, 46);
  assert.equal(partitions.flatMap((part) => part.sources).flatMap((source) => source.test_cases).length, 80);
});

test("discovery preserves edited drafts and approved specs and refuses an edited evidence manifest", () => {
  const { root } = makeProject();
  const result = discoverBrownfieldSpec(root);
  const hash = completeProposal(root, result);
  const approved = ratifyBrownfieldSpec(root, { slug: result.slug, reviewer: "Owner", confirmSha256: hash });
  const before = fs.readFileSync(path.join(root, approved.specPath), "utf8");
  assert.equal(discoverBrownfieldSpec(root).sha256, hash);
  assert.equal(fs.readFileSync(path.join(root, approved.specPath), "utf8"), before);
  const evidencePath = path.join(root, result.evidencePath);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  evidence.sources.pop();
  fs.writeFileSync(evidencePath, JSON.stringify(evidence));
  assert.throws(() => discoverBrownfieldSpec(root), /Refusing to overwrite/);
  assert.throws(() => ratifyBrownfieldSpec(root, {
    slug: result.slug, reviewer: "Owner", confirmSha256: hash,
  }), /snapshot reference changed/);
});

test("source drift blocks discovery and missing sources are reported without rewriting approved specs", () => {
  const { root, sourceFile } = makeProject();
  const result = discoverBrownfieldSpec(root);
  const approved = ratifyBrownfieldSpec(root, {
    slug: result.slug, reviewer: "Owner", confirmSha256: completeProposal(root, result),
  });
  const before = fs.readFileSync(path.join(root, approved.specPath), "utf8");
  fs.unlinkSync(sourceFile);
  assert.throws(() => discoverBrownfieldSpec(root), /no longer available/);
  const drift = checkSpecDrift(root);
  assert.equal(drift.drifted, 2);
  assert.ok(drift.specifications.every((item) => item.missing.includes("src/billing.js")));
  assert.equal(fs.readFileSync(path.join(root, approved.specPath), "utf8"), before);
});

test("commented test and validation declarations are not promoted to observed evidence", () => {
  const { root } = makeProject();
  addSource(root, "src/features/auth/Request.cs", [
    "/*",
    "[Required]",
    "public string Bogus { get; set; }",
    "*/",
    "[Required]",
    "public string Email { get; set; }",
  ].join("\n"));
  addSource(root, "tests/auth.spec.ts", [
    '// test("not a real test", () => {});',
    "/*",
    'test("also not real", () => {});',
    "*/",
    'test("real declaration", () => {});',
  ].join("\n"), "tests");
  const result = discoverBrownfieldSpec(root);
  const auth = result.proposals.find((proposal) => proposal.domain === "auth");
  const evidence = JSON.parse(fs.readFileSync(path.join(root, auth.evidencePath), "utf8"));
  assert.deepEqual(evidence.sources.flatMap((source) => source.test_cases).map((item) => item.name), ["real declaration"]);
  assert.deepEqual(evidence.sources.flatMap((source) => source.facts).map((item) => item.field), ["Email"]);
});

test("approved content is included with hash checks for grounded, packed and no-grounding contexts", () => {
  const { root } = makeProject();
  const proposal = discoverBrownfieldSpec(root);
  const approved = ratifyBrownfieldSpec(root, {
    slug: proposal.slug, reviewer: "Owner", confirmSha256: completeProposal(root, proposal),
  });
  const spec = listBrownfieldSpecs(root).find((item) => item.status === "approved");
  const plan = { approved_specs: [spec] };
  for (const base of [
    null,
    { kind: "grounded", content: "grounded evidence", files: ["src/billing.js"], retrieval: "lexical" },
    { content: "packed evidence", files: ["src/billing.js"] },
  ]) {
    const prepared = prepareApprovedSpecContext(root, plan, base);
    assert.match(prepared.content, /Preserve the invoice amount confirmed by the owner/);
    assert.ok(prepared.files.includes(spec.path));
    assert.ok(prepared.byteLength === Buffer.byteLength(prepared.content));
    if (base) assert.ok(prepared.content.includes(base.content));
  }
  fs.appendFileSync(path.join(root, approved.specPath), "\nChanged after routing\n");
  assert.throws(() => prepareApprovedSpecContext(root, plan), /changed after routing/);
  assert.throws(() => prepareApprovedSpecContext(root, {
    approved_specs: [{ path: "../outside.md", sha256: "0".repeat(64) }],
  }), /invalid path/);
});

test("executor receives actual approved content and refuses path-only or stale approvals before starting SDK", async () => {
    const { root } = makeProject();
    const proposal = discoverBrownfieldSpec(root);
    ratifyBrownfieldSpec(root, {
      slug: proposal.slug, reviewer: "Owner", confirmSha256: completeProposal(root, proposal),
    });
    const spec = listBrownfieldSpecs(root).find((item) => item.status === "approved");
    const plan = { workflow: { id: "review" }, agent: { id: "reviewer" }, approved_specs: [spec] };
    let starts = 0;
    let prompt = "";
    const client = {
      async start() { starts += 1; },
      async stop() {},
      async createSession() {
        return {
          sessionId: "approved-spec-fixture",
          async sendAndWait(message) {
            prompt = message.prompt;
            return { data: { content: "Read the approved contract." } };
          },
          async disconnect() {},
        };
      },
    };
    await assert.rejects(runCopilotTask(root, "Review the invoice contract", plan, {
      approved: true, clientFactory: () => client,
    }), /must be prepared/);
    assert.equal(starts, 0);
    const contextPackage = prepareApprovedSpecContext(root, plan);
    const result = await runCopilotTask(root, "Review the invoice contract", plan, {
      approved: true, contextPackage, clientFactory: () => client,
    });
    assert.match(prompt, /Preserve the invoice amount confirmed by the owner/);
    assert.match(prompt, /Source drift: current/);
    assert.match(prompt, /normative source/);
    assert.equal(result.content, "Read the approved contract.");
    fs.appendFileSync(path.join(root, spec.path), "\nChanged before execution\n");
    await assert.rejects(runCopilotTask(root, "Review the invoice contract", plan, {
      approved: true, contextPackage, clientFactory: () => client,
    }), /changed after routing/);
    assert.equal(starts, 1);
  });

  test("a new snapshot archives drafts from default list without deleting them or approved contracts", () => {
    const { root } = makeProject();
    const first = discoverBrownfieldSpec(root);
    addSource(root, "src/features/auth/login.ts", "export function login() {}\n");
    const second = discoverBrownfieldSpec(root);
    assert.notEqual(first.indexPath, second.indexPath);
    assert.ok(fs.existsSync(path.join(root, first.specPath)));
    assert.ok(listBrownfieldSpecs(root, { includeArchived: true }).some((item) => item.slug === first.slug));
    assert.equal(listBrownfieldSpecs(root).length, second.proposals.length);
    assert.equal(checkSpecDrift(root).specifications.length, second.proposals.length);
    assert.equal(discoverBrownfieldSpec(root).status, "preserved");
  });

  test("specification context fails explicitly when too large and does not truncate requirements", () => {
    const { root } = makeProject();
    const proposal = discoverBrownfieldSpec(root);
    const reviewed = completeProposal(root, proposal);
    ratifyBrownfieldSpec(root, { slug: proposal.slug, reviewer: "Owner", confirmSha256: reviewed });
    const spec = listBrownfieldSpecs(root).find((item) => item.status === "approved");
    fs.appendFileSync(path.join(root, spec.path), "x".repeat(128 * 1024));
    spec.sha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, spec.path))).digest("hex");
    assert.throws(() => prepareApprovedSpecContext(root, { approved_specs: [spec] }), /exceeds 131072 bytes/);
  });

  test("review navigation refuses to overwrite user-owned state", () => {
    const { root } = makeProject();
    fs.mkdirSync(path.join(root, ".mcpee", "specs"), { recursive: true });
    const latest = path.join(root, ".mcpee", "specs", "latest.json");
    fs.writeFileSync(latest, JSON.stringify({ note: "user-owned" }));
    assert.throws(() => discoverBrownfieldSpec(root), /user-owned review state/);
    assert.equal(fs.readFileSync(latest, "utf8"), '{"note":"user-owned"}');
  });

  test("discovery refuses directory links, including dangling ones, without writing outside the project", () => {
    const { root } = makeProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-spec-outside-"));
    roots.push(outside);
    fs.mkdirSync(path.join(root, ".mcpee"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".mcpee", "specs"), "junction");
    assert.throws(() => discoverBrownfieldSpec(root), /symbolic link/);
    assert.deepEqual(fs.readdirSync(outside), []);
    fs.unlinkSync(path.join(root, ".mcpee", "specs"));
    fs.symlinkSync(path.join(outside, "missing"), path.join(root, ".mcpee", "specs"), "junction");
    assert.throws(() => discoverBrownfieldSpec(root), /symbolic link/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
test("ratification requires completed behavior, exact reviewed hash, and current sources", () => {
  const { root, sourceFile } = makeProject();
  const proposal = discoverBrownfieldSpec(root);

  assert.throws(() => ratifyBrownfieldSpec(root, {
    slug: proposal.slug,
    reviewer: "Product owner",
    confirmSha256: proposal.sha256,
  }), /placeholders/);

  const filename = path.join(root, proposal.specPath);
  const initial = fs.readFileSync(filename, "utf8");
  fs.writeFileSync(filename, initial
    .replace("<!-- Replace this prompt with behavior confirmed by the accountable owner. -->", "")
    .replace("<!-- Add observable, testable criteria and link each criterion to evidence. -->", ""));
  const emptySha256 = crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
  assert.throws(() => ratifyBrownfieldSpec(root, {
    slug: proposal.slug,
    reviewer: "Product owner",
    confirmSha256: emptySha256,
  }), /substantive intended behavior/);

  const completed = initial
    .replace("<!-- Replace this prompt with behavior confirmed by the accountable owner. -->",
      "Invoices must include the customer-approved total.")
    .replace("<!-- Add observable, testable criteria and link each criterion to evidence. -->",
      "Given invoice lines, the calculated total equals the sum of line amounts.");
  fs.writeFileSync(filename, completed);
  const reviewedSha256 = crypto.createHash("sha256").update(completed).digest("hex");

  assert.throws(() => ratifyBrownfieldSpec(root, {
    slug: proposal.slug,
    reviewer: "Product owner",
    confirmSha256: "0".repeat(64),
  }), /Proposal changed or was not reviewed/);

  const approved = ratifyBrownfieldSpec(root, {
    slug: proposal.slug,
    reviewer: "Product owner",
    confirmSha256: reviewedSha256,
  });
  const approvedSpec = fs.readFileSync(path.join(root, approved.specPath), "utf8");
  const approvedEvidence = JSON.parse(fs.readFileSync(path.join(root, approved.evidencePath), "utf8"));
  assert.equal(approved.status, "approved");
  assert.match(approvedSpec, /\*\*Status:\*\* approved/);
  assert.match(approvedSpec, /Invoices must include the customer-approved total/);
  assert.equal(approvedEvidence.approval.reviewer, "Product owner");
  assert.equal(approvedEvidence.approval.proposal_sha256, reviewedSha256);
  assert.equal(checkSpecDrift(root).current, 2);

  fs.writeFileSync(sourceFile, "export function calculateTotal() { return 0; }\n");
  const drift = checkSpecDrift(root);
  assert.equal(drift.drifted, 2);
  assert.ok(drift.specifications.every((spec) =>
    spec.drift_status === "drifted" && spec.changed.includes("src/billing.js")));
  assert.throws(() => ratifyBrownfieldSpec(root, {
    slug: proposal.slug,
    reviewer: "Product owner",
    confirmSha256: reviewedSha256,
  }), /source drift/);
});

test("discovery skips empty inventories and refuses unsafe source paths", () => {
  const { root } = makeProject();
  fs.writeFileSync(path.join(root, "knowledge", "traceability", "source-manifest.json"), JSON.stringify({
    generated_by: "mcpee",
    sources: [],
  }));
  assert.deepEqual(discoverBrownfieldSpec(root), { status: "empty", sourceCount: 0 });

  fs.writeFileSync(path.join(root, "knowledge", "traceability", "source-manifest.json"), JSON.stringify({
    generated_by: "mcpee",
    sources: [{
      path: "../outside.txt",
      sha256: "0".repeat(64),
      category: "source-code",
      status: "processed",
      extracted_path: "knowledge/extracted/billing.json",
    }],
  }));
  assert.throws(() => discoverBrownfieldSpec(root), /outside the project/);
});

test("approved specification paths are included in local execution context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-approved-spec-context-"));
  roots.push(root);
  initializeProject(root);
  assert.match(fs.readFileSync(path.join(root, ".mcpee", ".gitignore"), "utf8"), /^\/specs\/$/m);
  fs.writeFileSync(path.join(root, ".mcpee", ".gitignore"), "/my-existing-cache/\n");
  initializeProject(root);
  const ignoreRules = fs.readFileSync(path.join(root, ".mcpee", ".gitignore"), "utf8");
  assert.match(ignoreRules, /^\/specs\/$/m);
  assert.match(ignoreRules, /^\/my-existing-cache\/$/m);
  const specPath = "specs/approved/invoice/spec.md";
  fs.mkdirSync(path.dirname(path.join(root, specPath)), { recursive: true });
  fs.writeFileSync(path.join(root, specPath), "# Approved invoice behavior\n");

  const files = collectContextFiles(root, {
    knowledge: [],
    knowledge_graph: [],
    memory: [],
    approved_specs: [{ path: specPath, slug: "invoice" }],
  });

  assert.deepEqual(files, [specPath]);
});

test("specs CLI discovers and lists proposals as JSON", () => {
  const { root } = makeProject();
  const cli = path.resolve(__dirname, "../packages/cli/bin/mcpee.js");
  const discovered = spawnSync(process.execPath, [
    cli, "specs", "discover", "--project", root, "--json",
  ], { encoding: "utf8", timeout: 30_000 });
  assert.equal(discovered.status, 0, discovered.stderr);
  const proposal = JSON.parse(discovered.stdout);
  assert.equal(proposal.status, "created");

  const listed = spawnSync(process.execPath, [
    cli, "specs", "list", "--project", root, "--json",
  ], { encoding: "utf8", timeout: 30_000 });
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout)[0].slug, proposal.slug);

  const proposalPath = path.join(root, proposal.specPath);
  const completed = fs.readFileSync(proposalPath, "utf8")
    .replace("<!-- Replace this prompt with behavior confirmed by the accountable owner. -->",
      "The system preserves the invoice total confirmed by the owner.")
    .replace("<!-- Add observable, testable criteria and link each criterion to evidence. -->",
      "Given an invoice, the recorded total matches the verified line sum.");
  fs.writeFileSync(proposalPath, completed);
  const digest = crypto.createHash("sha256").update(completed).digest("hex");
  const ratified = spawnSync(process.execPath, [
    cli,
    "specs",
    "ratify",
    "--slug",
    proposal.slug,
    "--reviewer",
    "Owner",
    "--confirm-sha256",
    digest,
    "--project",
    root,
  ], { encoding: "utf8", timeout: 30_000 });
  assert.equal(ratified.status, 0, ratified.stderr);
  assert.match(ratified.stdout, /Specification ratified by Owner/);
  assert.equal(listBrownfieldSpecs(root).filter((spec) => spec.status === "approved").length, 1);
});
