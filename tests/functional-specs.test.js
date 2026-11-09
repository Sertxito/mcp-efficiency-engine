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
const { isSpecificationTask, prepareFunctionalSources, selectFunctionalSources, functionalPrompt, applyFunctionalRepair, validateFunctionalSpec, publishFunctionalSpec, publishFunctionalSpecWithApproval } = require("../packages/spec-engine/src/functional");
const { runCopilotTask, createCopilotHooks } = require("../packages/execution-engine/src/copilot");
const { routeTask } = require("../packages/routing-engine/src/route");
const { affirmativeText, isReadOnlyTask, requestsArtifact } = require("../packages/spec-engine/src/intent");

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
test("functional source selection excludes only fully managed VS Code MCP configuration", () => {
  const { root, file } = fixture();
  const configPath = ".vscode/mcp.json";
  const filePath = path.join(root, configPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const config = { servers: { mcpee: { type: "stdio", command: "node",
    args: ["./.mcpee/runtime/mcp-server.cjs"] } } };
  const save = () => fs.writeFileSync(filePath, JSON.stringify(config));
  save();
  assert.deepEqual(prepareFunctionalSources(root, [file, configPath]).map(source => source.path), [file]);
  config.servers.product = { type: "stdio", command: "node", args: ["server.js"] };
  save();
  assert.deepEqual(prepareFunctionalSources(root, [file, configPath]).map(source => source.path), [file, configPath]);
  delete config.servers.product;
  config.servers.mcpee.tools = ["custom-tool"];
  save();
  assert.deepEqual(prepareFunctionalSources(root, [file, configPath]).map(source => source.path), [file, configPath]);
  delete config.servers.mcpee.tools;
  config.servers.mcpee.args = ["custom-server.js"];
  save();
  assert.deepEqual(prepareFunctionalSources(root, [file, configPath]).map(source => source.path), [file, configPath]);
});

function draft(file) {
  return {
    language: "en", title: "League public participation", slug: "league-public-participation",
    summary: "Help prospective participants understand official teams and registration availability.",
    scope: ["Display the public registration state and official team size."],
    non_goals: ["Do not create accounts or collect private participant details."],
    actors: [{ id: "ACT-001", name: "Prospective participant", goal: "Understand when and how their team can participate." }],
    use_cases: [{
      id: "UC-001", slug: "registration-status", title: "Check team registration availability", actor: "ACT-001", basis: "documented",
      goal: "Understand whether participation registration is available for an official team.",
      dependencies: [], open_questions: [],
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
  for (const task of ["Prepara las especificaciones funcionales de League", "Genera casos de uso del documento", "Draft functional specifications", "hazme el greenfield", "Quiero que hagas el greenfield con estos documentos", "brownfield del proyecto"]) {
    assert.equal(isSpecificationTask(task), true, task);
  }
  for (const task of ["Fix a bug in the greenfield detector", "Review the functional specification", "Explain use cases", "Create a website", "Write tests for the specification parser",
    "Esto NO es una solicitud de generar especificaciones, planes, tareas ni implementar nada.",
    "Diagnóstico: la ejecución acabó en generación de especificaciones funcionales.",
    "El fallo previo fue «Genera las especificaciones funcionales»; explica por qué.",
    "Revisión de solo lectura: genera especificaciones si el router lo permite.",
    "Do not generate functional specifications; inspect the router."]) {
    assert.equal(isSpecificationTask(task), false, task);
  }
  for (const task of ["No implementes nada; genera las especificaciones funcionales", "Without changing code, draft the use cases"]) {
    assert.equal(isSpecificationTask(task), true, task);
  }
});

test("single-quoted examples do not express authoring intent or consume contractions", () => {
  for (const task of [
    "Explain the phrase 'create tasks' for public-catalog.",
    "Explain 'generate functional specifications'.",
    "Explica 'crea tareas' y 'genera especificaciones funcionales'.",
    "Explain ‘create tasks’ for public-catalog.",
  ]) {
    assert.equal(requestsArtifact(task, /\b(?:tasks|tareas)\b/), false, task);
    assert.equal(isSpecificationTask(task), false, task);
  }
  assert.equal(affirmativeText("Don't implement public-catalog."), "");
  assert.equal(affirmativeText("Don't implement; create tasks for the user's catalog."),
    "create tasks for the user's catalog");
  assert.equal(requestsArtifact("Explain 'don't create tasks'; generate functional specifications.",
    /\b(?:tasks|tareas)\b/), false);
  assert.equal(isSpecificationTask("Explain 'create tasks'; generate functional specifications."), true);
  assert.equal(isSpecificationTask("Revisa y actualiza la propuesta funcional league-web-integral para resolver su deriva."), true);
  assert.equal(isSpecificationTask("Update the existing functional specification proposal for league-web-integral."), true);
  assert.equal(isSpecificationTask("No actualices la propuesta funcional league-web-integral."), false);
});

test("read-only capability descriptions do not override affirmative work requests", () => {
  for (const task of [
    "Implement a read-only endpoint for public-catalog.",
    "Implementa una API de solo lectura para public-catalog.",
    "Generate functional specifications for a read-only API.",
    "Do not use read-only mode; implement public-catalog.",
    "Explain 'read-only'; implement public-catalog.",
  ]) assert.equal(isReadOnlyTask(task), false, task);
  for (const task of [
    "Read-only review: generate specifications if the router permits it.",
    "Revisión técnica de solo lectura: genera tareas si es posible.",
    "Inspect public-catalog in read-only mode.",
    "Implement public-catalog? Review the plan in read-only mode first.",
  ]) assert.equal(isReadOnlyTask(task), true, task);
  assert.equal(isSpecificationTask("Generate functional specifications for a read-only API."), true);
});

test("Spanish product prose and literal unfinished source evidence are not authored placeholders", () => {
  const { root, file } = fixture();
  fs.appendFileSync(path.join(root, file), "\n// TODO: conectar flujo real de contacto.\n");
  const sources = prepareFunctionalSources(root, [file]);
  const document = draft(file);
  document.language = "es";
  document.use_cases[0].main_flow[0] = "La persona selecciona el periodo: este mes, este año o todo.";
  document.use_cases[0].rules[0] = "El método observado muestra todo el historial disponible.";
  document.open_questions = ["La función contiene un TODO y no define el canal de contacto. ¿Qué resultado debe ofrecer?"];
  const line = sources[0].lines.findIndex(value => value.startsWith("// TODO:")) + 1;
  document.use_cases[0].evidence.push({ path: file, line, quote: "// TODO: conectar flujo real de contacto." });
  validateFunctionalSpec(root, JSON.stringify(document), sources);
  for (const placeholder of ["TODO: definir el comportamiento", "todo fill this in", "[TODO] completar reglas", "TBD comportamiento", "placeholder behavior"]) {
    const invalid = structuredClone(document);
    invalid.summary = placeholder;
    assert.throws(() => validateFunctionalSpec(root, JSON.stringify(invalid), sources), /Replace placeholders/);
  }
  document.use_cases[0].evidence.at(-1).quote = "// TODO: inventar un canal inexistente.";
  assert.throws(() => validateFunctionalSpec(root, JSON.stringify(document), sources), /Unsupported evidence/);
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

test("evidence diagnostics report every invalid citation and exact candidate lines together", () => {
  const { root, file, sources } = fixture();
  const document = draft(file);
  document.use_cases[0].evidence.forEach(reference => { reference.line = 1; });
  assert.throws(() => validateFunctionalSpec(root, JSON.stringify(document), sources), error => {
    assert.match(error.message, /source lines 4;/);
    assert.match(error.message, /source lines 7;/);
    assert.equal(error.message.match(/Unsupported evidence/g).length, 2);
    return true;
  });
});

test("covered-section diagnostics state exact boundaries and reject evidence from the next section", () => {
  const { root, file, sources } = fixture();
  const document = draft(file);
  document.use_cases[0].evidence = document.use_cases[0].evidence.filter(reference => reference.line === 7);
  assert.throws(() => validateFunctionalSpec(root, JSON.stringify(document), sources), error => {
    assert.match(error.message, /Unsupported covered section: .*:3;/);
    assert.match(error.message, /lines 3-5, inclusive/);
    assert.match(error.message, /Evidence elsewhere in the same file does not cover this section/);
    assert.match(error.message, /out-of-scope/);
    return true;
  });
  document.coverage[0] = { ...document.coverage[0], status: "out-of-scope", use_cases: [],
    reason: "Registration behavior is explicitly outside this team-information proposal." };
  validateFunctionalSpec(root, JSON.stringify(document), sources);
});

test("bounded primary coverage excludes related context but exact context citations remain required", () => {
  const { root, file, sources } = fixture();
  const second = "knowledge/sources/business/context.md";
  fs.writeFileSync(path.join(root, second), "# Context\nReaders inspect the published item details.\n");
  const all = prepareFunctionalSources(root, [file, second]);
  const selections = [
    { path: file, sha256: sources[0].sha256, role: "primary", ranges: [{ start_line: 3, end_line: 5 }] },
    { path: second, sha256: all[1].sha256, role: "context", ranges: [{ start_line: 1, end_line: 2 }] },
  ];
  const selected = selectFunctionalSources(all, selections);
  const doc = draft(file);
  doc.coverage = [doc.coverage[0]];
  doc.use_cases[0].evidence = [doc.use_cases[0].evidence[0], { path: second, line: 2, quote: all[1].lines[1] }];
  validateFunctionalSpec(root, JSON.stringify(doc), selected);
  const missing = structuredClone(doc);
  missing.coverage = [{ ...doc.coverage[0], path: second, line: 1 }];
  assert.throws(() => validateFunctionalSpec(root, JSON.stringify(missing), selected), /Unknown source section|missing section coverage/);
  doc.use_cases[0].evidence.push({ path: file, line: 7, quote: all[0].lines[6] });
  assert.throws(() => validateFunctionalSpec(root, JSON.stringify(doc), selected), /Unsupported evidence/);
  assert.throws(() => selectFunctionalSources(all, [{ ...selections[0], ranges: [{ start_line: 3, end_line: 9999 }] }, selections[1]]), /Invalid or overlapping/);
  const prompt = functionalPrompt(selected, "brownfield");
  assert.match(prompt, /4: Registration is closed/);
  assert.doesNotMatch(prompt, /7: Official teams/);
});

test("unbounded functional authoring supplies every source line rather than retrieved fragments", () => {
  const { root, file } = fixture();
  const lines = ["# Complete requirements", ...Array.from({ length: 1400 },
    (_, index) => `Requirement ${index + 1}: preserve this distinct documented behavior.`)];
  fs.writeFileSync(path.join(root, file), lines.join("\n"));
  const prompt = functionalPrompt(prepareFunctionalSources(root, [file]), "greenfield");
  for (const [index, line] of lines.entries()) {
    assert.ok(prompt.includes(`${index + 1}: ${line}`), `Missing source line ${index + 1}`);
  }
  assert.match(prompt, /do not replace it with retrieved fragments/);
  assert.match(prompt, /do not defer documented behavior because of unavailable tools/);
  assert.match(prompt, /only explicit specification approval establishes/);
});

test("functional prompt explains in-section evidence boundaries before generation", () => {
  const { sources } = fixture();
  const prompt = functionalPrompt(sources, "brownfield");
  assert.match(prompt, /INSIDE that section's inclusive line\/end_line range/);
  const metadata = JSON.parse(prompt.split("Selected sources and required section coverage (full selected text follows):\n\n")[1].split("\n\n")[0]);
  assert.equal(metadata[0].headings[0].line, 3);
  assert.equal(metadata[0].headings[0].end_line, 5);
  assert.equal(metadata[0].headings[1].end_line, sources[0].lines.length);
});

test("functional repairs replace only explicit existing fields without altering the base or bypassing validation", () => {
  const { root, file, sources } = fixture();
  const document = draft(file), base = JSON.stringify(document);
  const repair = replacements => applyFunctionalRepair(JSON.stringify({ replacements }), base);
  const updated = repair([{ path: "/use_cases/0/evidence/0/line", value: 1 }]);
  assert.equal(JSON.parse(updated).use_cases[0].evidence[0].line, 1);
  assert.equal(JSON.stringify(document), base);
  assert.throws(() => validateFunctionalSpec(root, updated, sources), /Unsupported evidence/);
  for (const pointer of ["/__proto__/polluted", "/constructor/prototype", "/use_cases/01", "/use_cases/0/new_field", "/use_cases/-", "/use_cases/0/~2"]) {
    assert.throws(() => repair([{ path: pointer, value: true }]), /Repair must replace|Invalid repair/);
  }
  assert.throws(() => repair([{ path: "/summary" }]), /replacement value|nonoptional/);
  assert.throws(() => repair([]));
  assert.equal(applyFunctionalRepair(base, base), base);
  assert.equal(JSON.parse(applyFunctionalRepair(JSON.stringify({
    replacements: [{ path: "/a~1b/~0key", value: "after" }],
  }), '{"a/b":{"~key":"before"}}'))["a/b"]["~key"], "after");
});

test("proposal citation reconciliation changes only uniquely located exact quotes and records an audit", () => {
  const { root, file, sources } = fixture();
  const document = draft(file);
  document.use_cases[0].evidence.forEach(reference => { reference.line = 1; });
  const response = JSON.stringify(document);
  const result = publishFunctionalSpec(root, response, sources, { automatic: true, proposalOnly: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, result.manifestPath), "utf8"));
  assert.deepEqual(manifest.citation_corrections.map(item => [item.previous_line, item.line]), [[1, 4], [1, 7]]);
  assert.equal(result.lifecycle.document_state, "proposed");
  assert.equal(result.lifecycle.authoritative, false);
  assert.equal(document.use_cases[0].evidence[0].line, 1);
  const published = fs.readFileSync(path.join(root, manifest.document), "utf8");
  validateFunctionalSpec(root, published, sources);
  const duplicate = fixture();
  fs.appendFileSync(path.join(duplicate.root, duplicate.file),
    "\nRegistration is closed until the organizer publishes an authorized link.\n");
  const ambiguous = draft(duplicate.file);
  ambiguous.use_cases[0].evidence[0].line = 1;
  assert.throws(() => publishFunctionalSpec(duplicate.root, JSON.stringify(ambiguous),
    prepareFunctionalSources(duplicate.root, [duplicate.file]), { automatic: true, proposalOnly: true }),
  /Unsupported evidence/);
  const invented = draft(file);
  invented.use_cases[0].evidence[0].quote = "An invented registration rule that is absent from the source.";
  assert.throws(() => publishFunctionalSpec(root, JSON.stringify(invented), sources,
    { automatic: true, proposalOnly: true }), /Unsupported evidence/);
});

test("readable specifications preserve flows, acceptance criteria, traceability and owner edits", () => {
  const { root, file, sources } = fixture();
  const response = JSON.stringify(draft(file));
  const result = publishFunctionalSpec(root, response, sources);
  assert.equal(result.path, "docs/specifications/proposed/league-public-participation/spec.md");
  assert.match(result.content, /\[registration-status\]\(registration-status\.md\)/);
  const atomic = fs.readFileSync(path.join(root, result.casePaths[0]), "utf8");
  assert.match(atomic, /### UC-001 - Check team registration availability/);
  assert.match(atomic, /Main flow/);
  assert.match(atomic, /Given:?\*\*/);
  assert.match(atomic, /(?:\.\.\/){4}knowledge\/sources\/business\/league\.md#L4/);
  assert.match(atomic, /Product index/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, result.manifestPath)));
  assert.equal(manifest.cases[0].sha256, crypto.createHash("sha256").update(atomic).digest("hex"));
  assert.equal(manifest.review_required, true);
  assert.equal(publishFunctionalSpec(root, response, sources).content, result.content);
  fs.appendFileSync(path.join(root, result.path), "\nOwner changes\n");
  assert.throws(() => publishFunctionalSpec(root, response, sources), /requires explicit confirmation/);
  assert.match(fs.readFileSync(path.join(root, result.path), "utf8"), /Owner changes/);
  const spanish = draft(file);
  spanish.language = "es";
  spanish.slug = "league-participacion";
  assert.match(publishFunctionalSpec(root, JSON.stringify(spanish), sources).content, /## Casos de uso/);
});

test("specification revisions require approval, archive the prior bundle, and preserve matching decisions", async () => {
  const { root, file, sources } = fixture();
  const original = draft(file);
  const first = publishFunctionalSpec(root, JSON.stringify(original), sources);
  const previous = fs.readFileSync(path.join(root, first.path), "utf8");
  const { currentDigest, resolveDecision, reviseDecision } = require("../packages/spec-engine/src/lifecycle");
  resolveDecision(root, { slug: original.slug, id: "Q-001",
    answer: "The organizer publishes the authorized registration link.", reviewer: "Product owner" });
  reviseDecision(root, { slug: original.slug, id: "Q-001",
    answer: "The organizer publishes the validated registration link.", reviewer: "Product owner",
    confirmSha256: currentDigest(root, original.slug, "specification") });
  const updated = structuredClone(original);
  updated.summary += " The public page also explains the official team size.";
  const response = JSON.stringify(updated);
  const directory = "docs/specifications/proposed/league-public-participation";
  for (const [file, content] of [
    ["plan.json", "{\"open_questions\":[],\"risks\":[]}"],
    ["plan.md", "Prior plan"],
    ["tasks.json", "{\"tasks\":[]}"],
    ["tasks.md", "Prior tasks"],
    ["verification.json", "{\"verified\":true}"],
  ]) fs.writeFileSync(path.join(root, directory, file), content);
  const decisionBefore = JSON.parse(fs.readFileSync(path.join(root, "docs/specifications/proposed/league-public-participation/decisions.json"), "utf8"));
  const prepared = publishFunctionalSpec(root, response, sources, { prepareOnly: true });
  assert.match(prepared.revision.sha256, /^[a-f0-9]{64}$/);
  assert.match(prepared.revision.archive_path, /^\.mcpee\/reports\/specification-revisions\/[a-f0-9]{64}\.json$/);
  assert.equal(prepared.revision.decision_history.history_entries, 1);
  assert.deepEqual(prepared.revision.decision_history.files.map(item => item.path), [
    `${directory}/decisions.json`, `${directory}/decisions.md`,
  ]);
  assert.equal(fs.existsSync(path.join(root, prepared.revision.archive_path)), false);
  let deniedMessage;
  await assert.rejects(() => publishFunctionalSpecWithApproval(root, response, sources,
    {}, async () => false), error => {
    deniedMessage = error.message;
    return /revision was not approved/.test(error.message);
  });
  assert.equal(fs.readFileSync(path.join(root, first.path), "utf8"), previous);
  const deniedArchive = fs.readFileSync(path.join(root, prepared.revision.archive_path), "utf8");
  const deniedManifest = JSON.parse(deniedArchive);
  assert.equal(deniedManifest.kind, "specification-revision");
  const deniedArchiveSha256 = crypto.createHash("sha256").update(deniedArchive).digest("hex");
  assert.match(deniedMessage, new RegExp(`manifest SHA-256: ${deniedArchiveSha256}`));
  assert.equal(deniedManifest.artifacts.find(item => item.path.endsWith("/decisions.json")).content,
    fs.readFileSync(path.join(root, `${directory}/decisions.json`), "utf8"));
  assert.equal(deniedManifest.decision_history.history_entries, 1);
  assert.deepEqual(deniedManifest.artifacts.map(item => item.path).sort(),
    prepared.revision.artifacts.map(item => item.path).sort());
  const published = await publishFunctionalSpecWithApproval(root, response, sources,
    {}, async revision => {
      assert.equal(revision.sha256, prepared.revision.sha256);
      assert.equal(fs.existsSync(path.join(root, revision.archive_path)), true);
      assert.equal(revision.archive_manifest_sha256,
        crypto.createHash("sha256").update(fs.readFileSync(path.join(root, revision.archive_path))).digest("hex"));
      return true;
    });
  assert.ok(published.revision);
  assert.equal(published.revisionManifestSha256,
    crypto.createHash("sha256").update(fs.readFileSync(path.join(root, published.revision))).digest("hex"));
  const report = JSON.parse(fs.readFileSync(path.join(root, published.revision), "utf8"));
  assert.equal(report.kind, "specification-revision");
  assert.equal(report.artifacts.find(item => item.path === first.path).content, previous);
  assert.equal(report.artifacts.find(item => item.path === `${directory}/plan.json`).content, "{\"open_questions\":[],\"risks\":[]}");
  for (const file of ["plan.json", "plan.md", "tasks.json", "tasks.md", "verification.json"]) {
    assert.equal(fs.existsSync(path.join(root, directory, file)), false);
  }
  const decisions = JSON.parse(fs.readFileSync(path.join(root, "docs/specifications/proposed/league-public-participation/decisions.json"), "utf8"));
  assert.equal(decisions[0].answer, decisionBefore[0].answer);
  assert.deepEqual(decisions[0].history, decisionBefore[0].history);
  assert.match(fs.readFileSync(path.join(root, first.path), "utf8"), /official team size/);
});

test("a revision archive modified after approval blocks proposal replacement", async () => {
  const { root, file, sources } = fixture();
  const original = draft(file);
  const first = publishFunctionalSpec(root, JSON.stringify(original), sources);
  const previous = fs.readFileSync(path.join(root, first.path), "utf8");
  const updated = structuredClone(original);
  updated.summary += " The page also explains the official team size.";

  await assert.rejects(() => publishFunctionalSpecWithApproval(root, JSON.stringify(updated), sources,
    {}, async revision => {
      fs.writeFileSync(path.join(root, revision.archive_path), "tampered archive");
      return true;
    }), /archive is invalid/);
  assert.equal(fs.readFileSync(path.join(root, first.path), "utf8"), previous);
});

test("specification revisions retain unmatched decisions and history without reusing their IDs", async () => {
  const { root, file, sources } = fixture();
  const original = draft(file);
  original.open_questions = ["Which confirmed date should the public calendar show?"];
  publishFunctionalSpec(root, JSON.stringify(original), sources);
  const { currentDigest, resolveDecision, reviseDecision, featureStatus } =
    require("../packages/spec-engine/src/lifecycle");
  resolveDecision(root, { slug: original.slug, id: "Q-001",
    answer: "Show the date only after the organizer confirms it.", reviewer: "Product owner" });
  reviseDecision(root, { slug: original.slug, id: "Q-001",
    answer: "Show the date when it is confirmed by the organizer.", reviewer: "Product owner",
    confirmSha256: currentDigest(root, original.slug, "specification") });
  const changed = structuredClone(original);
  changed.open_questions = ["Which registration destination should the public page display?"];
  await publishFunctionalSpecWithApproval(root, JSON.stringify(changed), sources, {},
    async revision => revision.decision_history.history_entries === 1);
  const directory = "docs/specifications/proposed/league-public-participation";
  const decisions = JSON.parse(fs.readFileSync(path.join(root, `${directory}/decisions.json`), "utf8"));
  const current = decisions.find(decision => decision.status !== "historical");
  const historical = decisions.find(decision => decision.status === "historical");
  assert.equal(current.question, changed.open_questions[0]);
  assert.equal(current.id, "Q-002");
  assert.equal(historical.id, "Q-001");
  assert.equal(historical.question, original.open_questions[0]);
  assert.equal(historical.answer, "Show the date when it is confirmed by the organizer.");
  assert.equal(historical.history.length, 1);
  assert.equal(featureStatus(root, original.slug).pending_decisions, 1);
  const markdown = fs.readFileSync(path.join(root, `${directory}/decisions.md`), "utf8");
  assert.match(markdown, /Historical, not mapped to a current question/);
  assert.match(markdown, /Show the date when it is confirmed by the organizer/);
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
    [(data) => { data.use_cases[0].dependencies = ["UC-999"]; }, /Invalid prerequisite/],
    [(data) => { data.use_cases[0].dependencies = ["UC-001"]; }, /Invalid prerequisite/],
  ]) {
    const data = draft(file);
    modify(data);
    assert.throws(() => publishFunctionalSpec(root, JSON.stringify(data), sources), message);
    assert.equal(fs.existsSync(path.join(root, "docs/specifications/proposed/league-public-participation")), false);
  }
  assert.throws(() => validateFunctionalSpec(root, "Discovery completed; please fill in the templates.", sources), /incomplete/);
  fs.appendFileSync(path.join(root, file), "\nChanged business rules.\n");
  assert.throws(() => validateFunctionalSpec(root, JSON.stringify(draft(file)), sources), /source changed/);
});

test("atomic specifications have short capability names, navigable prerequisites and one public index", () => {
  const { root, file } = fixture();
  fs.writeFileSync(path.join(root, file), "# About us\n\n## Staff\nVisitors can read staff profiles.\n\n## Ambassadors\nVisitors can read ambassador profiles.\n");
  const sources = prepareFunctionalSources(root, [file]);
  const document = draft(file);
  document.slug = "about-us";
  document.title = "About the organization";
  document.open_questions = [];
  document.use_cases = ["staff", "ambassador"].map((role, index) => ({
    ...document.use_cases[0], id: `UC-00${index + 1}`, slug: `about-us-${role}`,
    title: `Browse the ${role} profiles`, goal: `Read the published ${role} profiles.`,
    dependencies: index ? ["UC-001"] : [],
    evidence: [{ path: file, line: index ? 7 : 4,
      quote: index ? "Visitors can read ambassador profiles." : "Visitors can read staff profiles." }],
  }));
  document.coverage = [3, 6].map((line, index) => ({
    path: file, line, status: "covered", use_cases: [`UC-00${index + 1}`],
    reason: "The corresponding public profile capability covers this section.",
  }));
  const result = publishFunctionalSpec(root, JSON.stringify(document), sources);
  assert.deepEqual(result.casePaths, [
    "docs/specifications/proposed/about-us/about-us-staff.md", "docs/specifications/proposed/about-us/about-us-ambassador.md",
  ]);
  const dependent = fs.readFileSync(path.join(root, result.casePaths[1]), "utf8");
  assert.match(dependent, /\[UC-001\]\(about-us-staff\.md\)/);
  assert.doesNotMatch(dependent, /\]\(UC-\d{3}\.md\)/);
  const index = fs.readFileSync(path.join(root, result.workspacePath), "utf8");
  assert.match(index, /\[about-us-staff\]\(proposed\/about-us\/about-us-staff\.md\)/);
  assert.match(index, /\[about-us-ambassador\]\(proposed\/about-us\/about-us-ambassador\.md\)/);
  assert.match(index, /same product workspace for greenfield and brownfield/i);
  assert.equal(fs.existsSync(path.join(root, "specs")), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, result.manifestPath), "utf8"));
  assert.equal(manifest.cases[0].id, "UC-001");
  assert.equal(manifest.cases[0].name, "about-us-staff");
});

test("naming rejects ambiguous, internal, reserved and overlong names before writing any artifacts", () => {
  const { root, file, sources } = fixture();
  for (const name of ["brownfield-staff", "greenfield-staff", "staff-part-1", "staff-abcdef123456",
    "manifest", "spec", "con", "com1", "../staff", "staff_ambassador", "a".repeat(65),
    "one-two-three-four-five-six-seven-eight-nine", "UC-001", "uc-001"]) {
    const document = draft(file);
    document.use_cases[0].slug = name;
    assert.throws(() => publishFunctionalSpec(root, JSON.stringify(document), sources), /structured deliverable/);
  }
  const duplicate = draft(file);
  duplicate.use_cases.push({ ...duplicate.use_cases[0], id: "UC-002" });
  assert.throws(() => publishFunctionalSpec(root, JSON.stringify(duplicate), sources), /duplicate atomic specification names/);
  const internal = draft(file);
  internal.slug = "brownfield-staff-abcdef123456";
  assert.throws(() => publishFunctionalSpec(root, JSON.stringify(internal), sources), /feature slug/);
  assert.equal(fs.existsSync(path.join(root, "docs/specifications/proposed/league-public-participation")), false);
  const legacyResponse = draft(file);
  delete legacyResponse.use_cases[0].slug;
  assert.deepEqual(publishFunctionalSpec(root, JSON.stringify(legacyResponse), sources).casePaths,
    ["docs/specifications/proposed/league-public-participation/check-team-registration-availability.md"]);
});

test("generic greenfield includes all seven product documents, not only keyword top-five matches", () => {
  const { root, file } = fixture();
  for (let index = 2; index <= 7; index += 1) {
    fs.writeFileSync(path.join(root, `knowledge/sources/business/requirements-${index}.md`),
      `# Product requirement ${index}\n\nConfirmed functional requirement number ${index} for an unrelated library product.\n`);
  }
  syncProject(root);
  const plan = routeTask(root, "Haz el greenfield con la documentacion del proyecto");
  assert.equal(plan.functional_specification.mode, "greenfield");
  assert.equal(plan.knowledge.length, 7);
  assert.ok(plan.knowledge.every((source) => source.selection === "product-documentation"));
  const scoped = routeTask(root, `Draft functional specifications from ${file}`);
  assert.deepEqual(scoped.knowledge.map((source) => source.source_path), [file]);
});

test("revising a functional proposal routes to specification authoring, not task generation", () => {
  const { root, file, sources } = fixture();
  syncProject(root);
  const proposal = draft(file);
  publishFunctionalSpec(root, JSON.stringify(proposal), sources, { automatic: true, proposalOnly: true });

  const plan = routeTask(root,
    `Revisa y actualiza la propuesta funcional ${proposal.slug} para resolver su deriva; no generes plan ni tareas.`);
  assert.equal(plan.specification_workspace.requested_stage, "specification");
  assert.equal(plan.functional_specification.status, "authoring-required; static discovery is not the deliverable");
  assert.equal(plan.workflow.id, "refine-backlog");
});

test("unconverted documentation blocks generic and explicitly scoped authoring without silent omissions", () => {
  const { root, file } = fixture();
  const original = "knowledge/sources/business/library.docx";
  fs.writeFileSync(path.join(root, original), Buffer.from([0x50, 0x4b, 0, 1]));
  syncProject(root, { tools: [], graphify: { installed: false } });
  assert.throws(() => routeTask(root, "Haz el greenfield con la documentacion"), /library\.docx \(requires-tool\)/);
  assert.throws(() => routeTask(root, `Draft functional specifications from ${original}`), /library\.docx \(requires-tool\)/);
  assert.equal(routeTask(root, `Draft functional specifications from ${file}`).knowledge.length, 1);
});

test("documentation-only projects remain greenfield with npm-init metadata and no application code", () => {
  const { root } = fixture();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "unrelated-library", version: "1.0.0",
    scripts: { test: 'echo "Error: no test specified" && exit 1' },
  }));
  syncProject(root);
  assert.equal(detectProjectCapabilities(root, readCatalog().catalog).has_code_signals, false);
  assert.equal(routeTask(root, "haz el greenfield").functional_specification.mode, "greenfield");
});

