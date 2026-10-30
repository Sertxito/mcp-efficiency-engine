"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { evaluateAssetResponse } = require("../packages/evaluation-engine/src/asset-evaluation");
const {
  GENERATED_MARKER, detectProjectCapabilities, readCatalog, renderCatalog,
} = require("../packages/copilot-renderer/src/render");

function project(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-guidance-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

function guide(root, id) {
  return fs.readFileSync(path.join(root,
    `.github/instructions/mcpee-stack-${id}.instructions.md`), "utf8");
}

function scopes(markdown) {
  return JSON.parse(markdown.match(/^applyTo: (.+)$/m)[1]).split(",");
}

function detectedGuides(root) {
  return detectProjectCapabilities(root, readCatalog().catalog).assets.technical_guidance.sort();
}

function matches(globs, file) {
  return globs.some(glob => path.posix.matchesGlob(file, glob));
}

test("mixed C# and Python receive independent exact file/config scopes", t => {
  const root = project(t, {
    "api/app.csproj": "<Project />",
    "jobs/worker.py": "pass",
    "jobs/pyproject.toml": '[project]\nname = "jobs"\n',
  });
  renderCatalog(root);
  assert.deepEqual(detectedGuides(root),
    ["dotnet-csharp", "python-engineering"]);
  const csharp = scopes(guide(root, "dotnet-csharp"));
  const python = scopes(guide(root, "python-engineering"));
  for (const file of ["jobs/worker.py", "worker.pyi", "pyproject.toml",
    "jobs/requirements-dev.txt", "setup.cfg", "tox.ini"]) {
    assert.ok(matches(python, file), file);
    assert.equal(matches(csharp, file), false, file);
  }
  for (const file of ["api/Controller.cs", "api/app.csproj", "global.json",
    "ui/View.xaml", "ui/Index.razor", "ui/Index.cshtml"]) {
    assert.ok(matches(csharp, file), file);
    assert.equal(matches(python, file), false, file);
  }
  assert.equal(matches(python, "some.pyproject.toml"), false);
  assert.equal(renderCatalog(root).counts.updated, 0);
});

test("Angular and React guidance stays independent without assuming Node backend", t => {
  const root = project(t, { "package.json": JSON.stringify({
    dependencies: { "@angular/core": "19.0.0", react: "19.0.0" },
  }) });
  renderCatalog(root);
  assert.deepEqual(detectedGuides(root),
    ["angular-engineering", "react-engineering", "typescript-engineering"]);
  assert.ok(matches(scopes(guide(root, "angular-engineering")), "app/template.html"));
  assert.equal(matches(scopes(guide(root, "react-engineering")), "app/template.html"), false);
  assert.ok(matches(scopes(guide(root, "react-engineering")), "app/Widget.tsx"));
  assert.ok(matches(scopes(guide(root, "typescript-engineering")), "tsconfig.app.json"));
  assert.equal(matches(scopes(guide(root, "typescript-engineering")), "app/service.py"), false);
});

test("Vue and Nuxt activate actual frontend guidance, tests and evidence contracts", t => {
  for (const files of [
    { "package.json": JSON.stringify({ dependencies: { vue: "3.5.0" } }) },
    { "package.json": JSON.stringify({ dependencies: { nuxt: "4.0.0" } }) },
    { "src/Widget.vue": "<template><button>Save</button></template>" },
  ]) {
    const root = project(t, files);
    const result = renderCatalog(root);
    const capabilities = result.capabilities;
    assert.deepEqual(capabilities.detected_technologies.map(item => item.id), ["vue"]);
    assert.ok(capabilities.has_code_signals);
    assert.ok(capabilities.assets.agents.includes("frontend"));
    assert.ok(capabilities.assets.agents.includes("ux-ui"));
    assert.deepEqual(detectedGuides(root),
      ["typescript-engineering", "vue-engineering"]);
    assert.ok(capabilities.assets.eval_cases.includes("frontend-framework-fit"));
    assert.ok(capabilities.assets.scorecards.includes("frontend-quality"));
    assert.ok(capabilities.assets.prompt_examples.includes("frontend-change-example"));
    assert.ok(matches(scopes(guide(root, "vue-engineering")), "src/Widget.vue"));
    assert.equal(matches(scopes(guide(root, "vue-engineering")), "src/service.py"), false);
    assert.match(guide(root, "vue-engineering"), /scoped-style/);
  }
});

test("SQL and Cosmos guidance is detected from the corresponding stack regardless of local installation", t => {
  const sql = project(t, { "db/schema.sql": "SELECT 1;" });
  renderCatalog(sql);
  assert.deepEqual(detectedGuides(sql),
    ["sql-engineering"]);
  const cosmos = project(t, { "package.json": JSON.stringify({
    dependencies: { "@azure/cosmos": "4.0.0" },
  }) });
  renderCatalog(cosmos);
  const selected = detectedGuides(cosmos);
  assert.ok(selected.includes("cosmos-engineering"));
  assert.ok(!selected.includes("sql-engineering"));
  assert.ok(!selected.includes("python-engineering"));
});

test("IaC and pipelines use real configuration globs, not filename extensions", t => {
  const root = project(t, {
    "infra/main.bicep": "param location string",
    "infra/main.tf": "terraform {}",
    ".github/workflows/ci.yml": "name: CI",
  });
  const result = renderCatalog(root);
  for (const [id, good, bad] of [
    ["bicep-engineering", "infra/main.bicepparam", "infra/main.tf"],
    ["terraform-engineering", "infra/.terraform.lock.hcl", "infra/main.bicep"],
    ["yaml-pipelines-engineering", ".github/workflows/ci.yml", "data/content.yaml"],
    ["azure-engineering", "host.json", "data/content.json"],
  ]) {
    assert.ok(result.capabilities.assets.technical_guidance.includes(id));
    const globs = scopes(guide(root, id));
    assert.ok(matches(globs, good), good);
    assert.equal(matches(globs, bad), false, bad);
  }
});

test("parameter-only and Azure pipeline projects activate the matching guide", t => {
  for (const [file, technology, guidance] of [
    ["infra/main.bicepparam", "bicep", "bicep-engineering"],
    ["infra/main.tf.json", "terraform", "terraform-engineering"],
    ["azure-pipelines.release.yaml", "yaml-pipelines", "yaml-pipelines-engineering"],
  ]) {
    const root = project(t, { [file]: "" });
    const result = renderCatalog(root);
    assert.ok(result.capabilities.detected_technologies.some(item => item.id === technology));
    assert.ok(result.capabilities.assets.technical_guidance.includes(guidance));
    assert.ok(matches(scopes(guide(root, guidance)), file));
  }
});

test("combined installed overrides refresh to split guides and persist removal intent", t => {
  for (const [old, replacements] of Object.entries({
    "backend-dotnet-python-node": ["dotnet-csharp", "python-engineering", "node-engineering", "typescript-engineering"],
    "frontend-angular-react": ["angular-engineering", "react-engineering", "typescript-engineering"],
    "data-sql-server-cosmos": ["sql-engineering", "cosmos-engineering"],
    "iac-and-yaml": ["bicep-engineering", "terraform-engineering", "yaml-pipelines-engineering"],
  })) {
    for (const mode of ["added", "removed"]) {
      const root = project(t, {
        ...(mode === "removed" ? {
          "api.csproj": "<Project />", "worker.py": "pass",
          "package.json": JSON.stringify({ dependencies: {
            "@angular/core": "19.0.0", react: "19.0.0", express: "5.0.0",
            "@azure/cosmos": "4.0.0",
          } }),
          "main.tf": "terraform {}", "main.bicep": "param location string",
          "schema.sql": "SELECT 1;", ".github/workflows/ci.yml": "name: CI",
        } : {}),
        ".mcpee/state/catalog-capabilities.json": JSON.stringify({
          schema_version: 1, generated_by: "mcpee",
          overrides: { "technical-guidance": {
            added: mode === "added" ? [old] : [],
            removed: mode === "removed" ? [old] : [],
          } },
        }),
      });
      const result = renderCatalog(root);
      assert.deepEqual(result.capability_state.overrides["technical-guidance"][mode], replacements);
      for (const id of replacements) {
        assert.equal(result.capabilities.assets.technical_guidance.includes(id), mode === "added");
      }
      const persisted = JSON.parse(fs.readFileSync(
        path.join(root, ".mcpee/state/catalog-capabilities.json"), "utf8"));
      assert.deepEqual(persisted.overrides, result.capability_state.overrides);
    }
  }
});

test("refresh removes obsolete owned guides but preserves user-authored instructions", t => {
  const obsolete = ".github/instructions/mcpee-stack-backend-dotnet-python-node.instructions.md";
  const customized = ".github/instructions/mcpee-stack-frontend-angular-react.instructions.md";
  const root = project(t, {
    [obsolete]: `${GENERATED_MARKER}\nold guide`,
    [customized]: "user guidance\n",
    ".mcpee/generated/catalog-manifest.json": JSON.stringify({
      generated_by: "mcpee", files: [obsolete, customized],
    }),
  });
  renderCatalog(root);
  assert.equal(fs.existsSync(path.join(root, obsolete)), false);
  assert.equal(fs.readFileSync(path.join(root, customized), "utf8"), "user guidance\n");
});

test("every role references the same common contracts without copied policy bodies", t => {
  const root = project(t, { "app.csproj": "<Project />", "app.py": "pass" });
  const { catalog } = readCatalog();
  renderCatalog(root, { capabilityState: {
    schema_version: 1, generated_by: "mcpee",
    overrides: { agent: { added: catalog.agents.map(agent => agent.id), removed: [] } },
  } });
  const directory = path.join(root, ".github/agents");
  assert.equal(fs.readdirSync(directory).length, catalog.agents.length);
  const policies = fs.readFileSync(path.join(root,
    ".github/instructions/mcpee-policies.instructions.md"), "utf8");
  assert.match(policies, /applyTo: "\*\*"/);
  for (const policy of catalog.policies) assert.ok(policies.includes(policy.description));
  for (const name of fs.readdirSync(directory)) {
    const content = fs.readFileSync(path.join(directory, name), "utf8");
    for (const match of content.matchAll(/\]\((\.\.\/instructions\/[^)]+)\)/g)) {
      assert.ok(fs.existsSync(path.resolve(directory, match[1])), match[1]);
    }
    assert.match(content, /mcpee-policies\.instructions\.md/);
    assert.match(content, /mcpee-catalog\.instructions\.md/);
    for (const policy of catalog.policies) assert.ok(!content.includes(policy.description));
  }
});

