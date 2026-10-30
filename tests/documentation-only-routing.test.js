"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { initializeProject } = require("../packages/core/src/project");
const { syncProject } = require("../packages/source-engine/src/sync");
const { routeTask } = require("../packages/routing-engine/src/route");
const { updateCodeGraph } = require("../packages/knowledge-engine/src/codegraph");
const { runCopilotTask } = require("../packages/execution-engine/src/copilot");
const { readEvents } = require("../packages/core/src/telemetry");

const cli = path.join(__dirname, "../packages/cli/bin/mcpee.js");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-docs-without-git-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  fs.writeFileSync(path.join(root, "knowledge/sources/business/catalog.md"),
    "# Catalog architecture\n\nReaders search a public catalog without signing in.\n");
  fs.writeFileSync(path.join(root, "package.json"),
    JSON.stringify({ dependencies: { "mcp-efficiency-engine": "^0.1.40" } }));
  fs.writeFileSync(path.join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(root, ".mcpee/state/codegraph.json"),
    JSON.stringify({ generated_by: "mcpee", status: "failed", error: "spawnSync node.exe ETIMEDOUT" }));
  syncProject(root);
  return root;
}

test("architecture and discovery route without Git or CodeGraph despite changed harness metadata", async (t) => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, "package-lock.json"), "\n");
  for (const task of ["Proponer la arquitectura del catalogo", "Understand the project",
    "Review catalog architecture and package-lock.json"]) {
    const plan = routeTask(root, task);
    assert.equal(plan.project_stack.has_code_signals, false);
    assert.equal(plan.knowledge_graph_status.codegraph, "not-applicable-documentation-only");
    assert.ok(plan.impact_preflight.targets.every((item) => item.source_path !== "package-lock.json"));
  }
  const plan = routeTask(root, "Proponer la arquitectura del catalogo");
  let prompt;
  const result = await runCopilotTask(root, "Proponer la arquitectura del catalogo", plan, {
    approved: true,
    clientFactory: () => ({
      async start() {},
      async createSession() {
        return {
          sessionId: "documentation-only-fixture",
          on() {},
          async sendAndWait(message) {
            prompt = message.prompt;
            fs.writeFileSync(path.join(root, "docs/architecture-proposal.md"),
              "# Architecture proposal\n\nPublic read-only catalog; no authentication for search.\n");
            return { data: { content: "Architecture draft created; not approved or implemented." } };
          },
          async disconnect() {},
        };
      },
      async stop() {},
    }),
  });
  assert.match(result.content, /Architecture draft created/);
  assert.match(prompt, /Git is optional/);
  assert.match(prompt, /do not require a CodeGraph index/);
  assert.ok(fs.existsSync(path.join(root, "docs/architecture-proposal.md")));
  assert.equal(fs.existsSync(path.join(root, ".git")), false);
});

test("documentation sync and doctor succeed without starting CodeGraph or erasing its index state", (t) => {
  const root = fixture(t);
  const before = fs.readFileSync(path.join(root, ".mcpee/state/codegraph.json"), "utf8");
  const result = updateCodeGraph(root, { documentationOnly: true, available: true, required: true });
  assert.equal(result.status, "not-applicable");
  const sync = spawnSync(process.execPath, [cli, "sync", "--project", root], { encoding: "utf8" });
  assert.equal(sync.status, 0, sync.stderr);
  assert.match(sync.stdout, /CodeGraph not applicable/);
  assert.equal(fs.readFileSync(path.join(root, ".mcpee/state/codegraph.json"), "utf8"), before);
  assert.ok(!readEvents(root).some((event) =>
    event.event_name === "tool.invocation.completed" && event.tool_name === "codegraph"));
  const doctor = spawnSync(process.execPath, [cli, "doctor", "--project", root], { encoding: "utf8" });
  assert.equal(doctor.status, 0, doctor.stderr);
  fs.writeFileSync(path.join(root, "app.js"), "module.exports = () => 'real application';\n");
  const codeDoctor = spawnSync(process.execPath, [cli, "doctor", "--project", root], { encoding: "utf8" });
  assert.equal(codeDoctor.status, 1);
  assert.match(codeDoctor.stderr, /Required CodeGraph index healthy/);
  assert.throws(() => routeTask(root, "Review architecture"), /CodeGraph is required/);
});

test("documentation provenance still blocks routing when actual requirements drift", (t) => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, "knowledge/sources/business/catalog.md"), "\nNew search requirement.\n");
  assert.throws(() => routeTask(root, "Review architecture knowledge/sources/business/catalog.md"),
    /Source changed after sync/);
});