test("a non-League greenfield routes and executes through independent case files with working links and dependency checks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-library-atomic-"));
  roots.push(root);
  initializeProject(root);
  const file = "knowledge/sources/business/library.md";
  fs.writeFileSync(path.join(root, file), "# Public library\n\n## Search\nReaders can search the public catalog without signing in.\n\n## Borrowing\nMembers must confirm an available copy before requesting a loan.\n");
  syncProject(root);
  const sources = prepareFunctionalSources(root, [file]);
  const data = draft(file);
  data.title = "Public library functional specifications";
  data.slug = "public-library";
  data.summary = "Let readers discover books and request available copies without assuming a registration process.";
  data.scope = ["Search the public book catalog and request an available library copy."];
  data.non_goals = ["Do not implement payment, delivery or administrative operations."];
  data.actors = [{ id: "ACT-001", name: "Library reader", goal: "Discover and borrow an available library book." }];
  const search = data.use_cases[0];
  Object.assign(search, {
    slug: "catalog-search", title: "Search the public book catalog", goal: "Find a book in the public library catalog.",
    trigger: "The reader submits a catalog search.",
    preconditions: ["The public catalog is available."],
    main_flow: ["The reader supplies a book title.", "The catalog shows matching books."],
    alternatives: ["No matches are displayed as an explicit no-results state."],
    postconditions: ["The reader sees available catalog matches without signing in."],
    rules: ["Public searching does not require the reader to sign in."],
    acceptance_criteria: [{ given: "A reader has not signed in.", when: "They search for a title.", then: "Public catalog search remains accessible." }],
    evidence: [{ path: file, line: 4, quote: "Readers can search the public catalog without signing in." }],
  });
  const borrowing = structuredClone(search);
  Object.assign(borrowing, {
    id: "UC-002", slug: "loan-request", title: "Request an available book copy", goal: "Request a loan of one available book copy.",
    dependencies: ["UC-001"], open_questions: ["How long may an eligible member retain a borrowed copy?"],
    trigger: "The member selects an available book copy.",
    preconditions: ["The reader is a member and a copy is available."],
    main_flow: ["The member confirms the selected copy is available.", "The member requests the loan."],
    alternatives: ["A copy no longer available cannot be requested."],
    postconditions: ["The requested loan identifies the selected available copy."],
    rules: ["A member must confirm copy availability before requesting a loan."],
    acceptance_criteria: [{ given: "A member has selected an available copy.", when: "They confirm availability and request a loan.", then: "The request identifies that available copy." }],
    evidence: [{ path: file, line: 7, quote: "Members must confirm an available copy before requesting a loan." }],
  });
  data.use_cases.push(borrowing);
  data.coverage[0].reason = "Public catalog searching is specified in UC-001.";
  data.coverage[1].reason = "Available-copy loan requests are specified in UC-002.";
  data.coverage[1].use_cases = ["UC-002"];
  data.open_questions = [];
  const cycle = structuredClone(data);
  cycle.use_cases[0].dependencies = ["UC-002"];
  assert.throws(() => publishFunctionalSpec(root, JSON.stringify(cycle), sources), /Cyclic use-case prerequisites/);
  const unknown = structuredClone(data);
  unknown.use_cases[1].dependencies = ["UC-099"];
  assert.throws(() => publishFunctionalSpec(root, JSON.stringify(unknown), sources), /Invalid prerequisite use case in UC-002/);
  const plan = routeTask(root, "Run the greenfield process using the project documentation; stop at atomic use-case specifications.");
  assert.equal(plan.functional_specification.mode, "greenfield");
  assert.deepEqual(plan.knowledge.map((source) => source.source_path), [file]);
  const execution = await runCopilotTask(root, "Run the greenfield process using the project documentation", plan, {
    approved: true,
    clientFactory: () => ({
      async start() {}, async stop() {},
      async createSession() {
        return {
          sessionId: "20000000-0000-4000-8000-000000000004",
          async sendAndWait({ prompt }) {
            assert.match(prompt, /one independent Markdown specification per use case/);
            assert.match(prompt, /one business goal|exactly one business goal/);
            assert.match(prompt, /library\.md/);
            return { data: { content: JSON.stringify(data) } };
          },
          async disconnect() {},
        };
      },
    }),
  });
  const result = publishFunctionalSpec(root, JSON.stringify(data), sources);
  assert.deepEqual(execution.specification.casePaths, result.casePaths);
  assert.equal(result.casePaths.length, 2);
  assert.equal(result.unresolvedDecisions, 1);
  for (const [index, casePath] of result.casePaths.entries()) {
    const markdown = fs.readFileSync(path.join(root, casePath), "utf8");
    const other = index === 0 ? borrowing : search;
    assert.ok(!markdown.includes(`### ${other.id}`));
    for (const match of markdown.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(casePath), decodeURIComponent(match[1]))), match[1]);
    }
  }
  const first = path.join(root, result.casePaths[0]);
  fs.appendFileSync(first, "\nOwner clarification.\n");
  const originalIndex = fs.readFileSync(path.join(root, result.path), "utf8");
  assert.throws(() => publishFunctionalSpec(root, JSON.stringify(data), sources), /requires explicit confirmation/);
  assert.equal(fs.readFileSync(path.join(root, result.path), "utf8"), originalIndex);
  assert.match(fs.readFileSync(first, "utf8"), /Owner clarification/);
});