test("convention templates are discoverable but never activated and team copies survive refresh", t => {
  const { catalog } = readCatalog();
  const templates = [
    ["organization-conventions", "organization.instructions.template.md", "organization.instructions.md"],
    ["project-conventions", "project.instructions.template.md", "project.instructions.md"],
    ["backend-csharp-conventions", "backend-csharp.instructions.template.md", "backend-csharp.instructions.md"],
  ];
  const files = { "src/backend/app.csproj": "<Project />" };
  for (const [id, source, destination] of templates) {
    const entry = catalog.templates.find(item => item.id === id);
    assert.equal(entry.path, `mcpee/templates/project-conventions/${source}`);
    const body = fs.readFileSync(path.resolve(__dirname,
      "../templates/project-conventions", source), "utf8");
    assert.match(body, /^---\r?\ndescription: ".+"\r?\napplyTo: ".+"\r?\n---/);
    assert.ok(!body.includes(GENERATED_MARKER));
    files[`.github/instructions/${destination}`] = body.replace(/\{\{[^}]+\}\}/g, "approved-example");
  }
  const root = project(t, files);
  const fresh = project(t, { "src/backend/app.csproj": "<Project />" });
  const result = renderCatalog(fresh);
  const templateCatalog = fs.readFileSync(path.join(fresh,
    ".mcpee/generated/catalog-templates.md"), "utf8");
  for (const [id, , destination] of templates) {
    assert.ok(result.capabilities.assets.templates.includes(id));
    assert.ok(templateCatalog.includes(`## ${id}\n`));
    assert.equal(fs.existsSync(path.join(fresh, ".github/instructions", destination)), false);
  }
  for (let refresh = 0; refresh < 2; refresh += 1) {
    renderCatalog(root);
    for (const [relative, content] of Object.entries(files)) {
      assert.equal(fs.readFileSync(path.join(root, relative), "utf8"), content);
    }
  }
  const example = fs.readFileSync(path.resolve(__dirname,
    "../templates/project-conventions/backend-csharp.instructions.template.md"), "utf8");
  const baseline = guide(fresh, "dotnet-csharp");
  for (const practice of [
    "Prefer constructor injection", "Singletons must be thread-safe",
    "BuildServiceProvider", "scope/build",
  ]) {
    assert.ok(baseline.includes(practice), practice);
    assert.equal(example.includes(practice), false, practice);
  }
  assert.ok(example.includes("{{registration_convention}}"));
  assert.ok(example.includes("{{composition_paths}}"));
  assert.match(baseline, /do not impose Add\{Feature\}/);
  const projectTemplate = files[".github/instructions/project.instructions.md"];
  assert.match(projectTemplate, /## Specification sources/);
  assert.match(projectTemplate, /instead of copying business rules/);
  const globs = scopes(example);
  assert.ok(matches(globs, "src/backend/Orders/Service.cs"));
  assert.ok(matches(globs, "tests/backend/CompositionTests.cs"));
  for (const file of ["src/backend/worker.py", "src/frontend/App.tsx", "src/other/Service.cs"]) {
    assert.equal(matches(globs, file), false, file);
  }
});

