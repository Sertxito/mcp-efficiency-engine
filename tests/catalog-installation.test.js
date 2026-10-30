"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test } = require("node:test");
const { initializeProject } = require("../packages/core/src/project");
const {
  CAPABILITY_COLLECTIONS,
  capabilityRegistry,
  installAllCapabilities,
  manageCapability,
  readCatalog,
  readInstalledCatalog,
  renderCatalog,
} = require("../packages/copilot-renderer/src/render");

const cli = path.resolve(__dirname, "../packages/cli/bin/mcpee.js");
const { catalog } = readCatalog();

function project(t) {
  const root = fs.mkdtempSync(path.join(__dirname, ".catalog-fixture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function assertFull(assets) {
  for (const collection of Object.values(CAPABILITY_COLLECTIONS)) {
    assert.deepEqual([...assets[collection]].sort(), catalog[collection].map((item) => item.id).sort(), collection);
  }
}

function stateText(root) {
  return fs.readFileSync(path.join(root, ".mcpee/state/catalog-capabilities.json"), "utf8");
}

function runCli(root, args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "capabilities", ...args, "--project", root], {
      env: {
        ...process.env,
        MCPEE_APPROVAL_BROKER_URL: "",
        MCPEE_APPROVAL_BROKER_TOKEN: "",
        ...environment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function withApproval(approved, run) {
  let requests = 0;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const approval = JSON.parse(body);
      assert.equal(approval.kind, "maintenance");
      assert.equal(approval.details.action, "install");
      assert.match(approval.details.description, /No workflow, tool installation, or model execution/);
      requests += 1;
      response.end(JSON.stringify({ approved }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run({
      MCPEE_APPROVAL_BROKER_URL: `http://127.0.0.1:${server.address().port}/approve`,
      MCPEE_APPROVAL_BROKER_TOKEN: "synthetic-catalog-test",
    });
    assert.equal(requests, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("new greenfield and brownfield projects install the full local catalog", (t) => {
  for (const withCode of [false, true]) {
    const root = project(t);
    if (withCode) fs.writeFileSync(path.join(root, "main.py"), "print('fixture')\n");
    const first = initializeProject(root);
    assertFull(first.catalog.capabilities.assets);
    assert.equal(first.catalog.capabilities.has_code_signals, withCode);
    assertFull(capabilityRegistry(root).assets);
    const installed = readInstalledCatalog(root);
    for (const collection of Object.values(CAPABILITY_COLLECTIONS)) {
      assert.equal(installed[collection].length, catalog[collection].length, collection);
    }
    for (const workflow of catalog.workflows) {
      const name = catalog.skills.some((item) => item.id === workflow.id)
        ? `mcpee-workflow-${workflow.id}` : `mcpee-${workflow.id}`;
      const skill = fs.readFileSync(path.join(root, ".github/skills", name, "SKILL.md"), "utf8");
      assert.match(skill, /disable-model-invocation: true/);
    }
    const second = initializeProject(root);
    assert.equal(second.catalog.counts.created, 0);
    assert.equal(second.catalog.counts.updated, 0);
  }
});

test("explicit agent selections and prior removals survive repeated initialization", (t) => {
  for (const agents of [[], ["product"], catalog.agents.map((agent) => agent.id)]) {
    const root = project(t);
    initializeProject(root, { initialAgents: agents });
    const before = capabilityRegistry(root).assets;
    assert.deepEqual(before.agents, [...new Set(["orchestrator", ...agents])].sort());
    initializeProject(root);
    assert.deepEqual(capabilityRegistry(root).assets, before);
  }
  const root = project(t);
  initializeProject(root, { initialAgents: ["product"] });
  manageCapability(root, "remove", "agent", "product");
  const before = stateText(root);
  initializeProject(root);
  assert.equal(stateText(root), before);
  assert.deepEqual(capabilityRegistry(root).assets.agents, ["orchestrator"]);
});

test("legacy catalogs without selection state retain detected defaults on refresh", (t) => {
  const root = project(t);
  initializeProject(root, { initialAgents: ["product"] });
  fs.unlinkSync(path.join(root, ".mcpee/state/catalog-capabilities.json"));
  renderCatalog(root);
  assert.ok(capabilityRegistry(root).items.some((item) => item.type === "agent" && item.status === "available"));
});

test("bulk install restores full catalog removals, preserves user customizations and is repeatable", (t) => {
  const root = project(t);
  initializeProject(root, { initialAgents: ["product"] });
  const custom = path.join(root, ".github/agents/mcpee-backend.agent.md");
  fs.writeFileSync(custom, "# User-owned backend\n");
  const result = installAllCapabilities(root);
  assertFull(result.assets);
  assert.ok(result.newly_installed > 0);
  assert.ok(result.changes.preserved > 0);
  assert.equal(fs.readFileSync(custom, "utf8"), "# User-owned backend\n");
  const again = installAllCapabilities(root);
  assert.equal(again.newly_installed, 0);
  assert.equal(again.changes.created, 0);
  assertFull(again.assets);
});

test("typed bulk install restores dependencies without resetting unrelated exclusions", (t) => {
  const root = project(t);
  initializeProject(root, { initialAgents: [] });
  const result = installAllCapabilities(root, "agent");
  assert.equal(result.assets.agents.length, catalog.agents.length);
  for (const agent of catalog.agents) {
    for (const id of agent.skills) assert.ok(result.assets.skills.includes(id), id);
    for (const id of agent.patterns || []) assert.ok(result.assets.patterns.includes(id), id);
  }
  const state = JSON.parse(stateText(root));
  state.overrides.template = { added: [], removed: [catalog.templates[0].id] };
  renderCatalog(root, { capabilityState: state });
  installAllCapabilities(root, "skill");
  assert.equal(capabilityRegistry(root).assets.templates.includes(catalog.templates[0].id), false);
  assert.throws(() => installAllCapabilities(root, "invalid"), /Unknown installable capability type/);
});

test("bulk CLI installation requires maintenance approval and reports exact local changes", async (t) => {
  const root = project(t);
  initializeProject(root, { initialAgents: ["product"] });
  const before = stateText(root);
  const denied = await runCli(root, ["install", "all"]);
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /non-interactive approval is denied/);
  assert.equal(stateText(root), before);
  await withApproval(false, async (environment) => {
    const result = await runCli(root, ["install", "all"], environment);
    assert.equal(result.status, 1);
    assert.equal(stateText(root), before);
  });
  await withApproval(true, async (environment) => {
    const result = await runCli(root, ["install", "all"], environment);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scope=all; selected=\d+; newly installed including dependencies=\d+/);
    assert.match(result.stdout, /preserved=\d+/);
    assert.match(result.stdout, /Installation does not execute agents or workflows/);
    assertFull(capabilityRegistry(root).assets);
  });
});

test("bulk CLI accepts type aliases, leaves unrelated agents uninstalled and rejects invalid types", async (t) => {
  const root = project(t);
  initializeProject(root, { initialAgents: [] });
  await withApproval(true, async (environment) => {
    const result = await runCli(root, ["install", "all", "--type", "skills"], environment);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scope=skill/);
    assert.equal(capabilityRegistry(root).assets.skills.length, catalog.skills.length);
    assert.deepEqual(capabilityRegistry(root).assets.agents, ["orchestrator"]);
  });
  for (const type of ["invalid", "policies", ""]) {
    const result = await runCli(root, ["install", "all", "--type", type]);
    assert.equal(result.status, 2, result.stderr);
  }
});