test("any atomic file conflict preserves the entire existing bundle before new files are written", () => {
  const { root, file, sources } = fixture();
  const data = draft(file);
  const directory = `docs/specifications/proposed/${data.slug}`;
  fs.mkdirSync(path.join(root, directory), { recursive: true });
  const existing = path.join(root, directory, "registration-status.md");
  fs.writeFileSync(existing, "An owner-authored case must not be overwritten.");
  assert.throws(() => publishFunctionalSpec(root, JSON.stringify(data), sources), /registration-status\.md already exists/);
  assert.equal(fs.readFileSync(existing, "utf8"), "An owner-authored case must not be overwritten.");
  assert.equal(fs.existsSync(path.join(root, directory, "spec.md")), false);
  assert.equal(fs.existsSync(path.join(root, directory, "manifest.json")), false);
});

test("oversized product documentation fails before a paid SDK session", async () => {
  const { root, file } = fixture();
  fs.writeFileSync(path.join(root, file), "x".repeat(2 * 1024 * 1024 + 1));
  let started = false;
  await assert.rejects(runCopilotTask(root, "haz el greenfield", {
    workflow: { id: "refine-backlog" }, agent: { id: "product" }, knowledge: [{ source_path: file }],
  }, { approved: true, clientFactory: () => { started = true; } }), /exceed the 2 MiB limit/);
  assert.equal(started, false);
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

test("ordinary specification execution applies bounded repairs to its last complete base", async () => {
  const { root, file } = fixture();
  const valid = draft(file);
  const invalid = structuredClone(valid);
  invalid.use_cases[0].evidence[0].line = 5;
  const responses = [
    JSON.stringify(invalid),
    JSON.stringify({ replacements: [{ path: "/unknown", value: "not allowed" }] }),
    JSON.stringify({ replacements: [{ path: "/use_cases/0/evidence", value: valid.use_cases[0].evidence }] }),
  ];
  const prompts = [];
  const client = {
    async start() {},
    async stop() {},
    async createSession() {
      return {
        sessionId: "20000000-0000-4000-8000-900000000001",
        async sendAndWait(message) {
          prompts.push(message.prompt);
          return { data: { content: responses.shift() } };
        },
        async disconnect() {},
      };
    },
  };
  const result = await runCopilotTask(root, "Draft functional specifications", {
    workflow: { id: "refine-backlog" }, agent: { id: "product" }, knowledge: [{ source_path: file }],
  }, { approved: true, clientFactory: () => client });
  assert.equal(prompts.length, 3);
  assert.match(prompts[1], /Return only \{"replacements"/);
  assert.match(prompts[2], /later malformed responses do not replace it/);
  assert.match(prompts[2], /Repair must replace an existing own field/);
  const published = JSON.parse(fs.readFileSync(path.join(root,
    path.posix.dirname(result.specification.path), "specification.json"), "utf8"));
  assert.deepEqual(published, valid);
  assert.equal(result.specification.status, "draft-structurally-validated");
});

test("the executor persists a validated deliverable and fails instead of reporting empty-template success", async () => {
  const { root, file } = fixture();
  let response = "Static discovery completed.";
  let prompt;
  const prompts = [];
  let disconnected = 0;
  let sessionCount = 0;
  const client = {
    async start() {},
    async stop() {},
    async createSession() {
      return {
        sessionId: `20000000-0000-4000-8000-${String(++sessionCount).padStart(12, "0")}`,
        async sendAndWait(message) { prompt = message.prompt; prompts.push(prompt); return { data: { content: response } }; },
        async disconnect() { disconnected += 1; },
      };
    },
  };
  const plan = { workflow: { id: "refine-backlog" }, agent: { id: "product" }, knowledge: [{ source_path: file }] };
  await assert.rejects(runCopilotTask(root, "Draft functional specifications", plan,
    { approved: true, clientFactory: () => client }), /specification incomplete/);
  assert.match(prompts[0], /Static discovery is an evidence inventory, NOT the requested deliverable/);
  assert.match(prompts[0], /Do not implement application code/);
  assert.equal(prompts.length, 3);
  assert.match(prompt, /Exact validator diagnostic/);
  response = JSON.stringify(draft(file));
  const result = await runCopilotTask(root, "Draft functional specifications", plan,
    { approved: true, clientFactory: () => client });
  assert.equal(disconnected, 2);
  assert.equal(result.specification.status, "draft-structurally-validated");
  const directory = path.posix.dirname(result.specification.path);
  assert.deepEqual(result.changedPaths, [result.specification.path, result.specification.manifestPath,
    result.specification.workspacePath, `${directory}/decisions.json`, `${directory}/decisions.md`,
    `${directory}/lifecycle.json`, `${directory}/specification.json`, ...result.specification.casePaths].sort());
  assert.match(fs.readFileSync(path.join(root, result.specification.casePaths[0]), "utf8"), /Registration remains closed|registration remains closed/);
});

test("functional routing takes priority over document and frontend keywords", () => {
  const { root, file } = fixture();
  syncProject(root);
  const plan = routeTask(root, "Prepara las especificaciones funcionales greenfield de la web a partir del documento");
  assert.equal(plan.agent.id, "product");
  assert.equal(plan.functional_specification.mode, "greenfield");
  assert.ok(plan.skills.some(({ id }) => id === "requirements-discovery"));
  assert.equal(plan.knowledge[0].source_path, file);
  assert.equal(plan.knowledge_graph_status.codegraph, "not-applicable-documentation-only");
});