test("every stack ships a bounded working baseline rather than links alone", t => {
  const topics = {
    "dotnet-csharp": ["Types, collections and contracts", "Async, concurrency", "EF Core and persistence", "Hosting, configuration"],
    "python-engineering": ["iterator exhaustion", "cancellation", "installed-package"],
    "node-engineering": ["worker threads", "shutdown", "packed package"],
    "typescript-engineering": ["BigInt", "async forEach", "public type declarations"],
    "angular-engineering": ["source of truth", "form validation", "SSR requests"],
    "react-engineering": ["render snapshot", "Strict Mode", "error boundary"],
    "vue-engineering": ["ref versus reactive", "computed getters pure", "v-model"],
    "sql-engineering": ["three-valued logic", "NOT IN", "checkpoints"],
    "cosmos-engineering": ["transactional-batch", "429", "continuation tokens"],
    "terraform-engineering": ["for_each", "ignore_changes", "state backups"],
    "bicep-engineering": ["uniqueString", "dependsOn", "What-if"],
    "yaml-pipelines-engineering": ["pull_request_target", "cache poisoning", "cancelled jobs"],
    "azure-engineering": ["idempotency", "RTO/RPO", "data-plane authorization"],
    "aws-engineering": ["backoff/jitter", "cross-account", "post-change health"],
  };
  const { catalog } = readCatalog();
  assert.deepEqual(Object.keys(topics).sort(), catalog.technical_guidance.map(item => item.id).sort());
  const root = project(t, {});
  renderCatalog(root, { capabilityState: {
    schema_version: 1, generated_by: "mcpee",
    overrides: { "technical-guidance": { added: Object.keys(topics), removed: [] } },
  } });
  for (const entry of catalog.technical_guidance) {
    const source = fs.readFileSync(path.resolve(__dirname, "../",
      entry.source_path.replace(/^mcpee\//, "")), "utf8");
    assert.ok(Buffer.byteLength(source, "utf8") <= 16000, `${entry.id}: keep baseline bounded`);
    const generated = guide(root, entry.id);
    assert.ok(generated.includes(source.trim()), `${entry.id}: complete baseline generated`);
    for (const topic of topics[entry.id]) {
      assert.ok(source.replace(/\s+/g, " ").includes(topic), `${entry.id}: ${topic}`);
    }
  }
  const contract = fs.readFileSync(path.join(root,
    ".github/instructions/mcpee-catalog.instructions.md"), "utf8");
  assert.match(contract, /working baseline/);
  assert.match(contract, /uncovered, uncertain/);
  assert.match(contract, /disclose unavailable verification/);
});

test("catalog scopes and performance evidence gates remain explicit", () => {
  const { catalog } = readCatalog();
  for (const item of catalog.technical_guidance) {
    assert.ok(item.technologies.length);
    assert.ok(item.apply_to.length);
    assert.ok(item.apply_to.every(glob => glob.startsWith("**/") && glob !== "**/*"));
  }
  const performance = catalog.eval_cases.find(item => item.id === "performance-baseline-integrity");
  assert.deepEqual(performance.automated_checks.required_literals, [
    "Acceptance threshold:", "Baseline:", "Before/after:", "Correctness:",
    "Measurement limits:", "Outcome:",
  ]);
  const skill = fs.readFileSync(path.resolve(__dirname,
    "../skills/performance-investigation/SKILL.md"), "utf8");
  for (const literal of performance.automated_checks.required_literals) {
    assert.ok(skill.includes(literal), literal);
  }
  assert.match(skill, /inconclusive/);
  assert.match(skill, /sample count/);
  assert.match(skill, /stop\s+conditions/);
});

test("performance evaluation rejects missing measurement sections and still requires human review", t => {
  const root = project(t, { "response.md": "Baseline: 100 ms\nMeasurement limits: no repeat samples.\n" });
  const { catalog } = readCatalog();
  const evaluationCase = catalog.eval_cases.find(item => item.id === "performance-baseline-integrity");
  const scorecard = catalog.scorecards.find(item => item.id === evaluationCase.scorecard);
  const options = { evaluationCase, scorecard, assetId: "performance-forensics", responsePath: "response.md" };
  assert.equal(evaluateAssetResponse(root, options).status, "failed");
  fs.writeFileSync(path.join(root, "response.md"), [
    "Acceptance threshold: p95 below 150 ms; no error-rate increase.",
    "Baseline: proposed 20 repeated local runs; not yet executed.",
    "Before/after: unavailable, measurement not authorized.",
    "Correctness: checks not run.",
    "Measurement limits: no observed timings or artifacts.",
    "Outcome: inconclusive.",
  ].join("\n"));
  const result = evaluateAssetResponse(root, options);
  assert.ok(result.automated_assertions.every(item => item.status === "passed"));
  assert.equal(result.status, "awaiting-review");
});

test("recovered SQL and recovery skill bodies are installed and versioned with role consumers", t => {
  const root = project(t, {
    "schema.sql": "SELECT 1;", "infra/main.bicep": "param location string",
  });
  const result = renderCatalog(root);
  const { catalog } = readCatalog();
  for (const [id, expected] of [
    ["sql-performance-diagnosis", /sys\.dm_exec_query_stats/],
    ["recovery-rehearsal", /known recovery marker/],
  ]) {
    assert.ok(result.capabilities.assets.skills.includes(id));
    const body = fs.readFileSync(path.join(root, `.github/skills/mcpee-${id}/SKILL.md`), "utf8");
    assert.match(body, expected);
    assert.match(body, /approval/);
    assert.match(body, /inconclusive/);
    const entry = catalog.skills.find(skill => skill.id === id);
    for (const role of entry.used_by) {
      assert.ok(catalog.agents.find(agent => agent.id === role).skills.includes(id));
    }
  }
  assert.ok(result.capabilities.assets.eval_cases.includes("sql-diagnosis-evidence"));
  assert.ok(result.capabilities.assets.eval_cases.includes("recovery-rehearsal-evidence"));
});

test("recovered evaluation cases reject gaps without pretending literals prove SQL or recovery success", t => {
  const root = project(t, { "response.md": "No evidence collected." });
  const { catalog } = readCatalog();
  for (const [caseId, assetId, skillId] of [
    ["sql-diagnosis-evidence", "database", "sql-performance-diagnosis"],
    ["recovery-rehearsal-evidence", "observability", "recovery-rehearsal"],
  ]) {
    const evaluationCase = catalog.eval_cases.find(item => item.id === caseId);
    const scorecard = catalog.scorecards.find(item => item.id === evaluationCase.scorecard);
    const options = { evaluationCase, scorecard, assetId, responsePath: "response.md" };
    fs.writeFileSync(path.join(root, "response.md"), "No evidence collected.");
    assert.equal(evaluateAssetResponse(root, options).status, "failed");
    const skill = fs.readFileSync(path.resolve(__dirname, `../skills/${skillId}/SKILL.md`), "utf8");
    for (const literal of evaluationCase.automated_checks.required_literals) {
      assert.ok(skill.includes(literal), literal);
    }
    fs.writeFileSync(path.join(root, "response.md"),
      evaluationCase.automated_checks.required_literals.map(literal =>
        `${literal} not executed; access/approval missing; inconclusive.`).join("\n"));
    assert.equal(evaluateAssetResponse(root, options).status, "awaiting-review");
    fs.appendFileSync(path.join(root, "response.md"),
      `\n${evaluationCase.automated_checks.forbidden_literals[0]}`);
    assert.equal(evaluateAssetResponse(root, options).status, "failed");
  }
});
