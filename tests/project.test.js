"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFileSync, spawnSync } = require("node:child_process");
const { after, test } = require("node:test");
const { initializeProject, approvalHookInstalled } = require("../packages/core/src/project");
const {
  provisionWorkflowSpecs,
  requiredToolInstallationFailures,
  run: runCli,
  synchronizeAfterCopilotChanges,
} = require("../packages/cli/src/cli");
const { RUN_STAGES, writeRunReport } = require("../packages/execution-engine/src/run-report");
const {
  assessCopilotToolCall,
  assessToolInvocation,
  formatApprovalArguments,
  isReadOnlyInvocation,
} = require("../packages/core/src/approval");
const {
  completeTask,
  decideTask,
  listTasks,
  startTask,
} = require("../packages/core/src/tasks");
const {
  readEvents,
  recordEvent,
  evaluateTelemetryIntegrity,
  writeLocalTelemetryExport,
  writeLocalTelemetryEventsExport,
} = require("../packages/core/src/telemetry");
const { addMemory, listMemory } = require("../packages/memory-engine/src/memory");
const {
  classifySource,
  syncProject,
  searchKnowledge,
  searchKnowledgeVector,
} = require("../packages/source-engine/src/sync");
const {
  buildEmbeddingIndex,
  chunkDocument,
  searchGroundedContext,
} = require("../packages/source-engine/src/embeddings");
const {
  discoverTools,
  installCatalogTools,
  npmCliPath,
  invokeTool,
  isVersionAtLeast,
  validateTool,
} = require("../packages/tool-manager/src/tools");
const { runWorkflow } = require("../packages/workflow-engine/src/workflow");
const {
  capabilityRegistry,
  detectProjectCapabilities,
  manageCapability,
  readCatalog,
  renderCatalog,
  GENERATED_MARKER,
  createInitialCapabilityState,
  readInstalledCatalog,
} = require("../packages/copilot-renderer/src/render");
const { evaluateExecution, loadRunSpec } = require("../packages/evaluation-engine/src/evaluate");
const { decideLearning, listLearning, proposeLearning } = require("../packages/learning-engine/src/learning");
const { searchMemory } = require("../packages/memory-engine/src/memory");
const { generateProjectDocumentation } = require("../packages/documentation-engine/src/generate");
const { routeTask } = require("../packages/routing-engine/src/route");
const { summarizeInventory } = require("../packages/cloud-engine/src/cli-evidence");
const {
  collectContextFiles,
  packRelevantContext,
  runCopilotTask,
} = require("../packages/execution-engine/src/copilot");
const {
  configureProjectMcp,
  searchCodeGraph,
  updateCodeGraph,
} = require("../packages/knowledge-engine/src/codegraph");
const {
  analyzeImpact,
  analyzeImpacts,
  buildUnifiedGraph,
  getDocumentContradictions,
  getDocumentDrift,
  searchUnifiedGraph,
  GRAPH_PATH,
} = require("../packages/knowledge-engine/src/unified");
const {
  readGraphifyState,
  searchGraphify,
  updateGraphifyGraph,
} = require("../packages/knowledge-engine/src/graphify");

const temporaryRoots = [];
const cli = path.resolve(__dirname, "../packages/cli/bin/mcpee.js");
function temporaryProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-project-"));
  temporaryRoots.push(root);
  return root;
}

after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

test("init creates the project structure and preserves existing user files", () => {
  const root = temporaryProject();
  const instructions = path.join(root, ".github/copilot-instructions.md");
  const ignoreFile = path.join(root, ".mcpee/.gitignore");
  fs.mkdirSync(path.dirname(instructions), { recursive: true });
  fs.writeFileSync(instructions, "user-owned instructions\n");
  fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
  fs.writeFileSync(ignoreFile, "/my-private-cache/\n");

  const first = initializeProject(root);
  const second = initializeProject(root);

  assert.ok(first.created.includes("mcpee.config.yml"));
  assert.ok(first.preserved.includes(".github/copilot-instructions.md"));
  assert.ok(second.preserved.includes("mcpee.config.yml"));
  assert.equal(fs.readFileSync(instructions, "utf8"), "user-owned instructions\n");
  assert.match(fs.readFileSync(ignoreFile, "utf8"), /\/my-private-cache\//);
  assert.match(fs.readFileSync(ignoreFile, "utf8"), /\/telemetry\/events\//);
  assert.ok(fs.existsSync(path.join(root, "knowledge/sources/business")));
  assert.ok(fs.existsSync(path.join(root, ".github/hooks/mcpee-observability.json")));
  assert.equal(readEvents(root).filter((event) => event.event_name === "project.initialized").length, 2);
  assert.ok(fs.existsSync(path.join(root, ".mcpee/runtime/approval-policy.cjs")));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/runtime/mcp-server.cjs")));
  const mcpState = JSON.parse(fs.readFileSync(path.join(root, ".mcpee/state/mcp-server.json"), "utf8"));
  assert.equal(mcpState.generated_by, "mcpee");
  assert.equal(mcpState.package_root, path.resolve(__dirname, ".."));
  assert.ok(fs.existsSync(path.join(root, ".github/agents/mcpee-orchestrator.agent.md")));
  assert.ok(fs.existsSync(path.join(root, ".github/agents/mcpee-security.agent.md")));
  assert.ok(fs.existsSync(path.join(root, ".github/skills/mcpee-knowledge/SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".github/skills/mcpee-github-ado-work-items/SKILL.md")));
  assert.equal(capabilityRegistry(root).items.find((item) =>
    item.type === "workflow" && item.id === "deliver-feature")?.status, "available");
  assert.ok(fs.existsSync(path.join(root, ".github/instructions/mcpee-policies.instructions.md")));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/generated/catalog-patterns.md")));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/generated/catalog-templates.md")));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/generated/catalog-technical-guidance.md")));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/generated/catalog-quality.md")));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/generated/catalog-playbooks.md")));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/generated/project-capabilities.json")));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/generated/project-capabilities.md")));
  assert.match(fs.readFileSync(path.join(root, ".mcpee/generated/project-capabilities.md"), "utf8"), /No supported stack signals/);
  assert.match(fs.readFileSync(path.join(root, ".mcpee/generated/catalog-patterns.md"), "utf8"), /## vertical-slice/);
  assert.match(fs.readFileSync(path.join(root, ".mcpee/generated/catalog-templates.md"), "utf8"), /## project-mcp-server/);
  assert.match(fs.readFileSync(path.join(root, ".mcpee/generated/catalog-templates.md"), "utf8"), /require\(serverEntry\)\.startMcpServer/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, ".mcpee/generated/catalog-technical-guidance.md"), "utf8"), /https:\/\/learn\.microsoft\.com/);
  assert.equal(capabilityRegistry(root).items.find((item) =>
    item.type === "technical-guidance" && item.id === "dotnet-csharp")?.status, "available");
  assert.match(fs.readFileSync(path.join(root, ".mcpee/generated/catalog-quality.md"), "utf8"), /not automatic graders/i);
  assert.doesNotMatch(fs.readFileSync(path.join(root, ".mcpee/generated/catalog-playbooks.md"), "utf8"), /## migration-strategy/);
  assert.equal(capabilityRegistry(root).items.find((item) =>
    item.type === "playbook" && item.id === "migration-strategy")?.status, "available");
  assert.match(fs.readFileSync(path.join(root, ".github/agents/mcpee-ai.agent.md"), "utf8"), /## Preferred knowledge/);
  assert.match(fs.readFileSync(path.join(root, ".github/agents/mcpee-ai.agent.md"), "utf8"), /optional-mcp: Workspace-scoped MCP integrations/);
  assert.match(fs.readFileSync(path.join(root, ".github/agents/mcpee-product.agent.md"), "utf8"), /Specialist role guidance\n\n# Product owner/);
  assert.match(fs.readFileSync(path.join(root, ".github/agents/mcpee-product.agent.md"), "utf8"), /Reusable patterns/);
  assert.match(fs.readFileSync(path.join(root, ".github/agents/mcpee-orchestrator.agent.md"), "utf8"), /Supporting role guidance: scrum-master/);
  assert.equal(fs.existsSync(path.join(root, ".github/skills/mcpee-deliver-feature/SKILL.md")), false);
  assert.match(fs.readFileSync(path.join(root, ".mcpee/generated/catalog-policy.md"), "utf8"), /\*\*Enforcement:\*\*/);
  assert.equal(second.catalog.counts.created, 0);
  assert.equal(second.catalog.counts.updated, 0);
  assert.ok(second.catalog.counts.unchanged > 0);
  const lock = JSON.parse(fs.readFileSync(path.join(root, ".mcpee/catalog-lock.json"), "utf8"));
  assert.equal(lock.catalog_sha256, first.catalog.catalog_sha256);
  assert.equal(lock.catalog_sha256, readCatalog().digest);
  const rawCatalog = fs.readFileSync(path.resolve(__dirname, "../catalog/catalog.json"), "utf8");
  assert.notEqual(lock.catalog_sha256, crypto.createHash("sha256").update(rawCatalog).digest("hex"));
});

test("init selects user-chosen agents for projects without code and preserves capability management", () => {
  const root = temporaryProject();
  fs.mkdirSync(path.join(root, "knowledge/business"), { recursive: true });
  fs.writeFileSync(path.join(root, "knowledge/business/domain.md"), "# Domain knowledge\n");

  const result = initializeProject(root, { initialAgents: ["product"] });

  assert.equal(result.catalog.capabilities.has_code_signals, false);
  assert.deepEqual(result.catalog.capabilities.assets.agents, ["orchestrator", "product"]);
  assert.ok(result.catalog.capabilities.assets.skills.length > 0);
  assert.ok(result.catalog.capabilities.assets.workflows.every((workflowId) =>
    ["orchestrator", "product"].includes(
      readCatalog().catalog.workflows.find((workflow) => workflow.id === workflowId)?.agent)));
  assert.equal(capabilityRegistry(root).items.find((item) =>
    item.type === "agent" && item.id === "qa")?.status, "available");
  assert.equal(capabilityRegistry(root).items.find((item) =>
    item.type === "agent" && item.id === "orchestrator")?.status, "core");
  assert.throws(() => manageCapability(root, "remove", "agent", "orchestrator"), /core agent/);

  manageCapability(root, "install", "agent", "qa");
  assert.deepEqual(capabilityRegistry(root).items
    .filter((item) => item.type === "agent" && !["available", "core"].includes(item.status))
    .map((item) => item.id).sort(), ["product", "qa"]);
});

test("the orchestrator is restored when an earlier selection excluded it", () => {
  const root = temporaryProject();
  initializeProject(root, { initialAgents: ["backend", "architecture"] });
  const statePath = path.join(root, ".mcpee/state/catalog-capabilities.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.overrides.agent.added = state.overrides.agent.added.filter((id) => id !== "orchestrator");
  state.overrides.agent.removed.push("orchestrator");
  state.overrides.skill.removed.push("knowledge");
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  renderCatalog(root);

  const agent = fs.readFileSync(path.join(root, ".github/agents/mcpee-orchestrator.agent.md"), "utf8");
  assert.match(agent, /^---\nname: mcpee-orchestrator\n/);
  assert.ok(fs.existsSync(path.join(root, ".github/skills/mcpee-knowledge/SKILL.md")));
  for (const file of fs.readdirSync(path.join(root, ".github/agents"))) {
    const id = file.replace(/\.agent\.md$/, "");
    assert.match(fs.readFileSync(path.join(root, ".github/agents", file), "utf8"), new RegExp(`^---\\nname: ${id}\\n`));
  }
});

test("code evidence is detected even when no supported stack manifest exists", () => {
  const root = temporaryProject();
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/app.js"), "export const answer = 42;\n");

  const capabilities = detectProjectCapabilities(root, readCatalog().catalog);

  assert.equal(capabilities.has_code_signals, true);
  assert.deepEqual(capabilities.code_evidence_files, ["src/app.js"]);
});

test("every specialist can route an isolated entry audit without installing another role", () => {
  const root = temporaryProject();
  initializeProject(root, { initialAgents: ["orchestrator"] });
  fs.writeFileSync(path.join(root, "sample.txt"), "Synthetic source for a bounded static entry audit.");
  installFakeCodeGraph(root);
  syncProject(root);
  updateCodeGraph(root, { available: true, required: true });
  const { catalog } = readCatalog();
  for (const agent of catalog.agents) {
    renderCatalog(root, { capabilityState: createInitialCapabilityState([agent.id]) });
    const installed = readInstalledCatalog(root);
    assert.deepEqual(installed.agents.map(item => item.id).sort(), [...new Set(["orchestrator", agent.id])].sort());
    assert.ok(installed.workflows.some(item => item.agent === agent.id), `${agent.id} needs a runnable workflow`);
    const plan = routeTask(root, "Review only sample.txt; do not edit or execute commands.");
    // Generic requests without specialist keywords fall back to the always-installed orchestrator.
    assert.ok([agent.id, "orchestrator"].includes(plan.agent.id));
    assert.ok(installed.workflows.some(item => item.id === plan.workflow.id));
  }
});

test("Node is detected from an explicit package runtime engine", () => {
  const root = temporaryProject();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    engines: { node: ">=24" },
    scripts: { test: "node --test" },
  }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/cli.js"), "process.stdout.write('ready');\n");

  const capabilities = detectProjectCapabilities(root, readCatalog().catalog);

  assert.deepEqual(capabilities.detected_technologies.map(({ id }) => id), ["node"]);
  assert.deepEqual(capabilities.detected_technologies[0].evidence, ["package.json"]);
});

test("capability detection treats a not-yet-created project root as an empty project", () => {
  const root = path.join(temporaryProject(), "new-project");

  const capabilities = detectProjectCapabilities(root, readCatalog().catalog);

  assert.equal(capabilities.has_code_signals, false);
  assert.deepEqual(capabilities.code_evidence_files, []);
});

test("cloud inventory summaries expose only aggregate read-only evidence", () => {
  const azure = summarizeInventory("azure", [
    { type: "Microsoft.Storage/storageAccounts", location: "westus" },
    { type: "Microsoft.Storage/storageAccounts", location: "westus" },
    { type: "Microsoft.Web/sites", location: null },
  ], "2026-01-01T00:00:00.000Z");
  assert.equal(azure.resource_count, 3);
  assert.deepEqual(azure.resource_counts_by_location, { unknown: 1, westus: 2 });
  assert.deepEqual(azure.resource_counts_by_type, {
    "Microsoft.Storage/storageAccounts": 2,
    "Microsoft.Web/sites": 1,
  });
  assert.equal(Object.hasOwn(azure, "resources"), false);

  const aws = summarizeInventory("aws", {
    ResourceTagMappingList: [
      { ResourceARN: "arn:aws:s3:::example" },
      { ResourceARN: "arn:aws:ec2:us-west-2:123456789012:instance/i-example" },
    ],
    NextToken: "next",
  }, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(aws.resource_counts_by_type, { ec2: 1, s3: 1 });
  assert.deepEqual(aws.resource_counts_by_region, { global: 1, "us-west-2": 1 });
  assert.equal(aws.truncated, true);
  assert.equal(JSON.stringify(aws).includes("123456789012"), false);
  assert.throws(() => summarizeInventory("azure", {}), /JSON array/);
  assert.throws(() => summarizeInventory("aws", {}), /AWS CLI/);
});

test("init detects a mixed stack and selects the matching project capabilities", () => {
  const root = temporaryProject();
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "infra"), { recursive: true });
  fs.mkdirSync(path.join(root, "db"), { recursive: true });
  fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    dependencies: {
      "@angular/core": "^19.0.0",
      "@azure/cosmos": "^4.0.0",
      "aws-cdk-lib": "^2.0.0",
      express: "^5.0.0",
      react: "^19.0.0",
    },
  }));
  fs.writeFileSync(path.join(root, "angular.json"), "{}\n");
  fs.writeFileSync(path.join(root, "src/service.py"), "def handler(): pass\n");
  fs.writeFileSync(path.join(root, "src/app.csproj"), "<Project />\n");
  fs.writeFileSync(path.join(root, "infra/main.tf"), "resource \"test\" \"example\" {}\n");
  fs.writeFileSync(path.join(root, "infra/main.bicep"), "param location string\n");
  fs.writeFileSync(path.join(root, "db/schema.sql"), "SELECT 1;\n");
  fs.writeFileSync(path.join(root, ".github/workflows/ci.yml"), "name: CI\n");
  fs.mkdirSync(path.join(root, "node_modules/hidden"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules/hidden/package.json"), JSON.stringify({
    dependencies: { "@nestjs/core": "^10.0.0" },
  }));

  const result = initializeProject(root);
  const capabilities = result.catalog.capabilities;
  const technologyIds = capabilities.detected_technologies.map(({ id }) => id);
  assert.deepEqual(technologyIds, [
    "angular", "aws", "azure", "bicep", "cosmos-db", "dotnet", "node", "python",
    "react", "sql", "terraform", "yaml-pipelines",
  ]);
  assert.ok(capabilities.assets.agents.includes("backend"));
  assert.ok(capabilities.assets.agents.includes("frontend"));
  assert.ok(capabilities.assets.agents.includes("database"));
  assert.ok(capabilities.assets.agents.includes("infrastructure"));
  assert.ok(capabilities.assets.agents.includes("devops"));
  assert.ok(capabilities.assets.skills.includes("frontend-accessibility-review"));
  assert.ok(capabilities.assets.skills.includes("database-migration-safety"));
  assert.ok(capabilities.assets.skills.includes("debugging-and-recovery"));
  assert.ok(capabilities.assets.skills.includes("performance-investigation"));
  assert.ok(capabilities.assets.technical_guidance.includes("angular-engineering"));
  assert.ok(capabilities.assets.technical_guidance.includes("react-engineering"));
  assert.ok(capabilities.assets.technical_guidance.includes("azure-engineering"));
  assert.ok(capabilities.assets.patterns.includes("clean-code-and-naming"));
  assert.ok(capabilities.assets.templates.includes("decision-record-pattern"));
  assert.ok(fs.existsSync(path.join(root, ".github/instructions/mcpee-stack-angular-engineering.instructions.md")));
  assert.ok(fs.existsSync(path.join(root, ".github/instructions/mcpee-stack-react-engineering.instructions.md")));
  assert.ok(fs.existsSync(path.join(root, ".github/instructions/mcpee-stack-azure-engineering.instructions.md")));
  assert.ok(fs.existsSync(path.join(root, ".github/agents/mcpee-backend.agent.md")));
  assert.ok(fs.existsSync(path.join(root, ".github/skills/mcpee-database-migration-safety/SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".github/skills/mcpee-debugging-and-recovery/SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".github/skills/mcpee-performance-investigation/SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".github/skills/mcpee-deliver-feature/SKILL.md")));
  assert.equal(fs.existsSync(path.join(root, ".github/prompts")), false);
  const report = JSON.parse(fs.readFileSync(path.join(root, ".mcpee/generated/project-capabilities.json"), "utf8"));
  assert.deepEqual(report, capabilities);
  assert.ok(!capabilities.evidence_files.some((file) => file.includes("node_modules")));

  const updated = initializeProject(root);
  assert.equal(updated.catalog.counts.created, 0);
  assert.equal(updated.catalog.counts.updated, 0);
  assert.ok(updated.catalog.counts.unchanged > 0);
  const explanation = execFileSync(process.execPath, [
    cli, "explain", "--project", root, "--json",
  ], { encoding: "utf8" });
  const explained = JSON.parse(explanation);
  assert.equal(explained.project_capabilities.status, "detected");
  assert.deepEqual(
    explained.project_capabilities.detected_technologies.map(({ id }) => id),
    technologyIds,
  );
});

test("capabilities can be listed, installed, updated, and removed without breaking shared dependencies", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    dependencies: { express: "^5.0.0" },
  }));
  renderCatalog(root);

  const list = spawnSync(process.execPath, [
    cli, "capabilities", "list", "--type", "agent", "--json", "--project", root,
  ], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  const registry = JSON.parse(list.stdout);
  assert.ok(registry.items.some((item) =>
    item.id === "backend" && item.status === "detected-installed"));
  assert.ok(fs.existsSync(path.join(root, ".github/agents/mcpee-backend.agent.md")));

  const removed = spawnSync(process.execPath, [
    cli, "capabilities", "remove", "backend", "--type", "agent", "--project", root,
  ], { encoding: "utf8" });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(root, ".github/agents/mcpee-backend.agent.md")), false);
  assert.equal(capabilityRegistry(root).items.find((item) =>
    item.type === "agent" && item.id === "backend")?.status, "available");
  assert.notEqual(capabilityRegistry(root).items.find((item) =>
    item.type === "skill" && item.id === "quality")?.status, "available");
  assert.throws(() => manageCapability(root, "remove", "skill", "quality"), /core skill/);
  assert.throws(() => manageCapability(root, "remove", "skill", "backend-change"), /depend on it/);

  const installed = spawnSync(process.execPath, [
    cli, "capabilities", "install", "backend", "--type", "agent", "--project", root,
  ], { encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stderr);
  assert.ok(fs.existsSync(path.join(root, ".github/agents/mcpee-backend.agent.md")));
  assert.notEqual(capabilityRegistry(root).items.find((item) =>
    item.type === "workflow" && item.id === "resolve-bug")?.status, "available");

  const updated = spawnSync(process.execPath, [
    cli, "capabilities", "update", "backend", "--type", "agent", "--project", root,
  ], { encoding: "utf8" });
  assert.equal(updated.status, 0, updated.stderr);
  assert.match(updated.stdout, /updated|up-to-date/);

  const { catalog } = readCatalog();
  assert.throws(() => manageCapability(root, "remove", "policy", catalog.policies[0].id), /core/);
});

test("workflow validation specs are provisioned from declared npm checks without overwriting project specs", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "fixture",
    scripts: {
      "test:ci": "node --test",
      test: "node --watch",
      lint: "eslint .",
      build: "node build.js",
    },
  }));
  const customPath = path.join(root, ".mcpee/workflows/resolve-bug.json");
  const customSpec = '{"workflow_id":"resolve-bug","task":"user-owned"}\n';
  fs.writeFileSync(customPath, customSpec);

  const toolReport = { tools: [{ id: "npm", available: true }] };
  const result = provisionWorkflowSpecs(root, toolReport);
  assert.equal(result.status, "ready");
  assert.equal(result.created, readCatalog().catalog.workflows.length - 1);
  assert.equal(result.preserved, 1);
  assert.equal(result.checkCount, 3);
  assert.equal(fs.readFileSync(customPath, "utf8"), customSpec);

  const generatedPath = path.join(root, ".mcpee/workflows/deliver-feature.json");
  const generated = JSON.parse(fs.readFileSync(generatedPath, "utf8"));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/workflows/refine-backlog.json")));
  assert.equal(generated.workflow_id, "deliver-feature");
  assert.deepEqual(generated.evidence, ["package.json"]);
  assert.deepEqual(generated.steps.map((step) => step.args), [
    ["run", "test:ci"],
    ["run", "lint"],
    ["run", "build"],
  ]);
  assert.ok(generated.steps.every((step) => step.requires_approval));

  const repeated = provisionWorkflowSpecs(root, toolReport);
  assert.equal(repeated.created, 0);
  assert.equal(repeated.preserved, readCatalog().catalog.workflows.length);
});

test("workflow validation specs are not fabricated when no supported checks are declared", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "fixture",
    scripts: { start: "node server.js" },
  }));

  const result = provisionWorkflowSpecs(root, {
    tools: [{ id: "npm", available: true }],
  });
  assert.equal(result.status, "not-configured");
  assert.match(result.reason, /No supported checks/);
  assert.equal(fs.readdirSync(path.join(root, ".mcpee/workflows")).length, 0);
});

test("workflow discovery prefers declared unit CI over watch tests and keeps other checks", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    scripts: { test: "ng test", "test:unit:ci": "ng test --watch=false",
      lint: "eslint .", build: "ng build" },
  }));
  const result = provisionWorkflowSpecs(root, { tools: [{ id: "npm", available: true }] });
  assert.equal(result.status, "ready");
  const spec = JSON.parse(fs.readFileSync(path.join(root, ".mcpee/workflows/deliver-feature.json"), "utf8"));
  assert.deepEqual(spec.steps.map(step => step.args),
    [["run", "test:unit:ci"], ["run", "lint"], ["run", "build"]]);
});

test("workflow validation discovery excludes available but non-invokable tools", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    scripts: { test: "node --test" },
  }));

  const result = provisionWorkflowSpecs(root, {
    tools: [{ id: "npm", available: true, invokable: false }],
  });
  assert.equal(result.status, "not-configured");
  assert.match(result.reason, /No supported checks/);
});

test("workflow validation specs include explicitly configured Python and root .NET checks", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.writeFileSync(path.join(root, "pyproject.toml"), [
    "[project]",
    'name = "fixture"',
    "",
    "[tool.pytest.ini_options]",
    'testpaths = ["tests"]',
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "fixture.sln"), [
    "Microsoft Visual Studio Solution File",
    'Project("{TEST}") = "Fixture", "fixture.csproj", "{PROJECT}"',
    "EndProject",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "fixture.csproj"), "<Project />\n");

  const result = provisionWorkflowSpecs(root, {
    tools: [
      { id: "python", available: true },
      { id: "dotnet", available: true },
    ],
  });
  assert.equal(result.status, "ready");
  assert.equal(result.created, readCatalog().catalog.workflows.length);
  assert.equal(result.preserved, 0);
  assert.deepEqual(result.checks, [
    { id: "python-pytest", tool: "python", cwd: ".", covers_technologies: ["python"] },
    { id: "dotnet-test", tool: "dotnet", cwd: ".", covers_technologies: ["dotnet"] },
  ]);

  const spec = JSON.parse(fs.readFileSync(
    path.join(root, ".mcpee/workflows/resolve-bug.json"),
    "utf8",
  ));
  assert.deepEqual(spec.evidence, ["fixture.sln", "pyproject.toml"]);
  assert.deepEqual(spec.steps.map((step) => [step.tool, ...step.args]), [
    ["python", "-m", "pytest"],
    ["dotnet", "test", "fixture.sln"],
  ]);
  assert.ok(spec.steps.every((step) => step.requires_approval));
});

test("workflow validation discovery covers nested monorepo projects and ignores dependency trees", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const files = {
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    "packages/api/package.json": JSON.stringify({ scripts: { "test:ci": "node --test", lint: "eslint ." } }),
    "packages/service/pyproject.toml": "[tool.pytest.ini_options]\ntestpaths = [\"tests\"]\n",
    "services/web/web.csproj": "<Project />\n",
    "node_modules/unrelated/package.json": JSON.stringify({ scripts: { test: "echo false-positive" } }),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  }

  const result = provisionWorkflowSpecs(root, {
    tools: [
      { id: "npm", available: true },
      { id: "python", available: true },
      { id: "dotnet", available: true },
    ],
  });
  assert.equal(result.status, "ready");
  assert.equal(result.checkCount, 5);
  const spec = JSON.parse(fs.readFileSync(
    path.join(root, ".mcpee/workflows/resolve-bug.json"),
    "utf8",
  ));
  assert.deepEqual(spec.evidence, [
    "package.json",
    "packages/api/package.json",
    "packages/service/pyproject.toml",
    "services/web/web.csproj",
  ]);
  assert.deepEqual(spec.steps.map(({ id, tool, cwd }) => ({ id, tool, cwd })), [
    { id: "npm-test", tool: "npm", cwd: "." },
    { id: "packages-api-npm-test-ci", tool: "npm", cwd: "packages/api" },
    { id: "packages-api-npm-lint", tool: "npm", cwd: "packages/api" },
    { id: "packages-service-python-pytest", tool: "python", cwd: "packages/service" },
    { id: "services-web-dotnet-test", tool: "dotnet", cwd: "services/web" },
  ]);
  assert.deepEqual(spec.steps.map((step) => step.covers_technologies), [
    [],
    [],
    [],
    ["python"],
    ["dotnet"],
  ]);
  assert.deepEqual(spec.steps[3].evidence, ["packages/service/pyproject.toml"]);
  const execution = await runWorkflow(root, ".mcpee/workflows/resolve-bug.json", {
    beforeRun: async (preflight) => {
      assert.equal(preflight.status, "unavailable");
    },
  });
  assert.equal(execution.checks[0].status, "blocked");
});

test("workflow validation discovery refuses to create specs beyond the runner step limit", () => {
  const root = temporaryProject();
  initializeProject(root);
  for (let index = 0; index < 21; index += 1) {
    const directory = path.join(root, "packages", `app-${index}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({
      scripts: { test: "node --test" },
    }));
  }
  const result = provisionWorkflowSpecs(root, {
    tools: [{ id: "npm", available: true }],
  });
  assert.equal(result.status, "not-configured");
  assert.match(result.reason, /exceeding MCPEE's 20-step workflow limit/);
  assert.equal(fs.readdirSync(path.join(root, ".mcpee/workflows")).length, 0);
});

test("workflow validation IDs stay unique when different package paths normalize identically", () => {
  const root = temporaryProject();
  initializeProject(root);
  for (const packagePath of ["packages/foo-bar", "packages/foo/bar"]) {
    const directory = path.join(root, packagePath);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({
      scripts: { test: "node --test" },
    }));
  }

  const result = provisionWorkflowSpecs(root, {
    tools: [{ id: "npm", available: true }],
  });
  assert.equal(result.status, "ready");
  assert.equal(result.checkCount, 2);
  assert.equal(new Set(result.checks.map((check) => check.id)).size, 2);
  assert.ok(result.checks.every((check) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(check.id)));
});

test("workflow provisioning does not infer pytest from unrelated Python configuration", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.writeFileSync(path.join(root, "pyproject.toml"), [
    "[project]",
    'name = "fixture"',
    "",
    "[tool.ruff]",
    "line-length = 100",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "tox.ini"), [
    "[tox]",
    "envlist = lint",
    "",
    "[testenv:lint]",
    "commands = ruff check .",
    "",
  ].join("\n"));

  const result = provisionWorkflowSpecs(root, {
    tools: [{ id: "python", available: true }],
  });
  assert.equal(result.status, "not-configured");
  assert.equal(fs.readdirSync(path.join(root, ".mcpee/workflows")).length, 0);
});

test("init validates embedding profile before writing and optional tools do not block it", async () => {
  const root = temporaryProject();
  assert.equal(await runCli(["init", "--project", root, "--embeddings", "invalid"]), 2);
  assert.equal(fs.existsSync(path.join(root, ".mcpee/state/project.json")), false);

  const failures = requiredToolInstallationFailures([
    { id: "graphify", status: "blocked" },
    { id: "markitdown", status: "failed" },
    { id: "codegraph", status: "blocked" },
  ], [
    { id: "graphify", optional: true },
    { id: "markitdown", optional: true },
    { id: "codegraph", optional: false },
  ]);
  assert.deepEqual(failures.map((failure) => failure.id), ["codegraph"]);
});

test("catalog renderer preserves user files and removes only obsolete MCPEE-owned output", () => {
  const root = temporaryProject();
  initializeProject(root);
  manageCapability(root, "install", "agent", "backend");
  const userAgent = path.join(root, ".github/agents/mcpee-backend.agent.md");
  fs.writeFileSync(userAgent, "# My customized backend agent\n");

  const manifestPath = path.join(root, ".mcpee/generated/catalog-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const staleRelative = ".github/prompts/mcpee-obsolete.prompt.md";
  const stalePath = path.join(root, staleRelative);
  fs.mkdirSync(path.dirname(stalePath), { recursive: true });
  fs.writeFileSync(stalePath, `${GENERATED_MARKER}\n# Old generated prompt\n`);
  manifest.files.push(staleRelative);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = renderCatalog(root);
  assert.equal(result.counts.preserved, 1);
  assert.equal(result.counts.removed, 1);
  assert.ok(result.counts.unchanged > 0);
  assert.equal(fs.readFileSync(userAgent, "utf8"), "# My customized backend agent\n");
  assert.equal(fs.existsSync(stalePath), false);
  assert.equal(fs.existsSync(path.dirname(stalePath)), false);
});

test("workflows render as Copilot skills and replace legacy or VS Code-migrated prompt output", () => {
  const root = temporaryProject();
  initializeProject(root);
  manageCapability(root, "install", "workflow", "deliver-feature");
  manageCapability(root, "install", "workflow", "architecture-challenge");
  const skillPath = path.join(root, ".github/skills/mcpee-deliver-feature/SKILL.md");
  const content = fs.readFileSync(skillPath, "utf8");
  assert.match(content, /^---\nname: mcpee-deliver-feature\ndescription: .+\ndisable-model-invocation: true\n---\n/);
  assert.doesNotMatch(content, /^agent:/m);
  assert.match(content, /mcpee-orchestrator/);
  assert.match(content, /mcpee_run/);
  assert.match(
    fs.readFileSync(path.join(root, ".github/skills/mcpee-workflow-architecture-challenge/SKILL.md"), "utf8"),
    /^---\nname: mcpee-workflow-architecture-challenge\n/,
  );
  for (const directory of fs.readdirSync(path.join(root, ".github/skills"))) {
    const skill = fs.readFileSync(path.join(root, ".github/skills", directory, "SKILL.md"), "utf8");
    assert.match(skill, new RegExp(`^---\\nname: ${directory}\\n`));
    assert.match(directory, /^[a-z0-9-]{1,64}$/);
  }

  // Simulate VS Code's prompt-to-skill migration and an older MCPEE manifest listing the prompt.
  fs.writeFileSync(skillPath, `---\nname: mcpee-deliver-feature\ndescription: "x"\ndisable-model-invocation: true\n---\n${GENERATED_MARKER}\n`);
  const legacyRelative = ".github/prompts/mcpee-deliver-feature.prompt.md";
  const legacyPath = path.join(root, legacyRelative);
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(legacyPath, `---\nagent: mcpee-orchestrator\n---\n${GENERATED_MARKER}\n`);
  const manifestPath = path.join(root, ".mcpee/generated/catalog-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.push(legacyRelative);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = renderCatalog(root);
  assert.equal(result.counts.removed, 1);
  assert.equal(fs.existsSync(legacyPath), false);
  assert.equal(fs.readFileSync(skillPath, "utf8"), content);

  const userSkill = "---\nname: mcpee-deliver-feature\ndescription: mine\n---\n# My workflow\n";
  fs.writeFileSync(skillPath, userSkill);
  renderCatalog(root);
  assert.equal(fs.readFileSync(skillPath, "utf8"), userSkill);

  fs.writeFileSync(skillPath, content);
  manageCapability(root, "remove", "workflow", "deliver-feature");
  assert.equal(fs.existsSync(path.dirname(skillPath)), false);
});

test("project init upgrades only explicitly authorized runtime and hook registration", () => {
  const root = temporaryProject();
  initializeProject(root);
  const hookPath = path.join(root, ".mcpee/runtime/copilot-hook.cjs");
  fs.writeFileSync(hookPath, "#!/usr/bin/env node\n// old MCPEE runtime\n");
  const configPath = path.join(root, ".github/hooks/mcpee-observability.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  delete config.hooks.preToolUse;
  fs.writeFileSync(configPath, JSON.stringify(config));

  const nonInteractiveInit = spawnSync(process.execPath, [
    cli, "init", "--project", root, "--skip-tool-install",
  ], { encoding: "utf8" });
  assert.equal(nonInteractiveInit.status, 1);
  assert.match(nonInteractiveInit.stderr, /non-interactive runtime replacement is denied/);
  assert.equal(fs.readFileSync(hookPath, "utf8"), "#!/usr/bin/env node\n// old MCPEE runtime\n");

  const preserved = initializeProject(root);
  assert.ok(preserved.preserved.includes(".mcpee/runtime/copilot-hook.cjs"));
  assert.equal(approvalHookInstalled(root), false);
  assert.doesNotMatch(fs.readFileSync(hookPath, "utf8"), /assessCopilotToolCall/);

  const refreshed = initializeProject(root, {
    refreshRuntime: true,
    refreshApprovalHook: true,
  });
  assert.ok(refreshed.updated.includes(".mcpee/runtime/copilot-hook.cjs"));
  assert.ok(refreshed.updated.includes(".github/hooks/mcpee-observability.json (preToolUse approval hook added)"));
  assert.match(fs.readFileSync(hookPath, "utf8"), /assessCopilotToolCall/);
  assert.equal(approvalHookInstalled(root), true);
  const updatedConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.ok(updatedConfig.hooks.postToolUse);
  assert.ok(updatedConfig.hooks.preToolUse.some((hook) => hook.command.endsWith("preToolUse")));
});

test("installed Copilot hook records real sanitized input and enforces preToolUse decisions", () => {
  const root = temporaryProject();
  initializeProject(root);
  const hook = path.join(root, ".mcpee/runtime/copilot-hook.cjs");
  const input = {
    sessionId: "session-1",
    eventId: "event-1",
    timestamp: 1791547200,
    prompt: "Deploy with Bearer abcdefghijklmnop",
    api_token: "should-not-be-recorded",
  };
  execFileSync(process.execPath, [hook, "userPromptSubmitted"], {
    cwd: root,
    input: JSON.stringify(input),
  });
  const [event] = readEvents(root).filter((item) => item.event_name === "userPromptSubmitted");
  assert.equal(event.session_id, "session-1");
  assert.equal(event.source_event_id, "event-1");
  assert.equal(event.timestamp, "2026-10-09T12:00:00.000Z");
  assert.equal(event.payload.api_token, "[REDACTED]");
  assert.ok(!JSON.stringify(event).includes("abcdefghijklmnop"));

  const denied = spawnSync(process.execPath, [hook, "preToolUse"], {
    cwd: root,
    input: JSON.stringify({ toolName: "shell", toolArgs: { command: "rm -rf ." } }),
    encoding: "utf8",
    env: { ...process.env, MCPEE_NON_INTERACTIVE: "1" },
  });
  assert.equal(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout).permissionDecision, "deny");
  const allowed = spawnSync(process.execPath, [hook, "preToolUse"], {
    cwd: root,
    input: JSON.stringify({ toolName: "shell", toolArgs: { command: "git status --short" } }),
    encoding: "utf8",
    env: { ...process.env, MCPEE_NON_INTERACTIVE: "1" },
  });
  assert.equal(allowed.status, 0);
  assert.equal(JSON.parse(allowed.stdout).permissionDecision, "allow");
  const ask = spawnSync(process.execPath, [hook, "preToolUse"], {
    cwd: root,
    input: JSON.stringify({ toolName: "shell", toolArgs: { command: "npm test" } }),
    encoding: "utf8",
    env: { ...process.env, MCPEE_NON_INTERACTIVE: "", CI: "", GITHUB_ACTIONS: "" },
  });
  assert.equal(ask.status, 0);
  const sdkAsk = JSON.parse(ask.stdout);
  assert.equal(sdkAsk.permissionDecision, "ask");
  assert.equal(sdkAsk.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(sdkAsk.hookSpecificOutput.permissionDecision, "ask");

  const vscodeLocalAsk = spawnSync(process.execPath, [hook, "preToolUse"], {
    cwd: root,
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "run_in_terminal",
      tool_input: { command: "npm test" },
      tool_use_id: "local-call-1",
    }),
    encoding: "utf8",
    env: { ...process.env, MCPEE_NON_INTERACTIVE: "", CI: "", GITHUB_ACTIONS: "" },
  });
  assert.equal(vscodeLocalAsk.status, 0);
  const localAsk = JSON.parse(vscodeLocalAsk.stdout);
  assert.equal(localAsk.hookSpecificOutput.permissionDecision, "ask");
  assert.equal(localAsk.hookSpecificOutput.permissionDecisionReason.includes("require approval"), true);
  const localEvent = readEvents(root).find((item) => item.tool_call_id === "local-call-1");
  assert.equal(localEvent.tool_name, "run_in_terminal");
  assert.equal(localEvent.payload.tool_input.command, "npm test");

  const vscodeLocalReadOnly = spawnSync(process.execPath, [hook, "preToolUse"], {
    cwd: root,
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "run_in_terminal",
      tool_input: { command: "git status --short" },
      tool_use_id: "local-call-2",
    }),
    encoding: "utf8",
    env: { ...process.env, MCPEE_NON_INTERACTIVE: "1" },
  });
  assert.equal(vscodeLocalReadOnly.status, 0);
  assert.equal(JSON.parse(vscodeLocalReadOnly.stdout).hookSpecificOutput.permissionDecision, "allow");

  const localFailure = spawnSync(process.execPath, [hook, "preToolUse"], {
    cwd: root,
    input: "{not-json",
    encoding: "utf8",
  });
  assert.equal(localFailure.status, 0);
  assert.equal(JSON.parse(localFailure.stdout).hookSpecificOutput.permissionDecision, "deny");

  const failure = spawnSync(process.execPath, [hook, "userPromptSubmitted"], {
    cwd: root,
    input: "{not-json",
    encoding: "utf8",
  });
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /Invalid JSON payload/);
});

test("telemetry redacts secrets and reports damaged JSONL instead of hiding it", () => {
  assert.equal(evaluateTelemetryIntegrity(temporaryProject()).status, "no-evidence");
  const root = temporaryProject();
  initializeProject(root);
  recordEvent(root, {
    event_name: "validation.finished",
    attributes: { api_key: "sensitive", result: "ghp_123456789012345678901234" },
  });
  const records = readEvents(root);
  assert.equal(records.at(-1).attributes.api_key, "[REDACTED]");
  assert.ok(!records.at(-1).attributes.result.includes("ghp_"));
  assert.equal(evaluateTelemetryIntegrity(root).status, "passed");

  const eventPath = path.join(root, ".mcpee/telemetry/events/copilot.jsonl");
  fs.appendFileSync(eventPath, `${JSON.stringify({ schema_version: 1, event_name: "invalid" })}\n`);
  assert.throws(() => readEvents(root), /Invalid telemetry JSONL.*schema version 1/);
  assert.equal(evaluateTelemetryIntegrity(root).status, "failed");
  fs.writeFileSync(eventPath, `${JSON.stringify(records.at(-1))}\n`);
  fs.appendFileSync(eventPath, "broken json\n");
  assert.throws(() => readEvents(root), /Invalid telemetry JSONL/);
  assert.throws(() => writeLocalTelemetryExport(root, "../outside.json", {}), /must stay inside the project/);
  const exportPath = writeLocalTelemetryExport(root, "reports/telemetry.json", {
    attributes: { api_key: "sensitive" },
  });
  assert.match(fs.readFileSync(exportPath, "utf8"), /"\[REDACTED\]"/);
  assert.throws(() => writeLocalTelemetryExport(root, "reports/telemetry.json", {}), /will not overwrite/);
});

test("telemetry prunes detailed events older than 30 days and exports a versioned event envelope", () => {
  const root = temporaryProject();
  initializeProject(root);
  const now = Date.now();
  recordEvent(root, {
    event_name: "copilot.response.received",
    timestamp: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString(),
    payload: { content: "expired detail" },
  });
  recordEvent(root, {
    event_name: "copilot.response.received",
    timestamp: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    trace_id: "trace-retained",
    parent_id: "parent-event",
    payload: { content: "retained detail" },
  });
  const events = readEvents(root);
  const retained = events.filter((event) => event.event_name === "copilot.response.received");
  assert.equal(retained.length, 1);
  assert.equal(retained[0].trace_id, "trace-retained");
  assert.equal(retained[0].parent_id, "parent-event");
  assert.equal(retained[0].payload.content, "retained detail");

  const exportPath = writeLocalTelemetryEventsExport(root, "reports/trace.json", retained);
  const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  assert.equal(exported.schema_version, 1);
  assert.equal(exported.export_kind, "mcpee.telemetry.events");
  assert.equal(exported.retention_days, 30);
  assert.deepEqual(exported.events, retained);
  const exportSchema = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../schemas/telemetry-export.schema.json"),
    "utf8",
  ));
  assert.equal(exportSchema.properties.events.items.$ref, "telemetry-event.schema.json");
  assert.equal(exportSchema.properties.retention_days.const, 30);
});

test("trace CLI exports all redacted events matching a trace ID", () => {
  const root = temporaryProject();
  recordEvent(root, {
    event_name: "copilot.prompt.sent",
    trace_id: "trace-cli-export",
    payload: { prompt: "API_TOKEN=placeholder Keep the local context." },
  });
  recordEvent(root, {
    event_name: "copilot.response.received",
    trace_id: "another-trace",
    payload: { content: "not part of this trace" },
  });
  const cliPath = path.resolve(__dirname, "../packages/cli/bin/mcpee.js");
  const result = spawnSync(process.execPath, [
    cliPath,
    "trace",
    "--project",
    root,
    "--trace-id",
    "trace-cli-export",
    "--export",
    "reports/trace-cli.json",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const exported = JSON.parse(fs.readFileSync(path.join(root, "reports/trace-cli.json"), "utf8"));
  assert.equal(exported.event_count, 1);
  assert.equal(exported.events[0].trace_id, "trace-cli-export");
  assert.doesNotMatch(JSON.stringify(exported), /API_TOKEN=placeholder/);
});

test("memory is an explicit, evidence-linked, redacted local record", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/decision.md"), "# Decision\nKeep data local.\n");
  const entry = addMemory(root, {
    kind: "decision",
    text: "Use local storage; API_TOKEN=do-not-persist",
    sources: ["docs/decision.md"],
  });
  assert.ok(entry.id);
  assert.ok(!entry.text.includes("do-not-persist"));
  assert.equal(listMemory(root, "decision").length, 1);
  assert.equal(entry.sources[0].sha256.length, 64);
  assert.equal(searchMemory(root, "local storage").length, 1);
  installFakeCodeGraph(root);
  updateCodeGraph(root, { available: true, required: true });
  syncProject(root);
  assert.equal(routeTask(root, "local storage").memory.some(memory => memory.id === entry.id), true);
  fs.appendFileSync(path.join(root, "docs/decision.md"), "\nChanged after decision.\n");
  assert.equal(searchMemory(root, "local storage")[0].evidence_status[0].status, "changed");
  syncProject(root);
  assert.equal(routeTask(root, "local storage").memory.some(memory => memory.id === entry.id), false);
  const memoryLayer = readEvents(root).findLast(event =>
    event.event_name === "context.layer.completed" && event.attributes.layer === "memory");
  assert.equal(memoryLayer.attributes.consulted, true);
  assert.equal(memoryLayer.attributes.candidate_count, 1);
  assert.equal(memoryLayer.attributes.selected_count, 0);
  assert.equal(memoryLayer.attributes.excluded_stale_count, 1);
  assert.throws(() => addMemory(root, { kind: "unknown", text: "no" }), /Unsupported memory kind/);
  assert.throws(() => addMemory(root, {
    kind: "decision",
    text: "outside root",
    sources: ["../outside.md"],
  }), /inside the project/);
});

test("evaluation checks enforce bounded per-check timeouts and retain the default", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const spec = {
    task: "Verify bounded local validation timeouts",
    evidence: ["mcpee.config.yml"],
    checks: [{ label: "Node version", tool: "node", args: ["--version"] }],
  };
  const specPath = path.join(root, "timeout-run.json");
  fs.writeFileSync(specPath, JSON.stringify(spec));
  const defaultResult = await evaluateExecution(root, "timeout-run.json");
  assert.equal(defaultResult.checks[0].timeout_ms, 30_000);
  for (const timeout of [0, -1, 999, 900001, 1.5, "60000", null]) {
    spec.checks[0].timeout_ms = timeout;
    fs.writeFileSync(specPath, JSON.stringify(spec));
    assert.throws(() => loadRunSpec(root, "timeout-run.json"), /timeout_ms must be an integer/);
  }
  spec.checks[0].timeout_ms = 60_000;
  fs.writeFileSync(specPath, JSON.stringify(spec));
  const configuredResult = await evaluateExecution(root, "timeout-run.json");
  assert.equal(configuredResult.status, "passed");
  assert.equal(configuredResult.checks[0].timeout_ms, 60_000);
  spec.checks[0].timeout_ms = 1000;
  spec.checks[0].args = ["-e", "setTimeout(() => {}, 5000)"];
  fs.writeFileSync(specPath, JSON.stringify(spec));
  const timedOut = await evaluateExecution(root, "timeout-run.json", {
    approveStep: async () => true,
  });
  assert.equal(timedOut.status, "failed");
  assert.match(timedOut.checks[0].error, /ETIMEDOUT/);
  assert.equal(timedOut.checks[0].timeout_ms, 1000);
});

test("learning proposals require a passed local evaluation and explicit approval", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/validation.md"), "# Validation evidence\nThe local runtime must pass a version check.\n");
  fs.writeFileSync(path.join(root, "validation-run.json"), `${JSON.stringify({
    task: "Verify local Node runtime availability",
    evidence: ["docs/validation.md"],
    checks: [{ label: "Node version", tool: "node", args: ["--version"] }],
  }, null, 2)}\n`);

  const evaluation = await evaluateExecution(root, "validation-run.json");
  assert.equal(evaluation.status, "passed");
  assert.equal(evaluation.checks[0].status, "passed");
  assert.equal(evaluation.evidence[0].sha256.length, 64);

  const proposal = proposeLearning(root, {
    evaluationId: evaluation.id,
    kind: "pattern",
    text: "Use a local Node version check to confirm the runtime is available.",
  });
  assert.equal(proposal.status, "pending");
  assert.equal(listMemory(root, "pattern").length, 0);
  const approved = decideLearning(root, proposal.proposal_id, "approved");
  assert.equal(approved.status, "approved");
  assert.equal(listMemory(root, "pattern")[0].evaluation_id, evaluation.id);
  assert.throws(() => decideLearning(root, proposal.proposal_id, "approved"), /already approved/);

  fs.writeFileSync(path.join(root, "failed-run.json"), `${JSON.stringify({
    task: "Verify an intentionally invalid runtime flag fails",
    evidence: ["docs/validation.md"],
    checks: [
      { label: "Invalid Node option", tool: "node", args: ["--definitely-not-a-node-option"] },
      { label: "Node version after failure", tool: "node", args: ["--version"] },
    ],
  }, null, 2)}\n`);
  const failedEvaluation = await evaluateExecution(root, "failed-run.json", {
    approveStep: async () => true,
  });
  assert.equal(failedEvaluation.status, "failed");
  assert.equal(failedEvaluation.checks[1].status, "passed");
  assert.equal(failedEvaluation.task_proposals.length, 1);
  assert.equal(listTasks(root).length, 1);
  assert.throws(() => proposeLearning(root, {
    evaluationId: failedEvaluation.id,
    kind: "insight",
    text: "This failed check must not be used to learn a reusable pattern.",
  }), /fully passed evaluation/);
});

test("repeated passing workflow evaluations propose review-only patterns", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/workflow.md"), "# Validation\nUse the local runtime check before reporting success.\n");
  const workflowPath = path.join(root, ".mcpee/workflows/verify-runtime.json");
  fs.writeFileSync(workflowPath, `${JSON.stringify({
    workflow_id: "verify-runtime",
    task: "Verify local runtime availability",
    evidence: ["docs/workflow.md"],
    steps: [{ id: "node-version", label: "Node version", tool: "node", args: ["--version"] }],
  }, null, 2)}\n`);
  syncProject(root);

  const first = await runWorkflow(root, ".mcpee/workflows/verify-runtime.json");
  assert.equal(first.status, "passed");
  assert.deepEqual(first.learning_proposals, []);
  const second = await runWorkflow(root, ".mcpee/workflows/verify-runtime.json");
  assert.equal(second.status, "passed");
  assert.equal(second.learning_proposals.length, 1);
  assert.equal(second.learning_proposals[0].status, "pending");
  assert.equal(second.learning_proposals[0].recurrence_count, 2);
  assert.match(second.learning_proposals[0].text, /same ordered checks in 2 evaluations/);
  assert.equal(listMemory(root, "pattern").length, 0);
  const third = await runWorkflow(root, ".mcpee/workflows/verify-runtime.json");
  assert.deepEqual(third.learning_proposals, []);
  assert.equal(listLearning(root).filter((proposal) => proposal.origin === "recurring-workflow").length, 1);

  const pending = listLearning(root).find((proposal) => proposal.origin === "recurring-workflow");
  assert.ok(pending);
  const approved = decideLearning(root, pending.proposal_id, "approved");
  assert.equal(approved.status, "approved");
  assert.equal(listMemory(root, "pattern")[0].evaluation_id, second.id);
});

test("local workflows run allowlisted checks in order, stop on failure, and record evidence", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/workflow.md"), "# Workflow\nRun local validation before reporting completion.\n");
  const workflowPath = path.join(root, ".mcpee/workflows/verify-runtime.json");
  fs.writeFileSync(workflowPath, `${JSON.stringify({
    workflow_id: "verify-runtime",
    task: "Verify local runtime handling and fail safely",
    evidence: ["docs/workflow.md"],
    steps: [
      { id: "fail-check", label: "Invalid Node option", tool: "node", args: ["--definitely-not-a-node-option"] },
      { id: "skipped-check", label: "Do not run after failure", tool: "node", args: ["--version"] },
    ],
  }, null, 2)}\n`);
  syncProject(root);
  await assert.rejects(
    runWorkflow(root, ".mcpee/workflows/verify-runtime.json", { expectedWorkflowId: "deliver-feature" }),
    /Validation workflow mismatch/,
  );
  const observedOrder = [];
  const result = await runWorkflow(root, ".mcpee/workflows/verify-runtime.json", {
    beforeRun: (preflight) => {
      observedOrder.push("impact");
      assert.equal(preflight.status, "ready");
      assert.equal(preflight.targets[0].target, "docs/workflow.md");
    },
    approveStep: async () => {
      observedOrder.push("approval");
      return true;
    },
  });
  assert.deepEqual(observedOrder, ["impact", "approval"]);
  assert.equal(result.workflow_id, "verify-runtime");
  assert.equal(result.impact_preflight.status, "ready");
  assert.equal(result.status, "failed");
  assert.deepEqual(result.checks.map((step) => step.status), ["failed", "skipped"]);
  assert.equal(result.file, `.mcpee/reports/workflows/${result.id}.json`);
  assert.ok(fs.existsSync(path.join(root, result.file)));
  assert.equal(readEvents(root).filter((event) => event.event_name.startsWith("workflow.")).length, 2);
});

test("post-change completion validates before generating documentation", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/app.js"), "export const value = 1;\n");
  fs.writeFileSync(path.join(root, "docs/validation.md"), "# Validation\nCheck the local runtime.\n");
  fs.writeFileSync(path.join(root, ".mcpee/workflows/verify-runtime.json"), `${JSON.stringify({
    workflow_id: "verify-runtime",
    task: "Verify the local runtime",
    evidence: ["docs/validation.md"],
    steps: [{ id: "node-version", label: "Node version", tool: "node", args: ["--version"] }],
  }, null, 2)}\n`);
  syncProject(root, { generateDocumentation: false });
  installFakeCodeGraph(root);
  fs.writeFileSync(path.join(root, "src/app.js"), "export const value = 2;\n");

  const result = await synchronizeAfterCopilotChanges(root, ["src/app.js"], "verify-runtime", {
    approveSync: async () => true,
  });
  assert.equal(result, 0);
  assert.ok(fs.existsSync(path.join(root, "docs/generated/project-overview.md")));
  const completion = readEvents(root).find((event) =>
    event.event_name === "copilot.post_change_validation.completed");
  assert.equal(completion.attributes.status, "passed");
  assert.equal(completion.attributes.documentation_refreshed, true);
  assert.equal(completion.attributes.workflow_id, "verify-runtime");
});

test("end-to-end sync, routing, validation, documentation, telemetry, and approved learning", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/app.js"), "export function handleRequest() { return true; }\n");
  manageCapability(root, "install", "workflow", "resolve-bug");
  installFakeCodeGraph(root);
  assert.equal(updateCodeGraph(root, { available: true, required: true }).status, "ready");
  fs.writeFileSync(path.join(root, ".mcpee/workflows/resolve-bug.json"), `${JSON.stringify({
    workflow_id: "resolve-bug",
    task: "Fix a failing backend test",
    evidence: ["src/app.js"],
    steps: [{ id: "node-version", label: "Node version", tool: "node", args: ["--version"] }],
  }, null, 2)}\n`);

  const initialSync = syncProject(root);
  assert.equal(initialSync.counts.failed, 0);
  const plan = routeTask(root, "Fix a failing backend test");
  assert.equal(plan.workflow.id, "resolve-bug");
  assert.equal(plan.knowledge_graph_status.codegraph, "ready");
  const layerEvents = readEvents(root).filter(event => event.event_name === "context.layer.completed");
  for (const layer of ["catalog", "memory", "knowledge.lexical", "graph.codegraph"]) {
    assert.ok(layerEvents.some(event => event.attributes.layer === layer && event.attributes.outcome === "success"));
  }
  assert.equal(layerEvents.find(event => event.attributes.layer === "memory").attributes.selected_count, 0);
  const firstValidation = await runWorkflow(root, ".mcpee/workflows/resolve-bug.json", {
    approveStep: async () => true,
  });
  assert.equal(firstValidation.status, "passed");

  let postChangeValidation;
  const exitCode = await synchronizeAfterCopilotChanges(root, ["src/app.js"], "resolve-bug", {
    approveSync: async () => true,
    approveStep: async () => true,
    beforeRun: async () => {},
    onValidation: (result) => { postChangeValidation = result; },
  });
  assert.equal(exitCode, 0);
  assert.equal(postChangeValidation.status, "passed");
  assert.ok(fs.existsSync(path.join(root, "docs/generated/components.md")));
  const proposals = listLearning(root).filter((proposal) => proposal.origin === "recurring-workflow");
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].status, "pending");
  assert.equal(listMemory(root, "pattern").length, 0);
  decideLearning(root, proposals[0].proposal_id, "approved");
  assert.equal(listMemory(root, "pattern").length, 1);
  const events = readEvents(root);
  assert.ok(events.some((event) => event.event_name === "knowledge.sync.completed"));
  assert.ok(events.some((event) => event.event_name === "documentation.generated"));
  assert.ok(events.some((event) => event.event_name === "workflow.completed" &&
    event.attributes.status === "passed"));
});

test("post-change completion leaves documentation untouched when validation fails", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/app.js"), "export const value = 1;\n");
  fs.writeFileSync(path.join(root, "docs/validation.md"), "# Validation\nCheck the local runtime.\n");
  fs.writeFileSync(path.join(root, ".mcpee/workflows/verify-runtime.json"), `${JSON.stringify({
    workflow_id: "verify-runtime",
    task: "Verify the local runtime",
    evidence: ["docs/validation.md"],
    steps: [{ id: "invalid-node-option", label: "Invalid Node option", tool: "node", args: ["--definitely-not-a-node-option"] }],
  }, null, 2)}\n`);
  syncProject(root, { generateDocumentation: false });
  installFakeCodeGraph(root);
  fs.writeFileSync(path.join(root, "src/app.js"), "export const value = 2;\n");

  const result = await synchronizeAfterCopilotChanges(root, ["src/app.js"], "verify-runtime", {
    approveSync: async () => true,
    approveStep: async () => true,
  });
  assert.equal(result, 1);
  assert.equal(fs.existsSync(path.join(root, "docs/generated/project-overview.md")), false);
  const completion = readEvents(root).find((event) =>
    event.event_name === "copilot.post_change_validation.completed");
  assert.equal(completion.attributes.status, "failed");
  assert.equal(completion.attributes.documentation_refreshed, false);
});

test("run lifecycle reports account for all stages using evidence, not model claims", () => {
  const root = temporaryProject();
  initializeProject(root);
  const plan = {
    workflow: { id: "deliver-feature" },
    agent: { id: "backend" },
    skills: [{ id: "implementation" }, { id: "quality" }],
    impact_preflight: { status: "ready", targets: [{ target: "src/app.js" }] },
  };
  const execution = { sessionId: "run-report-session", changedPaths: ["src/app.js"] };
  const events = [
    { event_name: "copilot.execution.started", session_id: execution.sessionId, timestamp: "2026-10-09T12:00:00.000Z" },
    { event_name: "copilot.execution.completed", session_id: execution.sessionId, attributes: { outcome: "success" } },
  ];
  const report = writeRunReport(root, {
    task: "Add an example feature",
    plan,
    execution,
    postChange: {
      validation: {
        status: "passed",
        evaluation_id: "validation-evaluation",
        report: ".mcpee/reports/workflows/validation-evaluation.json",
      },
      documentation: { refreshed: true, files: ["docs/generated/project-overview.md"] },
      learning: { proposal_ids: ["review-only-learning-proposal"] },
    },
    events,
  });
  assert.equal(report.status, "completed");
  assert.deepEqual(report.stages.map((stage) => stage.id), RUN_STAGES);
  assert.deepEqual(report.stages.map((stage) => stage.status), [
    "completed", "completed", "completed", "completed",
    "completed", "completed", "completed", "completed",
  ]);
  assert.equal(report.stages[4].evidence[0].evaluation_id, "validation-evaluation");
  assert.equal(report.stages[7].evidence[0], "review-only-learning-proposal");
  assert.equal(report.task_sha256.length, 64);
  const stored = fs.readFileSync(path.join(root, report.file), "utf8");
  assert.equal(stored.includes("Add an example feature"), false);

  const blocked = writeRunReport(root, {
    task: "Explain a failed workflow",
    plan: { ...plan, impact_preflight: { status: "unavailable", targets: [], reason: "index stale" } },
    execution,
    postChange: { validation: { status: "blocked", reason: "Index refresh was denied." } },
    events,
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.stages[1].status, "blocked");
  assert.equal(blocked.stages[4].status, "blocked");
  assert.equal(blocked.stages[4].reason, "Index refresh was denied.");
  assert.equal(blocked.stages[5].status, "blocked");
  assert.equal(blocked.stages[6].status, "completed");

  const failedTask = "Fail before returning a session result";
  const failedTaskHash = require("node:crypto").createHash("sha256").update(failedTask).digest("hex");
  const failed = writeRunReport(root, {
    task: failedTask,
    plan,
    execution: { sessionId: null, changedPaths: ["src/app.js"], outcome: "failure" },
    events: [{
      event_name: "copilot.execution.completed",
      session_id: null,
      attributes: {
        task_sha256: failedTaskHash,
        outcome: "failure",
        changed_paths: ["src/app.js"],
      },
    }],
    postChange: {
      validation: { status: "passed", evaluation_id: "failed-session-validation" },
      documentation: { refreshed: true, files: ["docs/generated/project-overview.md"] },
    },
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.session_id, null);
  assert.deepEqual(failed.stages.map((stage) => stage.status), [
    "completed", "completed", "completed", "failed",
    "completed", "completed", "completed", "not_applicable",
  ]);
  assert.equal(failed.stages[6].evidence[0].session_event_count, 1);
});

test("approval policy allows only verified read-only invocations and blocks uncertain commands", () => {
  for (const nonInteractive of [false, true]) {
    for (const [toolName, toolArgs] of [
      ["view", { path: "README.md", view_range: [1, 200] }],
      ["glob", { pattern: "**/package.json" }],
      ["grep", { pattern: "test", glob: "package.json", output_mode: "content" }],
      ["rg", { pattern: "test", paths: ["README.md"], output_mode: "content" }],
    ]) {
      assert.equal(assessCopilotToolCall({
        toolName,
        toolArgs,
      }, { nonInteractive }).decision, "allow");
    }
    for (const toolName of ["edit_file", "apply_patch", "unknown_tool"]) {
      assert.equal(assessCopilotToolCall({
        toolName,
        toolArgs: { path: "README.md" },
      }, { nonInteractive }).decision, nonInteractive ? "deny" : "ask");
    }
  }
  assert.equal(isReadOnlyInvocation("node", ["--version"]), true);
  for (const command of [
    "Get-ChildItem",
    "Get-ChildItem -Force",
    "Get-ChildItem -Force | Select-Object Name,Mode",
    "Get-ChildItem | Select-Object Name,Mode,Length",
  ]) {
    assert.equal(assessCopilotToolCall({
      toolName: "powershell", toolArgs: { command },
    }, { nonInteractive: true }).decision, "allow");
  }
  for (const command of [
    "Get-ChildItem; Remove-Item README.md",
    "Get-ChildItem -Force | Select-Object Name,Mode > listing.txt",
    "Get-ChildItem -Force | Select-Object Name,Mode\nSet-Content x y",
    "Get-ChildItem -Path $(Remove-Item README.md)",
    "Get-ChildItem | Select-Object @{Name='x';Expression={Remove-Item README.md}}",
  ]) {
    assert.equal(assessCopilotToolCall({
      toolName: "powershell", toolArgs: { command },
    }, { nonInteractive: true }).decision, "deny");
  }
  assert.equal(isReadOnlyInvocation("git", ["log", "--oneline", "--max-count=5"]), true);
  assert.equal(isReadOnlyInvocation("git", ["log", "--output=report.txt"]), false);
  assert.equal(isReadOnlyInvocation("npm", ["test"]), false);
  assert.equal(assessToolInvocation("node", ["--version"]).requiresApproval, false);
  assert.equal(assessToolInvocation("node", ["-e", "process.exit(0)"]).requiresApproval, true);
  assert.deepEqual(formatApprovalArguments(["--token", "top-secret", "API_TOKEN=still-secret"]), [
    "--token",
    "[REDACTED]",
    "API_TOKEN=[REDACTED]",
  ]);
  assert.equal(assessCopilotToolCall({
    toolName: "shell",
    toolArgs: { command: "git status --short" },
  }).decision, "allow");
  assert.equal(assessCopilotToolCall({
    toolName: "shell",
    toolArgs: { command: "git log --output=secret.txt" },
    },
    { nonInteractive: true },
  ).decision, "deny");
});

test("workflow steps that are not verified read-only stay blocked until explicitly approved", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/approval.md"), "Approval-bound workflow evidence.\n");
  const marker = path.join(root, "unexpected-write.txt");
  fs.writeFileSync(path.join(root, "workflow.json"), `${JSON.stringify({
    workflow_id: "approval-check",
    task: "Verify the workflow approval gate",
    evidence: ["docs/approval.md"],
    steps: [{
      id: "write-marker",
      label: "Write a marker",
      tool: "node",
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "written")`],
    }],
  })}\n`);
  syncProject(root);

  const denied = await runWorkflow(root, "workflow.json");
  assert.equal(denied.checks[0].status, "blocked");
  assert.equal(fs.existsSync(marker), false);
  const approved = await runWorkflow(root, "workflow.json", { approveStep: async () => true });
  assert.equal(approved.checks[0].status, "passed");
  assert.equal(fs.readFileSync(marker, "utf8"), "written");
});

test("workflow blocks state-changing steps when impact evidence is unavailable", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/approval.md"), "Approval-bound workflow evidence.\n");
  const marker = path.join(root, "unexpected-write.txt");
  fs.writeFileSync(path.join(root, "workflow.json"), `${JSON.stringify({
    workflow_id: "missing-impact",
    task: "Verify impact preflight fails closed",
    evidence: ["docs/approval.md"],
    steps: [{
      id: "write-marker",
      label: "Write a marker",
      tool: "node",
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "written")`],
    }],
  })}\n`);
  let approvalRequested = false;
  const result = await runWorkflow(root, "workflow.json", {
    beforeRun: (preflight) => assert.equal(preflight.status, "unavailable"),
    approveStep: async () => {
      approvalRequested = true;
      return true;
    },
  });
  assert.equal(result.checks[0].status, "blocked");
  assert.match(result.checks[0].error, /Impact preflight required/);
  assert.equal(approvalRequested, false);
  assert.equal(fs.existsSync(marker), false);
});

test("failed checks become approval-gated tasks and close only with matching passing evidence", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/task.md"), "Task evidence.\n");
  fs.writeFileSync(path.join(root, "failed.json"), `${JSON.stringify({
    task: "Create a follow-up from a failed check",
    evidence: ["docs/task.md"],
    checks: [{ id: "node-version", label: "Node version", tool: "node", args: ["--bad-option"] }],
  })}\n`);
  const failed = await evaluateExecution(root, "failed.json");
  const [task] = listTasks(root);
  assert.equal(task.evaluation_id, failed.id);
  assert.equal(task.status, "pending");
  assert.throws(() => startTask(root, task.task_id), /must be approved/);
  decideTask(root, task.task_id, "approved");
  startTask(root, task.task_id);

  fs.mkdirSync(path.join(root, "docs/alternate"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/alternate/task.md"), "Different evidence.\n");
  fs.writeFileSync(path.join(root, "different-evidence.json"), `${JSON.stringify({
    task: "Pass a check using different evidence",
    evidence: ["docs/alternate/task.md"],
    checks: [{ id: "node-version", label: "Node version", tool: "node", args: ["--version"] }],
  })}\n`);
  const differentEvidence = await evaluateExecution(root, "different-evidence.json");
  assert.throws(() => completeTask(root, task.task_id, differentEvidence.id), /same evidence and matching check/);
  fs.writeFileSync(path.join(root, "resolved.json"), `${JSON.stringify({
    task: "Recheck the resolved Node version",
    evidence: ["docs/task.md"],
    checks: [{ id: "node-version", label: "Node version", tool: "node", args: ["--version"] }],
  })}\n`);
  fs.appendFileSync(path.join(root, "docs/task.md"), "\nUpdated after the task was approved.\n");
  const resolved = await evaluateExecution(root, "resolved.json");
  assert.equal(completeTask(root, task.task_id, resolved.id).status, "completed");
});

test("Copilot execution requires explicit transfer approval and gates each tool call", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/example.js"), "export const value = 1;\n");
  syncProject(root);
  const policies = readCatalog().catalog.policies;
  const plan = {
    workflow: { id: "resolve-bug" },
    agent: { id: "debugger" },
    skills: [{ id: "analysis" }],
    playbooks: [{ id: "migration-strategy", guidance: "Migration strategy controls and cutover." }],
    technical_guidance: [{ id: "backend-guidance", guidance: "Version-aware backend guidance." }],
    scorecards: [{ id: "quality", criteria: ["Check evidence."] }],
    eval_cases: [{ id: "grounding", expected_behaviors: ["Cite source evidence."] }],
    prompt_examples: [{ id: "backend-prompt", example: "Investigate project versions before editing." }],
    policies: policies.map(policy => policy.id),
    policy_controls: policies,
    memory: [{ text: "Keep project data local unless explicitly authorized." }],
    knowledge: [],
    knowledge_graph: [],
    impact_preflight: analyzeImpacts(root, ["src/example.js"]),
    local_tools: ["node"],
  };
  let clientConfig;
  let promptText;
  const permissionReviews = [];
  const client = {
    async start() {},
    async createSession(config) {
      clientConfig = config;
      return {
        sessionId: "copilot-test-session",
        on(handler) {
          this.sdkEventHandler = handler;
        },
        async sendAndWait(message, timeoutMs) {
          assert.equal(timeoutMs, 1_800_000);
          promptText = message.prompt;
          this.sdkEventHandler({
            id: "sdk-message-event",
            type: "assistant.message",
            data: { content: "Copilot completed the task." },
          });
          this.sdkEventHandler({
            id: "sdk-usage-event",
            parentId: "sdk-message-event",
            type: "assistant.usage",
            data: { model: "test-model", inputTokens: 123, outputTokens: 45, cost: 0.01,
              cacheReadTokens: 60, cacheWriteTokens: 10 },
          });
          this.sdkEventHandler({
            type: "session.usage_info",
            data: { currentTokens: 1200, tokenLimit: 128000, systemTokens: 100,
              conversationTokens: 1000, toolDefinitionsTokens: 100 },
          });
          this.sdkEventHandler({ type: "skill.invoked", data: { name: "runtime-review", trigger: "tool" } });
          this.sdkEventHandler({ type: "subagent.completed",
            data: { agentName: "reviewer", toolCallId: "agent-call", durationMs: 250, cancelled: true } });
          this.sdkEventHandler({
            id: "sdk-tool-start",
            type: "tool.execution_start",
            data: { toolCallId: "read-call-1", toolName: "read_file", arguments: { path: "README.md" } },
          });
          this.sdkEventHandler({
            id: "sdk-tool-done",
            parentId: "sdk-tool-start",
            type: "tool.execution_complete",
            data: { toolCallId: "read-call-1", toolName: "read_file", success: true, result: "read complete" },
          });
          const readDecision = await config.hooks.onPreToolUse(
            { toolName: "read_file", toolCallId: "read-call-1", toolArgs: { path: "README.md" } },
            { sessionId: "copilot-test-session" },
          );
          const writeDecision = await config.hooks.onPreToolUse(
            { toolName: "edit", toolCallId: "write-call-1", toolArgs: { fileName: "src/example.js", content: "const localCapture = true; API_TOKEN=placeholder" } },
            { sessionId: "copilot-test-session" },
          );
          assert.equal(readDecision.permissionDecision, "allow");
          assert.equal(writeDecision.permissionDecision, "allow");
          await config.hooks.onPostToolUse(
            { toolName: "edit", toolCallId: "write-call-1", toolArgs: { fileName: "src/example.js", content: "const localCapture = true; API_TOKEN=placeholder" } },
            { sessionId: "copilot-test-session" },
          );
          const permissionDecision = await config.onPermissionRequest(
            { kind: "shell", fullCommandText: "npm install", intention: "Install a package" },
            { sessionId: "copilot-test-session" },
          );
          assert.deepEqual(permissionDecision, { kind: "approved" });
          return { data: { content: "Copilot completed the task." } };
        },
        async disconnect() {},
      };
    },
    async stop() {},
  };

  await assert.rejects(
    runCopilotTask(root, "Modify the project", plan, { clientFactory: () => client }),
    /explicit human approval is required/,
  );
  const result = await runCopilotTask(root, "Modify the project", plan, {
    approved: true,
    interactive: true,
    impactPreflight: plan.impact_preflight,
    conversationContext: [
      { role: "user", content: "What is the current behavior?" },
      { role: "assistant", content: "The feature currently returns a cached value." },
    ],
    contextPackage: {
      kind: "grounded",
      retrieval: "hybrid",
      content: "GROUNDED_SOURCE_EVIDENCE",
      files: ["src/example.js"],
      byteLength: 24,
      estimatedTokens: 7,
    },
    approvePermission: async (request, description) => {
      permissionReviews.push({ request, description });
      return true;
    },
    approveTool: async (input, reason, impact) => input.toolName === "edit" && impact.status === "ready",
    clientFactory: () => client,
  });

  assert.equal(result.sessionId, "copilot-test-session");
  assert.equal(result.content, "Copilot completed the task.");
  assert.deepEqual(result.changedPaths, ["src/example.js"]);
  assert.match(promptText, /MCPEE routing plan/);
  for (const policy of policies) assert.ok(promptText.includes(JSON.stringify(policy.description)));
  assert.match(promptText, /resolve-bug.*understand -> analyze -> plan -> execute -> validate -> document -> observe -> learn/s);
  assert.match(promptText, /Grounded local evidence selected under a context budget/);
  assert.match(promptText, /GROUNDED_SOURCE_EVIDENCE/);
  assert.match(promptText, /Version-aware backend guidance/);
  assert.match(promptText, /working baseline/);
  assert.match(promptText, /uncovered, uncertain, version-sensitive or changed behavior/);
  assert.match(promptText, /disclose unavailable verification/);
  assert.match(promptText, /finding about the claim, not proof that the underlying capability is absent/);
  assert.match(promptText, /Clearly stated unverified scope is not such a claim/);
  assert.match(promptText, /Migration strategy controls and cutover/);
  assert.match(promptText, /Cite source evidence/);
  assert.match(promptText, /Investigate project versions before editing/);
  assert.match(promptText, /Recent chat history for continuity only/);
  assert.match(promptText, /What is the current behavior/);
  assert.deepEqual(clientConfig.availableTools, ["builtin:*"]);
  assert.match(clientConfig.systemMessage.content, /internal MCPEE executor/);
  assert.match(clientConfig.systemMessage.content, /mcpee_run apply to the outer chat/);
  assert.match(clientConfig.systemMessage.content, /Do not call mcpee_run again/);
  assert.match(clientConfig.systemMessage.content, /does not authorize additional transfers or actions/);
  assert.equal(clientConfig.enableSessionTelemetry, false);
  assert.equal(permissionReviews.length, 1);
  assert.match(permissionReviews[0].description, /npm install/);
  const copilotEvents = readEvents(root);
  const successfulCompletion = copilotEvents.find(event =>
    event.event_name === "copilot.execution.completed" && event.attributes.outcome === "success");
  assert.deepEqual(successfulCompletion.attributes.changed_paths, result.changedPaths);
  const serializedEvents = JSON.stringify(copilotEvents);
  assert.match(serializedEvents, /localCapture/);
  assert.doesNotMatch(serializedEvents, /API_TOKEN=placeholder/);
  assert.equal(copilotEvents.some((event) =>
    event.event_name === "copilot.response.received" &&
    event.payload.content === "Copilot completed the task."), true);
  const usageEvent = copilotEvents.find((event) => event.event_name === "copilot.sdk.assistant.usage");
  assert.equal(usageEvent.attributes.cache_read_tokens, 60);
  assert.equal(usageEvent.attributes.cache_write_tokens, 10);
  assert.equal(usageEvent.attributes.cost_unit, "sdk-reported-unit-unspecified");
  const window = copilotEvents.find(event => event.event_name === "copilot.sdk.session.usage_info");
  assert.equal(window.attributes.current_tokens, 1200);
  assert.equal(window.attributes.token_limit, 128000);
  assert.equal(window.attributes.tool_definition_tokens, 100);
  assert.equal(copilotEvents.find(event => event.event_name === "copilot.sdk.skill.invoked").attributes.skill_name, "runtime-review");
  assert.equal(copilotEvents.find(event => event.event_name === "copilot.sdk.subagent.completed").attributes.outcome, "cancelled");
  const started = copilotEvents.find(event => event.event_name === "copilot.execution.started");
  assert.equal(started.attributes.prompt_bytes, Buffer.byteLength(promptText, "utf8"));
  assert.equal(started.attributes.prompt_estimated_tokens, Math.ceil(promptText.length / 4));
  assert.equal(started.attributes.context_estimated_tokens, 7);
  assert.equal(started.payload.delivery.agent_id, plan.agent.id);
  assert.deepEqual(started.payload.delivery.skill_ids, plan.skills.map(skill => skill.id));
  assert.deepEqual(started.payload.delivery.grounded_sources, ["src/example.js"]);
  assert.deepEqual({
    model: usageEvent.attributes.model,
    input: usageEvent.attributes.input_tokens,
    output: usageEvent.attributes.output_tokens,
    cost: usageEvent.attributes.cost,
  }, { model: "test-model", input: 123, output: 45, cost: 0.01 });
  const sdkMessage = copilotEvents.find((event) => event.source_event_id === "sdk-message-event");
  assert.equal(usageEvent.attributes.sdk_previous_event_id, sdkMessage.source_event_id);
  assert.equal(usageEvent.parent_id, started.event_id);
  const sdkToolStart = copilotEvents.find((event) => event.source_event_id === "sdk-tool-start");
  const sdkToolComplete = copilotEvents.find((event) => event.source_event_id === "sdk-tool-done");
  assert.equal(sdkToolComplete.parent_id, sdkToolStart.event_id);
  assert.equal(sdkToolComplete.tool_call_id, "read-call-1");
  assert.equal(sdkToolComplete.attributes.result, "success");
  assert.ok(Number.isFinite(sdkToolComplete.attributes.duration_ms));
  assert.equal(copilotEvents.some((event) =>
    event.event_name === "copilot.tool.authorization" &&
    event.attributes.approval === "human-approved-once"), true);
  const toolEvent = copilotEvents.find((event) => event.event_name === "copilot.tool.requested");
  assert.equal(toolEvent.tool_call_id, "read-call-1");
  const executionTraceId = copilotEvents.find((event) =>
    event.event_name === "copilot.execution.started").trace_id;
  assert.ok(executionTraceId);
  assert.equal(copilotEvents.filter((event) => event.trace_id !== null)
    .every((event) => event.trace_id === executionTraceId), true);
});

test("Copilot execution aborts timed-out work and preserves timeout and cleanup failures", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const plan = { workflow: { id: "resolve-bug" }, agent: { id: "debugger" } };
  for (const abortFails of [false, true]) {
    const calls = [];
    const timeoutError = new Error("Timeout after 1800000ms waiting for session.idle");
    const abortError = new Error("abort unavailable");
    const client = {
      async start() {},
      async createSession() {
        return {
          sessionId: `timeout-${abortFails}`,
          async sendAndWait(message, timeoutMs) {
            assert.equal(typeof message.prompt, "string");
            assert.equal(timeoutMs, 1_800_000);
            throw timeoutError;
          },
          async abort() {
            calls.push("abort");
            if (abortFails) throw abortError;
          },
          async disconnect() { calls.push("disconnect"); },
        };
      },
      async stop() { calls.push("stop"); },
    };
    await assert.rejects(runCopilotTask(root, "Inspect only", plan, {
      approved: true,
      clientFactory: () => client,
    }), (error) => {
      if (abortFails) {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [timeoutError, abortError]);
      } else {
        assert.equal(error, timeoutError);
      }
      return true;
    });

    assert.deepEqual(calls, ["abort", "disconnect", "stop"]);
    const completion = readEvents(root).find((event) =>
      event.event_name === "copilot.execution.completed" &&
      event.session_id === `timeout-${abortFails}`);
    assert.equal(completion.attributes.outcome, "failure");
    assert.match(completion.attributes.error, /Timeout after 1800000ms/);
    if (abortFails) assert.match(completion.attributes.error, /abort unavailable/);
  }
});

test("Copilot execution cancels the SDK before disconnecting when its host cancels", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const controller = new AbortController();
  const cancellation = new Error("Host cancelled this inspection");
  const calls = [];
  const client = {
    async start() {},
    async getAuthStatus() { return { isAuthenticated: true }; },
    async createSession() {
      return {
        sessionId: "host-cancelled-session",
        async sendAndWait() {
          controller.abort(cancellation);
          return new Promise(() => {});
        },
        async abort() { calls.push("abort"); },
        async disconnect() { calls.push("disconnect"); },
      };
    },
    async stop() { calls.push("stop"); },
  };
  await assert.rejects(runCopilotTask(root, "Inspect only", {
    workflow: { id: "resolve-bug" }, agent: { id: "debugger" },
  }, {
    approved: true,
    signal: controller.signal,
    clientFactory: () => client,
  }), (error) => error === cancellation);
  assert.deepEqual(calls, ["abort", "disconnect", "stop"]);
});

test("Copilot execution rejects unauthenticated runtimes before creating a session", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const calls = [];
  const client = {
    async start() { calls.push("start"); },
    async getAuthStatus() { return { isAuthenticated: false }; },
    async createSession() { assert.fail("Unauthenticated session must not be created"); },
    async stop() { calls.push("stop"); },
  };
  await assert.rejects(runCopilotTask(root, "Inspect only", {
    workflow: { id: "resolve-bug" }, agent: { id: "debugger" },
  }, { approved: true, clientFactory: () => client }), /not authenticated/);
  assert.deepEqual(calls, ["start", "stop"]);
});

test("Copilot failure telemetry preserves file mutations for post-change recovery", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const source = path.join(root, "src/app.js");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "export function app() {}\n");
  syncProject(root);
  const plan = {
    workflow: { id: "deliver-feature" },
    agent: { id: "backend" },
    impact_preflight: { status: "ready", targets: [{ target: "src/app.js" }] },
  };
  const client = {
    async start() {},
    async createSession(config) {
      return {
        sessionId: "failed-copilot-session",
        async sendAndWait() {
          await config.hooks.onPostToolUse(
            { toolName: "edit_file", toolArgs: { fileName: "src/app.js" } },
            { sessionId: "failed-copilot-session" },
          );
          throw new Error("session ended unexpectedly");
        },
        async disconnect() {},
      };
    },
    async stop() {},
  };

  await assert.rejects(runCopilotTask(root, "Update the app", plan, {
    approved: true,
    clientFactory: () => client,
  }), /session ended unexpectedly/);
  const completion = readEvents(root).find((event) =>
    event.event_name === "copilot.execution.completed" &&
    event.session_id === "failed-copilot-session");
  assert.equal(completion.attributes.outcome, "failure");
  assert.deepEqual(completion.attributes.changed_paths, ["src/app.js"]);
});

test("Copilot blocks state-changing tool calls when impact preflight is unavailable", async () => {
  const root = temporaryProject();
  initializeProject(root);
  let decision;
  let approvalRequested = false;
  const client = {
    async start() {},
    async createSession(config) {
      return {
        sessionId: "copilot-impact-test-session",
        async sendAndWait() {
          decision = await config.hooks.onPreToolUse(
            { toolName: "edit_file", toolArgs: { fileName: "src/app.js", content: "updated" } },
            { sessionId: "copilot-impact-test-session" },
          );
          return { data: { content: "done" } };
        },
        async disconnect() {},
      };
    },
    async stop() {},
  };
  await runCopilotTask(root, "Update a source file", {
    workflow: { id: "deliver-feature" },
    agent: { id: "backend" },
    impact_preflight: { status: "unavailable" },
  }, {
    approved: true,
    interactive: true,
    impactPreflight: {
      status: "unavailable",
      reason: "No indexed evidence source is available for impact analysis.",
      targets: [],
      unindexed: [],
    },
    approveTool: async () => {
      approvalRequested = true;
      return true;
    },
    clientFactory: () => client,
  });
  assert.equal(decision.permissionDecision, "deny");
  assert.match(decision.permissionDecisionReason, /Impact preflight is not ready/);
  assert.equal(approvalRequested, false);
  assert.equal(readEvents(root).some((event) =>
    event.event_name === "copilot.tool.authorization" &&
    event.attributes.impact_preflight === "unavailable"), true);
});

test("Copilot requires fresh impact evidence for the exact file mutation target", async () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/indexed.js"), "export const value = 1;\n");
  fs.writeFileSync(path.join(root, "src/unindexed.js"), "export const other = 2;\n");
  syncProject(root);
  const preflight = analyzeImpacts(root, ["src/indexed.js"]);
  let approvalRequested = false;
  const approvedTargets = [];
  const decisions = [];
  const client = {
    async start() {},
    async createSession(config) {
      return {
        sessionId: "copilot-exact-impact-session",
        async sendAndWait() {
          decisions.push(await config.hooks.onPreToolUse(
            { toolName: "apply_patch", toolArgs: "*** Begin Patch\n*** Update File: src/indexed.js\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch\n" },
            { sessionId: "copilot-exact-impact-session" },
          ));
          decisions.push(await config.hooks.onPreToolUse(
            { toolName: "edit_file", toolArgs: { fileName: "src/unindexed.js" } },
            { sessionId: "copilot-exact-impact-session" },
          ));
          decisions.push(await config.hooks.onPreToolUse(
            { toolName: "edit_file", toolArgs: { content: "no target path" } },
            { sessionId: "copilot-exact-impact-session" },
          ));
          fs.appendFileSync(path.join(root, "src/indexed.js"), "// source changed after sync\n");
          decisions.push(await config.hooks.onPreToolUse(
            { toolName: "edit_file", toolArgs: { fileName: "src/indexed.js" } },
            { sessionId: "copilot-exact-impact-session" },
          ));
          return { data: { content: "done" } };
        },
        async disconnect() {},
      };
    },
    async stop() {},
  };
  await runCopilotTask(root, "Review and update source files", {
    workflow: { id: "deliver-feature" },
    agent: { id: "backend" },
    impact_preflight: preflight,
  }, {
    approved: true,
    interactive: true,
    impactPreflight: preflight,
    approveTool: async (_input, _reason, impact) => {
      approvalRequested = true;
      approvedTargets.push(impact.targets.map((target) => target.target));
      return impact.status === "ready";
    },
    clientFactory: () => client,
  });
  assert.deepEqual(decisions.map((decision) => decision.permissionDecision), ["allow", "allow", "deny", "deny"]);
  assert.equal(approvalRequested, true);
  assert.deepEqual(approvedTargets, [["src/indexed.js"], ["src/unindexed.js"]]);
  assert.match(decisions[2].permissionDecisionReason, /did not identify a verifiable/);
  assert.match(decisions[3].permissionDecisionReason, /changed after sync/);
});

test("Repomix packs only selected safe routing sources through stdin", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "secrets"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "guide.md"), "# Local guide\n");
  fs.writeFileSync(path.join(root, "src", "app.js"), "export const app = true;\n");
  fs.writeFileSync(path.join(root, "secrets", "token.txt"), "never package this\n");
  fs.writeFileSync(path.join(root, "outside.txt"), "outside\n");
  const plan = {
    knowledge: [{ source_path: "docs/guide.md" }],
    knowledge_graph: [{ source_path: "src/app.js" }],
    memory: [{
      evidence: [
        { path: "docs/guide.md", status: "current" },
        { path: "secrets/token.txt", status: "current" },
        { path: "outside.txt", status: "stale" },
      ],
    }],
  };
  const calls = [];
  const packed = packRelevantContext(root, plan, {
    invokeTool: (...args) => {
      calls.push(args);
      return { status: "success", stdout: "# Packed context\n", stderr: "", exit_code: 0 };
    },
  });

  assert.deepEqual(packed.files, ["docs/guide.md", "src/app.js"]);
  assert.equal(packed.byteLength, Buffer.byteLength("# Packed context\n"));
  assert.equal(packed.content, "# Packed context\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "repomix");
  assert.deepEqual(calls[0][2].slice(0, 4), ["--stdin", "--stdout", "--style", "markdown"]);
  assert.equal(calls[0][3].input, "docs/guide.md\nsrc/app.js\n");
  assert.equal(calls[0][3].maxBufferBytes, 2 * 1024 * 1024 + 1);
  const config = JSON.parse(fs.readFileSync(calls[0][2].at(-1), "utf8"));
  assert.equal(config.security.enableSecurityCheck, true);
  assert.ok(config.ignore.customPatterns.includes("**/.env"));
  assert.ok(config.ignore.customPatterns.includes("**/.mcpee/**"));
});

test("Repomix context packaging rejects escaping, missing, empty, failed, and oversized sources", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "guide.md"), "# Guide\n");
  const makePlan = (sourcePath) => ({
    knowledge: [{ source_path: sourcePath }],
    knowledge_graph: [],
    memory: [],
  });
  assert.throws(() => collectContextFiles(root, makePlan("../outside.md")), /inside the project/);
  assert.throws(() => collectContextFiles(root, makePlan("docs/missing.md")), /no longer exists/);
  assert.throws(() => packRelevantContext(root, {
    knowledge: [],
    knowledge_graph: [],
    memory: [{ evidence: [{ path: ".env", status: "current" }] }],
  }), /no eligible local source files/);
  assert.throws(() => packRelevantContext(root, makePlan("docs/guide.md"), {
    invokeTool: () => ({ status: "failed", error: "Repomix unavailable", stderr: "", exit_code: null }),
  }), /Repomix failed.*unavailable/);
  assert.throws(() => packRelevantContext(root, makePlan("docs/guide.md"), {
    invokeTool: () => ({ status: "success", stdout: "x".repeat(2 * 1024 * 1024 + 1), stderr: "", exit_code: 0 }),
  }), /exceeds MCPEE's 2097152-byte limit/);
});

test("Repomix tool invocation passes stdin without logging its content", () => {
  const root = temporaryProject();
  initializeProject(root);
  const sentinel = "private-repomix-source-path";
  const result = invokeTool(root, "node", [
    "-e",
    "process.stdin.setEncoding('utf8'); process.stdin.on('data', data => process.stdout.write(data));",
  ], { input: sentinel });
  assert.equal(result.status, "success");
  assert.equal(result.stdout, sentinel);
  assert.equal(readEvents(root).some((event) => JSON.stringify(event).includes(sentinel)), false);
});

test("Copilot permission requests fail closed without an interactive approval channel", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const plan = {
    workflow: { id: "understand-project" },
    agent: { id: "orchestrator" },
    skills: [],
    policies: [],
    memory: [],
    knowledge: [],
    knowledge_graph: [],
    local_tools: [],
  };
  let permissionDecision;
  const client = {
    async start() {},
    async createSession(config) {
      return {
        sessionId: "noninteractive-session",
        async sendAndWait() {
          const toolDecision = await config.hooks.onPreToolUse(
            { toolName: "edit_file", toolArgs: { path: "README.md" } },
            { sessionId: "noninteractive-session" },
          );
          assert.equal(toolDecision.permissionDecision, "deny");
          permissionDecision = await config.onPermissionRequest(
            { kind: "write", fileName: "README.md", intention: "Edit project documentation" },
            { sessionId: "noninteractive-session" },
          );
          return { data: { content: "Stopped safely." } };
        },
        async disconnect() {},
      };
    },
    async stop() {},
  };
  await runCopilotTask(root, "Review the project", plan, {
    approved: true,
    interactive: false,
    clientFactory: () => client,
  });
  assert.deepEqual(permissionDecision, { kind: "user-not-available" });
});

test("CLI evaluates a run and gates durable learning behind approval", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/runtime.md"), "# Runtime\nNode is a required local runtime.\n");
  fs.writeFileSync(path.join(root, "run.json"), `${JSON.stringify({
    task: "Verify the local Node runtime",
    evidence: ["docs/runtime.md"],
    checks: [{ label: "Node version", tool: "node", args: ["--version"] }],
  })}\n`);

  const evaluationOutput = execFileSync(process.execPath, [
    cli, "evaluate", "--project", root, "--run", "run.json",
  ], { encoding: "utf8" });
  const evaluationId = evaluationOutput.match(/Evaluation ([0-9a-f-]{36}): passed/)?.[1];
  assert.ok(evaluationId);

  const proposalOutput = execFileSync(process.execPath, [
    cli, "learn", "propose", "--project", root, "--evaluation", evaluationId,
    "--kind", "insight", "--text", "Confirm Node runtime availability using a local version check.",
  ], { encoding: "utf8" });
  const proposalId = proposalOutput.match(/proposal ([0-9a-f-]{36}) is pending/)?.[1];
  assert.ok(proposalId);
  assert.equal(listMemory(root, "insight").length, 0);

  execFileSync(process.execPath, [cli, "learn", "approve", proposalId, "--project", root], { encoding: "utf8" });
  assert.equal(listMemory(root, "insight").length, 1);
});

test("source ingestion is incremental, source-traceable, local-only, and cleans stale derived artifacts", () => {
  const root = temporaryProject();
  initializeProject(root);
  const businessPath = path.join(root, "knowledge/sources/business/requirements.md");
  const sourceCodePath = path.join(root, "src/service.ts");
  const secretPath = path.join(root, ".env");
  const pdfPath = path.join(root, "design.pdf");
  fs.mkdirSync(path.dirname(businessPath), { recursive: true });
  fs.mkdirSync(path.dirname(sourceCodePath), { recursive: true });
  fs.writeFileSync(businessPath, "# Payment architecture\n\nPayments must be idempotent and traceable.\n");
  fs.writeFileSync(sourceCodePath, "export class PaymentService {}\n");
  fs.writeFileSync(secretPath, "API_TOKEN=never-read\n");
  fs.writeFileSync(pdfPath, "PDF conversion requires MarkItDown");
  fs.mkdirSync(path.join(root, "node_modules/private"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules/private/leak.js"), "ignored package source");

  const first = syncProject(root, { tools: [] });
  assert.ok(first.counts.processed >= 2);
  assert.equal(first.sources.some((source) =>
    /^\.github\/(?:agents|skills|prompts|instructions)\/mcpee-|^\.github\/hooks\/mcpee-/.test(source.path)), false);
  assert.equal(first.counts["requires-tool"], 1);
  assert.equal(first.sources.some((source) => source.path === ".env"), false);
  assert.equal(first.sources.some((source) => source.path.includes("node_modules")), false);
  assert.equal(first.sources.find((source) => source.path === "knowledge/sources/business/requirements.md").category, "business");
  const matches = searchKnowledge(root, "idempotent payments");
  assert.equal(matches[0].source_path, "knowledge/sources/business/requirements.md");
  const vectorMatches = searchKnowledgeVector(root, "idempotent payments");
  assert.equal(vectorMatches[0].source_path, "knowledge/sources/business/requirements.md");
  assert.ok(vectorMatches[0].score > 0 && vectorMatches[0].score <= 1);

  const indexedDoc = path.join(root, matches[0].normalized_path);
  const manifest = path.join(root, "knowledge/traceability/source-manifest.json");
  const beforeManifest = fs.readFileSync(manifest, "utf8");
  const beforeDocument = fs.readFileSync(indexedDoc, "utf8");
  const overviewPath = path.join(root, "docs/generated/project-overview.md");
  const beforeOverview = fs.readFileSync(overviewPath, "utf8");
  const second = syncProject(root, { tools: [] });
  assert.equal(second.counts.processed, 0);
  assert.equal(second.counts.unchanged, first.counts.processed);
  assert.equal(fs.readFileSync(indexedDoc, "utf8"), beforeDocument);
  assert.equal(fs.readFileSync(overviewPath, "utf8"), beforeOverview);
  assert.ok(second.documentation.counts.unchanged > 0);
  assert.notEqual(fs.readFileSync(manifest, "utf8"), beforeManifest);

  const rebuilt = syncProject(root, { tools: [], force: true });
  assert.equal(rebuilt.counts.processed, first.counts.processed);
  assert.equal(rebuilt.counts.unchanged, 0);

  fs.unlinkSync(businessPath);
  const third = syncProject(root, { tools: [] });
  assert.equal(third.removed.length, 3);
  assert.equal(fs.existsSync(indexedDoc), false);
  assert.equal(searchKnowledge(root, "idempotent payments").length, 0);
});

test("source processor catalog drives complete categories and classifies common knowledge sources", () => {
  const root = temporaryProject();
  initializeProject(root);
  const catalog = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../catalog/source-processors/processors.json"),
    "utf8",
  ));
  const processorsByCategory = new Map();
  for (const processor of catalog.processors) {
    assert.ok(processor.formats.length > 0, `processor has no declared formats: ${processor.id}`);
    assert.ok(processor.outputs.length > 0, `processor has no declared outputs: ${processor.id}`);
    for (const category of processor.categories) {
      assert.equal(processorsByCategory.has(category), false, `duplicate processor category: ${category}`);
      processorsByCategory.set(category, processor.id);
    }
  }

  const examples = {
    "src/Widget.vue": ["source-code", "source-code"],
    "docs/guide.txt": ["documentation", "markdown"],
    "Dockerfile": ["infrastructure", "infrastructure"],
    "var/log/service.log": ["logs", "logs"],
    "events/stream.jsonl": ["logs", "logs"],
    "knowledge/sources/operations/runbook.md": ["operations", "operations"],
  };
  for (const [sourcePath, [category]] of Object.entries(examples)) {
    const absolute = path.join(root, sourcePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, "source-grounded knowledge\n");
    assert.equal(classifySource(sourcePath), category);
  }

  const result = syncProject(root);
  for (const [sourcePath, [category, processor]] of Object.entries(examples)) {
    const source = result.sources.find((entry) => entry.path === sourcePath);
    assert.equal(source.category, category);
    assert.equal(source.processor, processor);
    assert.equal(processorsByCategory.get(category), processor);
  }
  const operationsReport = fs.readFileSync(
    path.join(root, "docs/generated/quality-and-operations.md"),
    "utf8",
  );
  assert.match(operationsReport, /var\/log\/service\.log/);
  assert.match(operationsReport, /events\/stream\.jsonl/);
});

test("sync detects tampered derived knowledge and rebuilds it from the unchanged source", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.writeFileSync(path.join(root, "mcpee.config.yml"), [
    "version: 1",
    "knowledge:",
    "  sourceRoots:",
    "    - docs",
    "",
  ].join("\n"));
  const sourcePath = "docs/guide.md";
  const source = path.join(root, sourcePath);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "# Verified source\nThe original content is authoritative.\n");

  const initial = syncProject(root);
  const indexed = initial.sources.find((entry) => entry.path === sourcePath);
  assert.equal(indexed.status, "processed");
  const normalizedPath = path.join(root, indexed.normalized_path);
  const extractedPath = path.join(root, indexed.extracted_path);
  const traceabilityPath = path.join(root, indexed.traceability_path);
  const normalized = fs.readFileSync(normalizedPath, "utf8");
  fs.writeFileSync(normalizedPath, `${normalized}\nTampered derived content.\n`);

  const repaired = syncProject(root);
  assert.equal(repaired.counts.processed, 1);
  assert.equal(repaired.counts.unchanged, 0);
  assert.equal(fs.readFileSync(normalizedPath, "utf8"), normalized);

  const metadata = JSON.parse(fs.readFileSync(extractedPath, "utf8"));
  const traceability = JSON.parse(fs.readFileSync(traceabilityPath, "utf8"));
  assert.equal(metadata.normalized_sha256,
    require("node:crypto").createHash("sha256").update(normalized).digest("hex"));
  assert.equal(traceability.derived.normalized_sha256, metadata.normalized_sha256);
  traceability.source.sha256 = "tampered";
  fs.writeFileSync(traceabilityPath, `${JSON.stringify(traceability)}\n`);
  const repairedTraceability = syncProject(root);
  assert.equal(repairedTraceability.counts.processed, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(traceabilityPath, "utf8")).derived.extracted_sha256,
    require("node:crypto").createHash("sha256")
      .update(fs.readFileSync(extractedPath, "utf8")).digest("hex"),
  );
});

test("local embeddings build traceable chunks and produce a bounded grounded context with stale-index fallback", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const source = path.join(root, "knowledge/sources/business/refunds.md");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "# Refund process\n\nSupport staff verify refunds before settlement.\n");
  syncProject(root);
  assert.equal(fs.existsSync(path.join(root, ".mcpee/indexes/embedding-index.json")), false);
  const lexical = await searchGroundedContext(root, "refund handling", { maxTokens: 512 });
  assert.equal(lexical.retrieval, "lexical-fallback");
  assert.equal(lexical.vector_search_performed, false);
  assert.equal(lexical.vector_candidate_count, 0);
  assert.equal(lexical.selected_vector_count, 0);
  assert.ok(lexical.selected_lexical_count > 0);
  await assert.rejects(searchGroundedContext(root, "refund", { maxTokens: 0 }), /maxTokens/);
  assert.equal(readEvents(root).findLast(event =>
    event.event_name === "context.layer.completed").attributes.outcome, "failure");

  const originalHost = process.env.MCPEE_OLLAMA_HOST;
  process.env.MCPEE_OLLAMA_HOST = "http://example.com";
  await assert.rejects(buildEmbeddingIndex(root), /loopback Ollama endpoint/);
  if (originalHost === undefined) delete process.env.MCPEE_OLLAMA_HOST;
  else process.env.MCPEE_OLLAMA_HOST = originalHost;

  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url === "/api/tags") {
        response.end(JSON.stringify({ models: [{ name: "embeddinggemma:latest" }] }));
        return;
      }
      if (request.method === "POST" && request.url === "/api/embed") {
        const { input } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const vectors = input.map((text) => /refund/i.test(text) ? [0, 1, 0] : [1, 0, 0]);
        response.end(JSON.stringify({ embeddings: vectors }));
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previousHost = process.env.MCPEE_OLLAMA_HOST;
  process.env.MCPEE_OLLAMA_HOST = `http://127.0.0.1:${server.address().port}`;
  try {
    const indexed = await buildEmbeddingIndex(root);
    assert.ok(indexed.chunkCount > 0);
    const grounded = await searchGroundedContext(root, "customer refund handling", { maxTokens: 512 });
    assert.equal(grounded.retrieval, "hybrid");
    assert.equal(grounded.vector_search_performed, true);
    assert.ok(grounded.vector_candidate_count > 0);
    const groundingEvent = readEvents(root).findLast(event =>
      event.event_name === "context.layer.completed" && event.attributes.layer === "knowledge.grounding");
    assert.equal(groundingEvent.attributes.vector_search_performed, true);
    assert.equal(groundingEvent.attributes.estimated_tokens, grounded.estimated_tokens);
    assert.equal(groundingEvent.payload.sources.length, grounded.evidence.length);
    assert.ok(grounded.estimated_tokens <= 512);
    assert.equal(grounded.evidence[0].source_path, "knowledge/sources/business/refunds.md");
    assert.match(grounded.context, /refunds before settlement/);
    assert.match(grounded.context, /sha256 [a-f0-9]{64}/);

    fs.writeFileSync(source, "# Refund process\n\nSupport staff verify updated refund claims before settlement.\n");
    syncProject(root);
    const stale = await searchGroundedContext(root, "updated refund claims", { maxTokens: 512 });
    assert.equal(stale.retrieval, "hybrid+lexical-fallback");
    assert.match(stale.context, /updated refund claims/);
    await buildEmbeddingIndex(root);
    const refreshed = await searchGroundedContext(root, "updated refund claims", { maxTokens: 512 });
    assert.equal(refreshed.retrieval, "hybrid");
    assert.match(refreshed.context, /updated refund claims/);
  } finally {
    if (previousHost === undefined) delete process.env.MCPEE_OLLAMA_HOST;
    else process.env.MCPEE_OLLAMA_HOST = previousHost;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("BGE-M3 chunking preserves Markdown table headers, removes export noise, overlaps code, and keeps file metadata", () => {
  const root = temporaryProject();
  initializeProject(root);
  const tablePath = "knowledge/normalized/large-table.md";
  const codePath = "knowledge/normalized/module.py";
  fs.mkdirSync(path.dirname(path.join(root, tablePath)), { recursive: true });
  fs.writeFileSync(path.join(root, tablePath), [
    "| id | description |",
    "| --- | --- |",
    ...Array.from({ length: 900 }, (_, index) => `| ${index + 1} | exported table value ${index} |`),
    "| nulos | nulos |",
  ].join("\n"));
  fs.writeFileSync(path.join(root, codePath), [
    "class RefundService:",
    ...Array.from({ length: 80 }, (_, index) => `    value_${index} = "refund policy ${index}"`),
    "",
    "class SettlementService:",
    "    def settle(self):",
    "        return True",
  ].join("\n"));
  const document = (sourcePath, normalizedPath) => ({
    source_path: sourcePath,
    normalized_path: normalizedPath,
    sha256: "a".repeat(64),
    file_name: path.posix.basename(sourcePath),
    modified_at: "2026-01-01T00:00:00.000Z",
  });
  const tables = chunkDocument(root, document("data/table.md", tablePath), { profile: "bge-m3" });
  assert.equal(tables.length, 1);
  for (const chunk of tables) {
    assert.match(chunk.text, /^\| id \| description \|\n\| --- \| --- \|/);
    assert.doesNotMatch(chunk.text, /nulos/i);
    assert.equal(chunk.file_path, "data/table.md");
    assert.equal(chunk.file_name, "table.md");
    assert.equal(chunk.modified_at, "2026-01-01T00:00:00.000Z");
  }

  const code = chunkDocument(root, document("src/module.py", codePath), { profile: "bge-m3" });
  assert.ok(code.length >= 2);
  assert.equal(code[0].chunk_kind, "code");
  assert.ok(code[1].overlap_lines > 0);
  assert.ok(code.some((chunk) => /value_79/.test(chunk.text)));
  assert.ok(code.some((chunk) => /class SettlementService/.test(chunk.text)));
  const vuePath = "knowledge/normalized/Widget.vue";
  fs.writeFileSync(path.join(root, vuePath),
    "<script setup>const label = 'Save';</script>\n<template><button>{{ label }}</button></template>");
  const vue = chunkDocument(root, document("src/Widget.vue", vuePath), { profile: "bge-m3" });
  assert.ok(vue.length > 0);
  assert.ok(vue.every(chunk => chunk.chunk_kind === "code"));
  assert.ok(vue.some(chunk => chunk.text.includes("<template>")));
});

test("sync refuses to ingest sources outside the project and preserves colliding generated files", () => {
  const root = temporaryProject();
  initializeProject(root);
  const configPath = path.join(root, "mcpee.config.yml");
  fs.writeFileSync(configPath, [
    "version: 1",
    "project:",
    "  name: test",
    "knowledge:",
    "  sourceRoots:",
    "    - ..",
    "  ignore:",
    "    - private/",
    "",
  ].join("\n"));
  assert.throws(() => syncProject(root), /Source root must stay inside the project/);

  fs.writeFileSync(configPath, [
    "version: 1",
    "project:",
    "  name: test",
    "knowledge:",
    "  sourceRoots:",
    "    - docs",
    "  ignore:",
    "    - private/",
    "",
  ].join("\n"));
  const document = path.join(root, "docs/design.md");
  fs.mkdirSync(path.dirname(document), { recursive: true });
  fs.writeFileSync(document, "# Architecture\n");
  const id = require("node:crypto").createHash("sha256").update("docs/design.md").digest("hex").slice(0, 24);
  const collision = path.join(root, `knowledge/normalized/${id}.md`);
  fs.writeFileSync(collision, "user-authored output\n");
  const result = syncProject(root);
  assert.equal(result.counts.failed, 1);
  assert.equal(fs.readFileSync(collision, "utf8"), "user-authored output\n");
});

test("one MCPEE workspace indexes multiple nested repositories and applications", () => {
  const root = temporaryProject();
  initializeProject(root);
  const repositories = [
    {
      path: "apps/api",
      files: {
        "src/server.ts": "export class ApiServer {}\n",
        "docs/overview.md": "# API\nOwns payment endpoints.\n",
      },
    },
    {
      path: "apps/web",
      files: {
        "src/client.ts": "export class WebClient {}\n",
        "docs/overview.md": "# Web\nOwns the customer interface.\n",
      },
    },
  ];
  for (const repository of repositories) {
    fs.mkdirSync(path.join(root, repository.path, ".git"), { recursive: true });
    for (const [relative, contents] of Object.entries(repository.files)) {
      const destination = path.join(root, repository.path, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, contents);
    }
  }
  fs.writeFileSync(path.join(root, "mcpee.config.yml"), [
    "version: 1",
    "project:",
    "  name: workspace",
    "knowledge:",
    "  sourceRoots:",
    "    - apps/api",
    "    - apps/web",
    "",
  ].join("\n"));

  const result = syncProject(root);
  assert.equal(result.discoveredFiles, 4);
  assert.deepEqual(result.sources.map((source) => source.path), [
    "apps/api/docs/overview.md",
    "apps/api/src/server.ts",
    "apps/web/docs/overview.md",
    "apps/web/src/client.ts",
  ]);
  assert.equal(searchKnowledge(root, "payment endpoints")[0].source_path, "apps/api/docs/overview.md");
  assert.equal(searchKnowledge(root, "customer interface")[0].source_path, "apps/web/docs/overview.md");
  assert.equal(searchKnowledgeVector(root, "payment endpoints")[0].source_path, "apps/api/docs/overview.md");
  const graph = JSON.parse(fs.readFileSync(path.join(root, GRAPH_PATH), "utf8"));
  assert.ok(graph.nodes.some((node) => node.source_path === "apps/api/src/server.ts"));
  assert.ok(graph.nodes.some((node) => node.source_path === "apps/web/src/client.ts"));
});

test("documentation generation preserves custom output and routes requests from local evidence", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    dependencies: {
      "@angular/core": "^19.0.0",
      "aws-cdk-lib": "^2.0.0",
      express: "^5.0.0",
    },
  }));
  fs.writeFileSync(path.join(root, "angular.json"), "{}\n");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "db"), { recursive: true });
  fs.mkdirSync(path.join(root, "infra"), { recursive: true });
  fs.writeFileSync(path.join(root, "infra/main.tf"), "terraform {}\n");
  fs.writeFileSync(path.join(root, "src/api.csproj"), "<Project></Project>\n");
  fs.writeFileSync(path.join(root, "db/schema.sql"), "CREATE TABLE Example (Id int);\n");
  renderCatalog(root);
  manageCapability(root, "install", "workflow", "database-change-with-baseline");
  installFakeCodeGraph(root);
  const customOverview = path.join(root, "docs/generated/project-overview.md");
  fs.writeFileSync(customOverview, "# User-owned overview\n");
  fs.mkdirSync(path.join(root, "knowledge/sources/technical"), { recursive: true });
  fs.writeFileSync(path.join(root, "knowledge/sources/technical/database.md"), "# Database\nMigration safety and query validation.\n");
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/migration-decision.md"), "# Migration decision\nUse additive database migrations.\n");

  syncProject(root);
  updateCodeGraph(root, { available: true, required: true });
  assert.equal(fs.readFileSync(customOverview, "utf8"), "# User-owned overview\n");
  assert.ok(fs.existsSync(path.join(root, "docs/generated/architecture-map.md")));
  const generated = generateProjectDocumentation(root);
  assert.equal(generated.counts.preserved, 1);

  addMemory(root, {
    kind: "decision",
    text: "Always make database migrations additive before destructive follow-up changes.",
    sources: ["docs/migration-decision.md"],
  });
  const plan = routeTask(root, "Review architecture and database migration safety and verify the schema change.");
  assert.equal(plan.workflow.id, "database-change-with-baseline");
  assert.equal(plan.agent.id, "database");
  assert.ok(plan.agent.skills.includes("architecture"));
  assert.ok(plan.agent.preferred_knowledge.includes("database"));
  assert.ok(plan.agent.tools.includes("dotnet"));
  assert.ok(Array.isArray(plan.agent.tool_capabilities));
  assert.ok(plan.agent_tools.some((tool) => tool.id === "dotnet" && typeof tool.available === "boolean"));
  assert.ok(plan.memory.some((entry) => entry.evidence[0].status === "current"));
  assert.ok(plan.knowledge.some((entry) => entry.source_path === "knowledge/sources/technical/database.md"));
  assert.ok(plan.knowledge_graph.some((entry) => entry.graph === "unified"));
  assert.equal(plan.execution, "plan-only; no agent or tool was invoked");
  const backendPlan = routeTask(root, "Implement a backend API feature with authorization and idempotency.");
  assert.equal(backendPlan.workflow.id, "deliver-feature");
  assert.equal(backendPlan.agent.id, "backend");
  assert.match(backendPlan.agent.guidance, /Service boundaries, domain logic, API behavior/);
  assert.ok(backendPlan.skills.some((skill) => skill.id === "backend-change" && /failure/i.test(skill.guidance)));
  assert.ok(backendPlan.skills.some((skill) => skill.id === "api-contract-review" && /consumers/i.test(skill.guidance)));
  assert.ok(backendPlan.skills.some((skill) => skill.id === "database-migration-safety"));
  assert.ok(backendPlan.skills.some((skill) => skill.id === "test-strategy"));
  assert.ok(backendPlan.patterns.some((pattern) => pattern.id === "vertical-slice" && /end-to-end/i.test(pattern.guidance)));
  assert.ok(backendPlan.patterns.some((pattern) => pattern.id === "validation-plan"));
  assert.ok(backendPlan.patterns.some((pattern) => pattern.id === "clean-code-and-naming" && /repository's existing conventions/i.test(pattern.guidance)));
  assert.ok(backendPlan.technical_guidance.some((item) => item.id === "dotnet-csharp" && /https:\/\/learn\.microsoft\.com/.test(item.guidance)));
  assert.ok(backendPlan.scorecards.some((item) => item.id === "engineering-response-quality"));
  assert.ok(backendPlan.scorecards.some((item) => item.id === "software-change-quality"));
  assert.ok(backendPlan.eval_cases.some((item) => item.id === "evidence-grounding"));
  assert.ok(backendPlan.prompt_examples.some((item) => item.id === "backend-change-example" && /Implement/.test(item.example)));
  assert.ok(backendPlan.policy_controls.some((policy) => policy.id === "human-in-the-loop" && policy.enforcement === "runtime"));
  assert.match(backendPlan.workflow.guidance, /independently reviewable vertical slices/);
  manageCapability(root, "install", "pattern", "dotnet-csharp-quality");
  const dotnetPlan = routeTask(root, "Refactor this C# .NET service and review naming conventions.");
  assert.equal(dotnetPlan.workflow.id, "refactor-code");
  assert.equal(dotnetPlan.agent.id, "backend");
  const dotnetGuidance = dotnetPlan.technical_guidance.find(item => item.id === "dotnet-csharp");
  assert.match(dotnetGuidance.guidance, /DbContext is a short-lived unit of work/);
  assert.match(dotnetGuidance.guidance, /throw;/);
  assert.match(dotnetGuidance.guidance, /Linq deferred execution/i);
  assert.ok(dotnetPlan.patterns.some((pattern) =>
    pattern.id === "dotnet-csharp-quality" && /Directory.Build.props/.test(pattern.guidance)));
  const angularPlan = routeTask(root, "Review the Angular signals architecture and refactor derived component state.");
  assert.equal(angularPlan.agent.id, "frontend");
  assert.ok(angularPlan.patterns.some((pattern) =>
    pattern.id === "angular-signals-architecture" &&
    /computed\(\)/.test(pattern.guidance) &&
    /Do not use effects to copy or propagate application/.test(pattern.guidance)));
  assert.ok(angularPlan.technical_guidance.some((item) => item.id === "angular-engineering"));
  assert.ok(angularPlan.technical_guidance.some((item) => item.id === "typescript-engineering"));
  assert.ok(angularPlan.scorecards.some((item) => item.id === "frontend-quality"));
  assert.ok(angularPlan.eval_cases.some((item) => item.id === "frontend-framework-fit"));
  assert.ok(angularPlan.prompt_examples.some((item) => item.id === "frontend-change-example"));
  assert.ok(!angularPlan.technical_guidance.some((item) => item.id === "aws-engineering"));
  assert.ok(!angularPlan.scorecards.some((item) => item.id === "cloud-iac-quality"));
  assert.deepEqual(angularPlan.playbooks, []);
  const nextPlan = routeTask(root, "Implement a Next.js App Router Server Component and verify its runtime behavior.");
  assert.equal(nextPlan.workflow.id, "deliver-frontend-change");
  assert.equal(nextPlan.agent.id, "frontend");
  assert.ok(nextPlan.skills.some((skill) =>
    skill.id === "nextjs-app-router-development" &&
    /server\/client boundaries/i.test(skill.guidance) &&
    /official guidance for those versions/i.test(skill.guidance)));
  const portfolioPlan = routeTask(root, "Crea un portfolio personal con Next.js desde cero.");
  assert.equal(portfolioPlan.workflow.id, "deliver-frontend-change");
  assert.equal(portfolioPlan.agent.id, "frontend");
  assert.ok(portfolioPlan.skills.some((skill) => skill.id === "nextjs-app-router-development"));
  const sqlPathPlan = routeTask(root, "Review db/schema.sql and its constraints.");
  assert.deepEqual(sqlPathPlan.technical_guidance.map(item => item.id), ["sql-engineering"]);
  assert.ok(sqlPathPlan.technical_guidance[0].apply_to.includes("**/*.sql"));
  const noLanguagePlan = routeTask(root, "Investigate the slow request and its bottleneck.");
  assert.ok(noLanguagePlan.technical_guidance.some(item => item.id === "dotnet-csharp"));
  assert.ok(noLanguagePlan.technical_guidance.some(item => item.id === "node-engineering"));
  assert.deepEqual(noLanguagePlan.policy_controls, readCatalog().catalog.policies);
  const noFalseSqlPlan = routeTask(root, "Review NoSQL document behavior and Angular rendering.");
  assert.ok(!noFalseSqlPlan.technical_guidance.some(item => item.id === "sql-engineering"));
  const nodePlan = routeTask(root, "Profile Node event-loop latency in the backend.");
  assert.ok(nodePlan.technical_guidance.some(item => item.id === "node-engineering"));
  assert.ok(nodePlan.technical_guidance.some(item => item.id === "typescript-engineering"));
  manageCapability(root, "install", "playbook", "migration-strategy");
  const migrationPlan = routeTask(root, "Plan a legacy cloud migration with a staged cutover and rollback.");
  assert.equal(migrationPlan.workflow.id, "modernize-legacy");
  assert.ok(migrationPlan.playbooks.some((item) =>
    item.id === "migration-strategy" &&
    /Rebuild/.test(item.guidance) &&
    /Data migration validation/.test(item.guidance) &&
    /explicit\s+approval/.test(item.guidance) &&
    /forward-recovery/.test(item.guidance) &&
    /decommission/.test(item.guidance) &&
    /tested recovery/.test(item.guidance)));
  const ordinaryFeaturePlan = routeTask(root, "Implement a small backend API feature.");
  assert.deepEqual(ordinaryFeaturePlan.playbooks, []);
  const backlogPlan = routeTask(root, "Refine the backlog and split this user story into measurable acceptance criteria.");
  assert.equal(backlogPlan.workflow.id, "refine-backlog");
  assert.equal(backlogPlan.agent.id, "product");
  assert.match(backlogPlan.agent.guidance, /product owner/i);
  assert.ok(backlogPlan.patterns.some((pattern) => pattern.id === "user-story" && /acceptance/i.test(pattern.guidance)));
  const trackerPlan = routeTask(root, "Create a GitHub issue for this approved work item.");
  assert.equal(trackerPlan.workflow.id, "create-or-update-work-items");
  assert.equal(trackerPlan.agent.id, "orchestrator");
  assert.ok(trackerPlan.skills.some((skill) => skill.id === "github-ado-work-items" && /approval/i.test(skill.guidance)));
  const releasePlan = routeTask(root, "Deploy the approved release to production with deployment approval.");
  assert.equal(releasePlan.workflow.id, "deploy-with-approval");
  assert.equal(releasePlan.agent.id, "devops");
  assert.match(releasePlan.agent.guidance, /deployment/i);
  assert.ok(releasePlan.patterns.some((pattern) => pattern.id === "change-rollout-plan"));
  const buildPlan = routeTask(root, "Review release readiness and promote this release candidate.");
  assert.equal(buildPlan.workflow.id, "build-and-promote");
  assert.equal(buildPlan.agent.id, "devops");
  const incidentPlan = routeTask(root, "Coordinate incident response with the incident commander and SRE.");
  assert.equal(incidentPlan.workflow.id, "respond-to-incident");
  assert.equal(incidentPlan.agent.id, "observability");
  assert.ok(incidentPlan.agent.supporting_guidance.some((source) => /incident-commander/.test(source.source_path)));
  assert.ok(incidentPlan.agent.supporting_guidance.some((source) => /sre\.agent/.test(source.source_path)));
  const databasePlan = routeTask(root, "Review the database migration baseline and recovery checks.");
  assert.equal(databasePlan.workflow.id, "database-change-with-baseline");
  assert.equal(databasePlan.agent.id, "database");
  assert.ok(databasePlan.skills.some((skill) => skill.id === "database-change-operations" && /baseline/i.test(skill.guidance)));
  const forensicPlan = routeTask(root, "Perform a forensic assessment and reconstruct the system map.");
  assert.equal(forensicPlan.workflow.id, "forensic-assessment");
  assert.ok(forensicPlan.workflow.guidance.includes("Trace representative runtime"));
  const validationPlan = routeTask(root, "Run a validation plan to verify this change.");
  assert.equal(validationPlan.workflow.id, "validate-change");
  const securityPlan = routeTask(root, "Review this security vulnerability and credential handling");
  assert.equal(securityPlan.workflow.id, "review-security");
  assert.equal(securityPlan.agent.id, "security");
  manageCapability(root, "install", "workflow", "architecture-challenge");
  manageCapability(root, "install", "eval-case", "architecture-proposal-challenge");
  const architectureChallengePlan = routeTask(root, "Challenge the architecture proposal and compare simpler alternatives.");
  assert.equal(architectureChallengePlan.workflow.id, "architecture-challenge");
  assert.equal(architectureChallengePlan.agent.id, "architect-challenger");
  assert.ok(architectureChallengePlan.patterns.some((pattern) => pattern.id === "architecture-challenge"));
  assert.ok(architectureChallengePlan.eval_cases.some((item) =>
    item.id === "architecture-proposal-challenge" && item.asset_ids.includes("architect-challenger")));
  manageCapability(root, "install", "workflow", "technical-debt-assessment");
  const debtPlan = routeTask(root, "Create an evidence-backed technical debt register.");
  assert.equal(debtPlan.workflow.id, "technical-debt-assessment");
  assert.equal(debtPlan.agent.id, "technical-debt-assessor");
  manageCapability(root, "install", "workflow", "technical-due-diligence");
  const diligencePlan = routeTask(root, "Perform technical due diligence for this acquisition.");
  assert.equal(diligencePlan.workflow.id, "technical-due-diligence");
  assert.equal(diligencePlan.agent.id, "technical-due-diligence");
  manageCapability(root, "install", "workflow", "performance-forensics");
  const performancePlan = routeTask(root, "Investigate this performance regression with a comparable baseline.");
  assert.equal(performancePlan.workflow.id, "performance-forensics");
  assert.equal(performancePlan.agent.id, "performance-forensics");
  const sqlDiagnosisPlan = routeTask(root, "Investigate a slow SQL query and query tuning for db/schema.sql.");
  assert.equal(sqlDiagnosisPlan.workflow.id, "performance-forensics");
  const sqlDiagnosis = sqlDiagnosisPlan.skills.find(skill => skill.id === "sql-performance-diagnosis");
  assert.match(sqlDiagnosis.guidance, /sys\.dm_os_wait_stats/);
  assert.match(sqlDiagnosis.guidance, /golden-file/);
  assert.ok(sqlDiagnosisPlan.eval_cases.some(item => item.id === "sql-diagnosis-evidence"));
  const recoveryPlan = routeTask(root, "Plan a failover rehearsal with RTO/RPO targets.");
  assert.equal(recoveryPlan.workflow.id, "diagnose-operation");
  assert.equal(recoveryPlan.agent.id, "observability");
  const recovery = recoveryPlan.skills.find(skill => skill.id === "recovery-rehearsal");
  assert.match(recovery.guidance, /known recovery marker/);
  assert.match(recovery.guidance, /cleanup.*failback|failback.*cleanup/);
  assert.ok(recoveryPlan.eval_cases.some(item => item.id === "recovery-rehearsal-evidence"));
  const spanishSql = routeTask(root, "Analiza el cuello de botella de SQL y una consulta lenta.");
  assert.equal(spanishSql.workflow.id, "performance-forensics");
  assert.ok(spanishSql.skills.some(skill => skill.id === "sql-performance-diagnosis"));
  const nuxtPlan = routeTask(root, "Review Nuxt rendering and component styling.");
  assert.equal(nuxtPlan.agent.id, "frontend");
  const cloudOperationsPlan = routeTask(root, "Show Azure resource health and query CloudWatch for an outage.");
  assert.equal(cloudOperationsPlan.workflow.id, "diagnose-operation");
  assert.ok(cloudOperationsPlan.skills.some((skill) => skill.id === "cloud-resource-diagnostics"));
  const databaseOperationsPlan = routeTask(root, "Review database test data, database high availability, and stored procedure migration.");
  assert.equal(databaseOperationsPlan.workflow.id, "database-change-with-baseline");
  assert.ok(databaseOperationsPlan.skills.some((skill) => skill.id === "database-test-data-protection"));
  assert.ok(databaseOperationsPlan.skills.some((skill) => skill.id === "database-operations-reliability"));
  const designEvidencePlan = routeTask(root, "Review Figma design and screenshot evidence for the user journey.");
  assert.equal(designEvidencePlan.workflow.id, "design-and-accessibility-gate");
  assert.ok(designEvidencePlan.skills.some((skill) => skill.id === "ux-design-evidence"));
  const mcpAuthoringPlan = routeTask(root, "Build an MCP server with a tested tool contract.");
  assert.equal(mcpAuthoringPlan.workflow.id, "deliver-feature");
  assert.ok(mcpAuthoringPlan.skills.some((skill) => skill.id === "backend-mcp-package-authoring"));
  const contextBudgetPlan = routeTask(root, "Reduce context using a token budget while preserving evidence.");
  assert.equal(contextBudgetPlan.workflow.id, "understand-project");
  assert.ok(contextBudgetPlan.skills.some((skill) => skill.id === "context-budgeting"));
  const fallbackPlan = routeTask(root, "Tell me how the pieces fit together");
  assert.equal(fallbackPlan.workflow.id, "understand-project");
  assert.equal(fallbackPlan.fallback, "No route keyword matched; selected understand-project.");
});

test("routing fails closed when the required CodeGraph index is missing", () => {
  const root = temporaryProject();
  initializeProject(root);
  syncProject(root);
  assert.throws(() => routeTask(root, "Understand the project"), /CodeGraph is required.*not ready/);
});

test("database-only recovery uses installed database controls without requiring a cloud agent", () => {
  const root = temporaryProject();
  fs.mkdirSync(path.join(root, "db"), { recursive: true });
  fs.writeFileSync(path.join(root, "db/schema.sql"), "CREATE TABLE Example (Id int);\n");
  initializeProject(root);
  installFakeCodeGraph(root);
  syncProject(root);
  updateCodeGraph(root, { available: true, required: true });
  const plan = routeTask(root, "Plan a backup restore rehearsal with numeric RTO/RPO targets.");
  assert.equal(plan.workflow.id, "database-change-with-baseline");
  assert.equal(plan.agent.id, "database");
  assert.ok(plan.skills.some(skill => skill.id === "recovery-rehearsal" &&
    /observed data gap/.test(skill.guidance)));
  assert.ok(plan.eval_cases.some(item => item.id === "recovery-rehearsal-evidence"));
  assert.match(plan.execution, /plan-only/);
});

test("routing prioritizes explicitly named indexed files over lexical noise without accepting path substrings", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "specs"), { recursive: true });
  fs.writeFileSync(path.join(root, "specs/probe.json"), '{"revision":2}\n');
  for (let index = 0; index < 12; index++) {
    fs.writeFileSync(path.join(root, `noise-${index}.md`), "Fix failing backend test revision acceptance probe ".repeat(80));
  }
  installFakeCodeGraph(root);
  updateCodeGraph(root, { available: true, required: true });
  syncProject(root);
  const plan = routeTask(root, "Fix failing backend test: change only `specs\\probe.json` revision to 3.");
  assert.equal(plan.knowledge[0].source_path, "specs/probe.json");
  assert.equal(plan.knowledge[0].selection, "explicit-task-path");
  assert.equal(plan.impact_preflight.targets[0].target, "specs/probe.json");
  assert.ok(plan.knowledge.length <= 5);
  for (const invalid of ["../specs/probe.json", "outside/specs/probe.json", "specs/probe.json.bak"]) {
    const unrelated = routeTask(root, `Fix failing backend test in ${invalid}`);
    assert.equal(unrelated.knowledge.some(source => source.selection === "explicit-task-path"), false);
  }
});

test("sync generates evidence-bounded technical documentation views from discovered sources", () => {
  const root = temporaryProject();
  initializeProject(root);
  const fixtures = {
    "src/payments.ts": "export class PaymentService {}\n",
    "api/openapi.yaml": "openapi: 3.1.0\n",
    "database/schema.sql": "CREATE TABLE payments (id INT);\n",
    "infra/main.tf": 'resource "test_resource" "app" {}\n',
    "data/payments.csv": 'customer_id,"payment,amount"\n123,"12.50"\n',
    "tests/payments.test.ts": "test('payment', () => {});\n",
    ".github/workflows/ci.yml": "name: CI\n",
    "docs/adr/0001-payments.md": "# Use additive payment migrations\n",
  };
  for (const [relative, contents] of Object.entries(fixtures)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  }

  const result = syncProject(root);
  const generatedDirectory = path.join(root, "docs/generated");
  const expectedDocuments = [
    "project-overview.md",
    "components.md",
    "architecture-map.md",
    "apis-and-data.md",
    "infrastructure.md",
    "testing.md",
    "operations.md",
    "decisions.md",
  ];
  for (const document of expectedDocuments) {
    assert.ok(fs.existsSync(path.join(generatedDirectory, document)), `missing ${document}`);
  }
  assert.equal(result.documentation.files.includes("docs/generated/decisions.md"), true);
  assert.match(fs.readFileSync(path.join(generatedDirectory, "apis-and-data.md"), "utf8"), /api\/openapi\.yaml/);
  assert.match(fs.readFileSync(path.join(generatedDirectory, "apis-and-data.md"), "utf8"), /table fields: `customer_id`, `payment,amount`/);
  assert.match(fs.readFileSync(path.join(generatedDirectory, "infrastructure.md"), "utf8"), /infra\/main\.tf/);
  assert.match(fs.readFileSync(path.join(generatedDirectory, "testing.md"), "utf8"), /tests\/payments\.test\.ts/);
  assert.match(fs.readFileSync(path.join(generatedDirectory, "operations.md"), "utf8"), /\.github\/workflows\/ci\.yml/);
  assert.match(fs.readFileSync(path.join(generatedDirectory, "decisions.md"), "utf8"), /docs\/adr\/0001-payments\.md/);
  assert.match(fs.readFileSync(path.join(generatedDirectory, "architecture-map.md"), "utf8"), /does not infer runtime topology/);
  assert.match(fs.readFileSync(path.join(generatedDirectory, "components.md"), "utf8"), /symbols: `PaymentService`/);
  const lexicalIndex = JSON.parse(fs.readFileSync(path.join(root, ".mcpee/indexes/knowledge-index.json"), "utf8"));
  const indexedSource = lexicalIndex.documents.find((document) => document.source_path === "src/payments.ts");
  assert.equal(indexedSource.file_name, "payments.ts");
  assert.equal(typeof indexedSource.modified_at, "string");
});

test("lexical and vector retrieval treat prototype property names as ordinary terms", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/properties.js"),
    "constructor __proto__ ordinaryterm\n");
  syncProject(root);
  const index = JSON.parse(fs.readFileSync(
    path.join(root, ".mcpee/indexes/knowledge-index.json"), "utf8"));
  for (const term of ["constructor", "__proto__"]) {
    assert.ok(Object.hasOwn(index.postings, term));
    assert.ok(Array.isArray(index.postings[term]));
    for (const search of [searchKnowledge, searchKnowledgeVector]) {
      assert.ok(search(root, term).some((item) => item.source_path === "src/properties.js"));
    }
  }
  delete index.postings.constructor;
  delete index.postings.__proto__;
  fs.writeFileSync(path.join(root, ".mcpee/indexes/knowledge-index.json"),
    JSON.stringify(index));
  for (const search of [searchKnowledge, searchKnowledgeVector]) {
    assert.deepEqual(search(root, "constructor __proto__"), []);
    assert.ok(search(root, "ordinaryterm").some((item) => item.source_path === "src/properties.js"));
  }
});

test("Graphify sync is local-only, owned, searchable, and contributes graph results", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/refunds.js"), "export class RefundService {}\n");

  let invoked = false;
  const unavailable = updateGraphifyGraph(root, {
    installed: false,
    invokeTool: () => {
      invoked = true;
      throw new Error("must not invoke an unavailable tool");
    },
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(invoked, false);
  assert.equal(fs.existsSync(path.join(root, ".mcpee/graphs/graphify")), false);

  const graph = {
    graph: { graphify_version: "0.9.80" },
    nodes: [
      { id: "refund-service", label: "RefundService", kind: "class", source_file: "src/refunds.js", start_line: 1 },
      { id: "external-service", label: "RefundService External", kind: "class", source_file: "../outside.js" },
      { id: "payment-client", label: "PaymentClient", kind: "class", source_file: "src/refunds.js", start_line: 4 },
    ],
    links: [
      { source: "refund-service", target: "payment-client", relation: "calls" },
      { source: "refund-service", target: "unknown-node", relation: "references" },
    ],
  };
  const ready = updateGraphifyGraph(root, {
    installed: true,
    invokeTool: (projectRoot, toolId, args, options) => {
      invoked = true;
      assert.equal(projectRoot, root);
      assert.equal(toolId, "graphify");
      assert.ok(args.includes("--code-only"));
      assert.equal(options.env.DO_NOT_TRACK, "1");
      const outputDirectory = args[args.indexOf("--out") + 1];
      fs.writeFileSync(path.join(outputDirectory, "graph.json"), JSON.stringify(graph));
      return { status: "success", exit_code: 0 };
    },
  });
  assert.equal(invoked, true);
  assert.equal(ready.status, "ready");
  assert.equal(readGraphifyState(root).node_count, 3);
  const matches = searchGraphify(root, "RefundService");
  assert.deepEqual(matches.map((match) => match.source_path), ["src/refunds.js"]);
  assert.equal(matches[0].relations[0].symbol, "PaymentClient");

  const cliOutput = execFileSync(process.execPath, [
    cli, "knowledge", "graph", "--project", root, "--query", "RefundService", "--json",
  ], { encoding: "utf8" });
  assert.ok(JSON.parse(cliOutput).some((match) => match.graph === "graphify"));

  const failed = updateGraphifyGraph(root, {
    installed: true,
    invokeTool: () => ({ status: "failed", error: "Graphify test failure" }),
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /Graphify test failure/);
  assert.deepEqual(searchGraphify(root, "RefundService"), []);

  const unownedRoot = temporaryProject();
  initializeProject(unownedRoot);
  const unownedDirectory = path.join(unownedRoot, ".mcpee/graphs/graphify");
  fs.mkdirSync(unownedDirectory, { recursive: true });
  fs.writeFileSync(path.join(unownedDirectory, "user-data.json"), "{}");
  let unownedToolInvoked = false;
  const rejected = updateGraphifyGraph(unownedRoot, {
    installed: true,
    invokeTool: () => {
      unownedToolInvoked = true;
      return { status: "success", exit_code: 0 };
    },
  });
  assert.equal(rejected.status, "failed");
  assert.match(rejected.error, /unowned Graphify output directory/);
  assert.equal(unownedToolInvoked, false);
  assert.equal(fs.readFileSync(path.join(unownedDirectory, "user-data.json"), "utf8"), "{}");
});

test("unified graph resolves traceable local Python imports and ignores ambiguous modules", () => {
  const root = temporaryProject();
  initializeProject(root);
  const fixtures = {
    "src/pyapp/__init__.py": "",
    "src/pyapp/service.py": "from .models import Payment\n",
    "src/pyapp/models.py": "class Payment: pass\n",
    "src/pyapp/consumer.py": "import pyapp.service\n",
    "tests/test_service.py": '"""Example only:\nfrom .fake import NotAnImport\n"""\nfrom src.pyapp.service import Payment\n',
    "tests/test_multiline.py": "import src.pyapp.service, \\\n    src.pyapp.models\nfrom \\\n    src.pyapp.service import Payment\n",
    "legacy/pyapp/service.py": "class LegacyService: pass\n",
  };
  for (const [relative, contents] of Object.entries(fixtures)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  }
  syncProject(root);
  const graph = JSON.parse(fs.readFileSync(path.join(root, GRAPH_PATH), "utf8"));
  const edgeFor = (sourcePath, targetPath, type) => graph.edges.some((edge) =>
    edge.type === type &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === sourcePath &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === targetPath);

  assert.equal(edgeFor("src/pyapp/service.py", "src/pyapp/models.py", "imports_source"), true);
  assert.equal(edgeFor("tests/test_service.py", "src/pyapp/service.py", "tests_source"), true);
  assert.equal(edgeFor("tests/test_multiline.py", "src/pyapp/models.py", "tests_source"), true);
  const continuedImport = graph.edges.find((edge) =>
    edge.type === "tests_source" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "tests/test_multiline.py" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "src/pyapp/service.py");
  assert.equal(continuedImport.evidence.line, 1);
  assert.equal(graph.edges.some((edge) =>
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "src/pyapp/consumer.py" &&
    edge.type === "imports_source"), false);
  assert.equal(graph.edges.some((edge) =>
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "tests/test_service.py" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "src/pyapp/fake.py"), false);
});

test("sync can refresh evidence without generating documentation before validation", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/app.js"), "export const ready = true;\n");

  const result = syncProject(root, { generateDocumentation: false });
  assert.equal(result.unifiedGraph.status, "ready");
  assert.deepEqual(result.documentation, {
    counts: { written: 0, preserved: 0, unchanged: 0 },
    files: [],
  });
  assert.equal(fs.existsSync(path.join(root, "docs/generated/project-overview.md")), false);
});

test("sync builds a deterministic evidence-linked unified graph and exposes graph search", () => {
  const root = temporaryProject();
  initializeProject(root);
  const architecture = path.join(root, "docs/architecture.md");
  const source = path.join(root, "src/payment-service.ts");
  const sourceDependency = path.join(root, "src/payment-types.ts");
  const sourceConsumer = path.join(root, "src/payment-controller.ts");
  const sourceTest = path.join(root, "tests/payment-service.test.ts");
  const api = path.join(root, "api/payments.md");
  const terraform = path.join(root, "infra/main.tf");
  const terraformModule = path.join(root, "infra/modules/network/main.tf");
  const openApi = path.join(root, "api/openapi.yaml");
  const openApiSchema = path.join(root, "api/schemas/payment.yaml");
  const pipeline = path.join(root, ".github/workflows/deploy.yml");
  const localAction = path.join(root, ".github/actions/deploy/action.yml");
  const databaseSchema = path.join(root, "db/schema.sql");
  const databaseForeignKey = path.join(root, "db/foreign-key.sql");
  const dataset = path.join(root, "data/payments.csv");
  const tabularMarkdown = path.join(root, "data/schemas.md");
  const dotnetSolution = path.join(root, "infra/dotnet/App.sln");
  const dotnetXmlSolution = path.join(root, "infra/dotnet/App.slnx");
  const dotnetApp = path.join(root, "infra/dotnet/App/App.csproj");
  const dotnetCommon = path.join(root, "infra/dotnet/Common/Common.csproj");
  const dotnetProps = path.join(root, "infra/dotnet/Directory.Build.props");
  const dotnetTargets = path.join(root, "infra/dotnet/msbuild/Custom.targets");
  const workspaceLibrary = path.join(root, "packages/shared/package.json");
  const workspaceClient = path.join(root, "packages/client/package.json");
  const localTool = path.join(root, "packages/tool/package.json");
  fs.mkdirSync(path.dirname(architecture), { recursive: true });
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(sourceTest), { recursive: true });
  fs.mkdirSync(path.dirname(api), { recursive: true });
  for (const filePath of [
    terraform, terraformModule, openApi, openApiSchema, pipeline, localAction,
    databaseSchema, databaseForeignKey, dataset, tabularMarkdown, dotnetSolution,
    dotnetXmlSolution, dotnetApp, dotnetCommon, dotnetProps, dotnetTargets,
    workspaceLibrary, workspaceClient, localTool,
  ]) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  fs.writeFileSync(architecture, [
    "# Payment flow",
    "",
    "Payments use idempotent requests and see [the API](../api/payments.md#contract) and [an obsolete draft](../api/missing.yaml).",
    "",
    "## Evidence",
    "",
    "```md",
    "[not a graph link](../outside.md)",
    "```",
    "[external](https://example.test/api.md)",
    "[outside](../../outside.md)",
    "",
  ].join("\n"));
  fs.writeFileSync(source, [
    'import { PaymentType } from "./payment-types.js";',
    'import { PaymentController } from "./payment-controller.js";',
    "export class PaymentService {}",
    "",
  ].join("\n"));
  fs.writeFileSync(sourceDependency, "export interface PaymentType {}\n");
  fs.writeFileSync(sourceConsumer, 'import { PaymentService } from "./payment-service.js";\n');
  fs.writeFileSync(sourceTest, 'import { PaymentService } from "../src/payment-service.js";\n');
  fs.writeFileSync(api, "# Contract\n\nPayment API evidence.\n");
  fs.writeFileSync(terraform, 'module "network" {\n  source = "./modules/network"\n}\n');
  fs.writeFileSync(terraformModule, 'resource "example_network" "main" {}\n');
  fs.writeFileSync(openApi, 'openapi: 3.1.0\ncomponents:\n  schemas:\n    Payment:\n      $ref: "./schemas/payment.yaml#/Payment"\n');
  fs.writeFileSync(openApiSchema, "Payment:\n  type: object\n");
  fs.writeFileSync(pipeline, "name: deploy\njobs:\n  deploy:\n    steps:\n      - uses: ./.github/actions/deploy\n");
  fs.writeFileSync(localAction, "name: Deploy locally\nruns:\n  using: composite\n");
  fs.writeFileSync(databaseSchema, [
    "CREATE TABLE [dbo].[Customers] (",
    "  [Id] int PRIMARY KEY",
    ");",
    "CREATE TABLE [dbo].[Payments] (",
    "  [CustomerId] int REFERENCES [dbo].[Customers]([Id])",
    ");",
  ].join("\n"));
  fs.writeFileSync(databaseForeignKey, [
    "CREATE TABLE [dbo].[Refunds] (",
    "  [CustomerId] int REFERENCES [dbo].[Customers]([Id])",
    ");",
  ].join("\n"));
  fs.writeFileSync(dataset, 'customer_id,"payment,amount"\n123,"12.50"\n');
  fs.writeFileSync(tabularMarkdown, [
    "# Data schemas",
    "",
    "| Customer ID | Name |",
    "| --- | --- |",
    "| 1 | Example |",
    "",
    "| Payment ID | Amount |",
    "| --- | --- |",
    "| 2 | 12.50 |",
  ].join("\n"));
  fs.writeFileSync(dotnetSolution, [
    "Microsoft Visual Studio Solution File",
    'Project("{TEST}") = "App", "App\\App.csproj", "{APP}"',
    'Project("{TEST}") = "Common", "Common\\Common.csproj", "{COMMON}"',
    "EndProject",
    "",
  ].join("\n"));
  fs.writeFileSync(dotnetXmlSolution, [
    "<Solution>",
    '  <Project Path="App\\App.csproj" />',
    '  <Project Path="Common\\Common.csproj" />',
    "</Solution>",
    "",
  ].join("\n"));
  fs.writeFileSync(dotnetApp, [
    "<Project>",
    '  <ProjectReference Include="..\\Common\\Common.csproj" />',
    '  <Import Project="..\\Directory.Build.props" />',
    "</Project>",
    "",
  ].join("\n"));
  fs.writeFileSync(dotnetCommon, "<Project />\n");
  fs.writeFileSync(dotnetProps, [
    "<Project>",
    '  <Import Project="msbuild/Custom.targets" />',
    "</Project>",
    "",
  ].join("\n"));
  fs.writeFileSync(dotnetTargets, "<Project />\n");
  fs.writeFileSync(workspaceLibrary, JSON.stringify({
    name: "@example/shared",
    version: "1.0.0",
  }, null, 2));
  fs.writeFileSync(workspaceClient, JSON.stringify({
    name: "@example/client",
    version: "1.0.0",
    dependencies: {
      "@example/shared": "workspace:^",
    },
  }, null, 2));
  fs.writeFileSync(localTool, JSON.stringify({
    name: "@example/tool",
    version: "1.0.0",
    dependencies: {
      "@example/shared": "file:../shared",
    },
  }, null, 2));

  const firstSync = syncProject(root);
  const graphFile = path.join(root, GRAPH_PATH);
  const firstGraphContent = fs.readFileSync(graphFile, "utf8");
  const graph = JSON.parse(firstGraphContent);
  assert.equal(firstSync.unifiedGraph.status, "ready");
  assert.equal(graph.generated_by, "mcpee");
  assert.equal(graph.strategy, "local-evidence-unified");
  assert.equal(graph.node_count, graph.nodes.length);
  assert.equal(graph.edge_count, graph.edges.length);
  assert.deepEqual(getDocumentDrift(root).map(({ source_path, target_path, line, status }) =>
    ({ source_path, target_path, line, status })), [{
    source_path: "docs/architecture.md",
    target_path: "api/missing.yaml",
    line: 3,
    status: "needs_review",
  }]);
  const driftJson = execFileSync(process.execPath, [
    cli, "drift", "--project", root, "--json",
  ], { encoding: "utf8" });
  assert.equal(JSON.parse(driftJson).missing_local_references[0].target_path, "api/missing.yaml");
  assert.ok(graph.nodes.some((node) => node.type === "category" && node.label === "source-code"));
  assert.ok(graph.nodes.some((node) => node.type === "heading" && node.label === "Payment flow"));
  assert.deepEqual(
    graph.nodes.filter((node) => node.type === "heading" && node.label === "Evidence").map((node) => node.line),
    [4],
  );
  assert.ok(graph.nodes.some((node) => node.type === "symbol" && node.label === "PaymentService"));
  const paymentServiceSymbol = graph.nodes.find((node) =>
    node.type === "symbol" && node.label === "PaymentService");
  assert.equal(paymentServiceSymbol.line, 3);
  assert.ok(graph.edges.some((edge) =>
    edge.type === "defines_symbol" && edge.to === paymentServiceSymbol.id &&
    edge.evidence.line === 3 && /^[a-f0-9]{64}$/.test(edge.evidence.sha256) &&
    edge.provenance.kind === "source_extraction" && edge.provenance.inferred === false));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "contains_heading" && edge.evidence.source_path === "docs/architecture.md" &&
    /^[a-f0-9]{64}$/.test(edge.evidence.sha256)));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "contains_section" && edge.evidence.line === 4));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "contains_section" &&
    edge.provenance.kind === "parsed_document_structure" &&
    edge.provenance.inferred === false));
  assert.ok(graph.edges.every((edge) =>
    edge.provenance && edge.provenance.inferred === false &&
    edge.evidence && typeof edge.evidence.source_path === "string"));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "links_to_source" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "docs/architecture.md" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "api/payments.md" &&
    edge.evidence.line === 3 && edge.provenance.kind === "explicit_source_reference" &&
    edge.provenance.inferred === false));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "imports_source" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "src/payment-service.ts" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "src/payment-types.ts" &&
    edge.evidence.line === 1 && edge.provenance.kind === "explicit_source_reference" &&
    edge.provenance.inferred === false));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "depends_on_local_package" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "packages/client/package.json" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "packages/shared/package.json" &&
    edge.evidence.line === 5 && /^[a-f0-9]{64}$/.test(edge.evidence.sha256) &&
    edge.provenance.kind === "explicit_source_reference"));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "depends_on_local_package" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "packages/tool/package.json" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "packages/shared/package.json"));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "tests_source" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "tests/payment-service.test.ts" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "src/payment-service.ts" &&
    edge.evidence.line === 1));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "tests_imports_symbol" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "tests/payment-service.test.ts" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "src/payment-service.ts" &&
    graph.nodes.find((node) => node.id === edge.to)?.label === "PaymentService" &&
    edge.evidence.line === 1 && /^[a-f0-9]{64}$/.test(edge.evidence.sha256) &&
    edge.provenance.kind === "explicit_source_reference" &&
    edge.provenance.inferred === false));
  assert.equal(graph.edges.some((edge) =>
    edge.type === "tests_imports_symbol" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "tests/payment-service.test.ts" &&
    graph.nodes.find((node) => node.id === edge.to)?.label === "PaymentType"), false);
  assert.ok(graph.edges.some((edge) =>
    edge.type === "declares_local_module" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "infra/main.tf" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "infra/modules/network/main.tf" &&
    edge.evidence.line === 2));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "references_api_schema" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "api/openapi.yaml" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "api/schemas/payment.yaml" &&
    edge.evidence.line === 5));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "uses_local_action" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === ".github/workflows/deploy.yml" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === ".github/actions/deploy/action.yml" &&
    edge.evidence.line === 5));
  assert.ok(graph.nodes.some((node) => node.type === "database_table" && node.label === "dbo.Customers"));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "defines_database_table" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "db/schema.sql" &&
    graph.nodes.find((node) => node.id === edge.to)?.label === "dbo.Payments" &&
    edge.evidence.line === 4));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "references_database_table" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "db/schema.sql" &&
    graph.nodes.find((node) => node.id === edge.to)?.label === "dbo.Customers" &&
    edge.evidence.line === 5));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "contains_dotnet_project" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "infra/dotnet/App.sln" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "infra/dotnet/App/App.csproj" &&
    edge.evidence.line === 2));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "contains_dotnet_project" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "infra/dotnet/App.slnx" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "infra/dotnet/Common/Common.csproj" &&
    edge.evidence.line === 3));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "references_dotnet_project" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "infra/dotnet/App/App.csproj" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "infra/dotnet/Common/Common.csproj" &&
    edge.evidence.line === 2 && /^[a-f0-9]{64}$/.test(edge.evidence.sha256)));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "imports_build_file" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "infra/dotnet/App/App.csproj" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "infra/dotnet/Directory.Build.props" &&
    edge.evidence.line === 3));
  assert.ok(graph.edges.some((edge) =>
    edge.type === "imports_build_file" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "infra/dotnet/Directory.Build.props" &&
    graph.nodes.find((node) => node.id === edge.to)?.source_path === "infra/dotnet/msbuild/Custom.targets"));
  assert.ok(graph.nodes.some((node) => node.type === "data_field" &&
    node.source_path === "data/payments.csv" && node.label === "payment,amount"));
  assert.deepEqual(graph.nodes.filter((node) =>
    node.type === "data_field" && node.source_path === "data/schemas.md")
    .map((node) => [node.label, node.line]).sort(), [
    ["Amount", 7],
    ["Customer ID", 3],
    ["Name", 3],
    ["Payment ID", 7],
  ]);
  assert.ok(graph.edges.some((edge) =>
    edge.type === "defines_field" &&
    graph.nodes.find((node) => node.id === edge.from)?.source_path === "data/payments.csv" &&
    graph.nodes.find((node) => node.id === edge.to)?.label === "customer_id" &&
    edge.evidence.line === 1 && /^[a-f0-9]{64}$/.test(edge.evidence.sha256)));
  assert.equal(graph.edges.filter((edge) => edge.type === "links_to_source").length, 1);
  assert.ok(searchUnifiedGraph(root, "idempotent payment")
    .some((match) => match.source_path === "docs/architecture.md"));
  const impact = analyzeImpact(root, "src/payment-types.ts");
  assert.deepEqual(impact.affected_sources.map(({ source_path, depth }) => ({ source_path, depth })), [
    { source_path: "src/payment-service.ts", depth: 1 },
    { source_path: "src/payment-controller.ts", depth: 2 },
  ]);
  assert.deepEqual(impact.affected_sources[1].chain, [
    "src/payment-types.ts",
    "src/payment-service.ts",
    "src/payment-controller.ts",
  ]);
  assert.equal(impact.affected_sources[0].evidence[0].line, 1);
  const dotnetImpact = analyzeImpact(root, "infra/dotnet/Common/Common.csproj");
  assert.deepEqual(dotnetImpact.affected_sources.map(({ source_path, depth }) => ({ source_path, depth })), [
    { source_path: "infra/dotnet/App.sln", depth: 1 },
    { source_path: "infra/dotnet/App.slnx", depth: 1 },
    { source_path: "infra/dotnet/App/App.csproj", depth: 1 },
  ]);
  const buildFileImpact = analyzeImpact(root, "infra/dotnet/msbuild/Custom.targets");
  assert.deepEqual(buildFileImpact.affected_sources.map(({ source_path, depth }) => ({ source_path, depth })), [
    { source_path: "infra/dotnet/Directory.Build.props", depth: 1 },
    { source_path: "infra/dotnet/App/App.csproj", depth: 2 },
    { source_path: "infra/dotnet/App.sln", depth: 3 },
    { source_path: "infra/dotnet/App.slnx", depth: 3 },
  ]);
  assert.deepEqual(analyzeImpact(root, "api/schemas/payment.yaml").affected_sources
    .map(({ source_path }) => source_path), ["api/openapi.yaml"]);
  assert.deepEqual(analyzeImpact(root, "infra/modules/network/main.tf").affected_sources
    .map(({ source_path }) => source_path), ["infra/main.tf"]);
  assert.deepEqual(analyzeImpact(root, "packages/shared/package.json").affected_sources
    .map(({ source_path }) => source_path), ["packages/client/package.json", "packages/tool/package.json"]);
  assert.deepEqual(analyzeImpact(root, ".github/actions/deploy/action.yml").affected_sources
    .map(({ source_path }) => source_path), [".github/workflows/deploy.yml"]);
  assert.deepEqual(analyzeImpact(root, "db/schema.sql").affected_sources
    .map(({ source_path }) => source_path), ["db/foreign-key.sql"]);
  const documentImpact = analyzeImpact(root, "api/payments.md");
  assert.equal(documentImpact.referencing_sources.length, 1);
  assert.equal(documentImpact.referencing_sources[0].source_path, "docs/architecture.md");
  assert.equal(documentImpact.referencing_sources[0].evidence.line, 3);
  assert.throws(() => analyzeImpact(root, "../outside.ts"), /must stay inside the project/);
  assert.throws(() => analyzeImpact(root, "src/not-indexed.ts"), /not an indexed source/);
  const impactJson = execFileSync(process.execPath, [
    cli, "impact", "--project", root, "--path", "src/payment-types.ts", "--json",
  ], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(impactJson).affected_sources.map((item) => item.source_path), [
    "src/payment-service.ts",
    "src/payment-controller.ts",
  ]);

  buildUnifiedGraph(root);
  const rebuilt = JSON.parse(fs.readFileSync(graphFile, "utf8"));
  assert.deepEqual(rebuilt.nodes, graph.nodes);
  assert.deepEqual(rebuilt.edges, graph.edges);
  assert.throws(() => searchUnifiedGraph(root, " "), /must not be empty/);
  assert.throws(() => searchUnifiedGraph(root, "payments", 101), /between 1 and 100/);

  fs.appendFileSync(architecture, "\nChanged after indexing.\n");
  assert.throws(() => buildUnifiedGraph(root), /Source changed after sync/);
  assert.throws(() => analyzeImpact(root, "api/payments.md"), /changed after sync/);
  fs.writeFileSync(architecture, [
    "# Payment flow",
    "",
    "Payments use idempotent requests and see [the API](../api/payments.md#contract) and [an obsolete draft](../api/missing.yaml).",
    "",
    "## Evidence",
    "",
    "```md",
    "[not a graph link](../outside.md)",
    "```",
    "[external](https://example.test/api.md)",
    "[outside](../../outside.md)",
    "",
  ].join("\n"));
  fs.writeFileSync(graphFile, JSON.stringify({ generated_by: "user" }));
  assert.throws(() => buildUnifiedGraph(root), /Refusing to overwrite non-MCPEE graph artifact/);
});

test("sync reports missing explicit schema and local-package references as source-traceable drift", () => {
  const root = temporaryProject();
  initializeProject(root);
  const apiPath = path.join(root, "api/openapi.yaml");
  const packagePath = path.join(root, "packages/client/package.json");
  fs.mkdirSync(path.dirname(apiPath), { recursive: true });
  fs.mkdirSync(path.dirname(packagePath), { recursive: true });
  fs.writeFileSync(apiPath, [
    "openapi: 3.1.0",
    "components:",
    "  schemas:",
    "    Missing:",
    '      $ref: "./schemas/missing.yaml"',
    "",
  ].join("\n"));
  fs.writeFileSync(packagePath, JSON.stringify({
    name: "@example/client",
    dependencies: {
      "@example/missing": "file:../missing",
    },
  }, null, 2));

  syncProject(root);

  assert.deepEqual(getDocumentDrift(root).map(({ source_path, target_path, line }) =>
    ({ source_path, target_path, line })), [
    {
      source_path: "api/openapi.yaml",
      target_path: "api/schemas/missing.yaml",
      line: 5,
    },
    {
      source_path: "packages/client/package.json",
      target_path: "packages/missing/package.json",
      line: 4,
    },
  ]);
});

test("sync reports broken explicit relative JavaScript imports without inventing external dependencies", () => {
  const root = temporaryProject();
  initializeProject(root);
  const sourcePath = path.join(root, "src/service.js");
  const externalPath = path.join(root, "src/external.js");
  const localConfigPath = path.join(root, "src/service-config.json");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, [
    'import { missing } from "./missing.js";',
    'import library from "third-party-library";',
    'import config from "./service-config";',
    "",
  ].join("\n"));
  fs.writeFileSync(externalPath, "export default true;\n");
  fs.writeFileSync(localConfigPath, '{"enabled":true}\n');

  syncProject(root);

  assert.deepEqual(getDocumentDrift(root).map(({ source_path, target_path, line }) =>
    ({ source_path, target_path, line })), [{
    source_path: "src/service.js",
    target_path: "src/missing.js",
    line: 1,
  }]);
  const graph = JSON.parse(fs.readFileSync(path.join(root, GRAPH_PATH), "utf8"));
  const source = graph.nodes.find((node) => node.type === "source" && node.source_path === "src/service.js");
  const config = graph.nodes.find((node) => node.type === "source" && node.source_path === "src/service-config.json");
  assert.ok(graph.edges.some((edge) =>
    edge.type === "imports_source" && edge.from === source.id && edge.to === config.id &&
    edge.evidence.line === 3));
});

test("documentation drift reports explicit opposite claims with current evidence", () => {
  const root = temporaryProject();
  initializeProject(root);
  const requiredDoc = path.join(root, "docs/architecture.md");
  const optionalDoc = path.join(root, "docs/setup.md");
  fs.mkdirSync(path.dirname(requiredDoc), { recursive: true });
  fs.writeFileSync(requiredDoc, [
    "# Architecture",
    "",
    "`CodeGraph` is required for routing.",
    "",
    "```md",
    "`ExampleTool` is optional.",
    "```",
    "",
  ].join("\n"));
  fs.writeFileSync(optionalDoc, "# Setup\n\n`CodeGraph` is optional in this project.\n");

  syncProject(root);
  const conflicts = getDocumentContradictions(root);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].anchor, "codegraph");
  assert.equal(conflicts[0].topic, "requirement");
  assert.deepEqual(conflicts[0].claims.map(({ source_path, line, value }) =>
    ({ source_path, line, value })), [
    { source_path: "docs/architecture.md", line: 3, value: "positive" },
    { source_path: "docs/setup.md", line: 3, value: "negative" },
  ]);
  assert.deepEqual(getDocumentDrift(root), []);

  const cliOutput = execFileSync(process.execPath, [
    cli, "drift", "--project", root, "--json",
  ], { encoding: "utf8" });
  const report = JSON.parse(cliOutput);
  assert.equal(report.conflicting_claims[0].id, conflicts[0].id);
  assert.equal(report.missing_local_references.length, 0);

  fs.appendFileSync(optionalDoc, "\nChanged after indexing.\n");
  assert.throws(() => getDocumentContradictions(root), /evidence is stale/);
});

test("documentation drift correlates explicit availability claims with boolean configuration", () => {
  const root = temporaryProject();
  initializeProject(root);
  const documentation = path.join(root, "docs/features.md");
  const configuration = path.join(root, "config/features.yml");
  fs.mkdirSync(path.dirname(documentation), { recursive: true });
  fs.mkdirSync(path.dirname(configuration), { recursive: true });
  fs.writeFileSync(documentation, "# Feature status\n`FeatureToggle` is available to users.\n");
  fs.writeFileSync(configuration, "FeatureToggle: false\n");

  syncProject(root);
  const conflicts = getDocumentContradictions(root);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "conflicting_source_claims");
  assert.equal(conflicts[0].anchor, "featuretoggle");
  assert.deepEqual(conflicts[0].claims.map(({ source_path, line, value }) =>
    ({ source_path, line, value })), [
    { source_path: "config/features.yml", line: 1, value: "negative" },
    { source_path: "docs/features.md", line: 2, value: "positive" },
  ]);

  fs.appendFileSync(configuration, "# changed\n");
  assert.throws(() => getDocumentContradictions(root), /evidence is stale/);
});

test("drift compares explicit boolean implementation and test assertions", () => {
  const root = temporaryProject();
  initializeProject(root);
  const fixtures = {
    "docs/features.md": "# Feature\nNo availability statement is made.\n",
    "src/feature.js": "export const featureEnabled = false;\n",
    "tests/feature.test.js": "assert.equal(featureEnabled, true);\n",
  };
  for (const [relative, contents] of Object.entries(fixtures)) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  }

  syncProject(root);
  const conflicts = getDocumentContradictions(root);
  assert.ok(conflicts.some((finding) =>
    finding.anchor === "featureenabled" &&
    finding.claims.some((claim) => claim.source_path === "src/feature.js") &&
    finding.claims.some((claim) => claim.source_path === "tests/feature.test.js")));
});

test("drift correlates current CodeGraph runtime status without staling on unrelated telemetry", () => {
  const root = temporaryProject();
  initializeProject(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/runtime.md"), "`CodeGraph` is available.\n");
  recordEvent(root, {
    event_name: "knowledge.codegraph.completed",
    attributes: { status: "failed" },
  });
  syncProject(root);

  const conflicts = getDocumentContradictions(root);
  const runtimeConflict = conflicts.find((finding) =>
    finding.anchor === "codegraph" &&
    finding.claims.some((claim) => claim.evidence_kind === "telemetry_event"));
  assert.ok(runtimeConflict);
  recordEvent(root, { event_name: "project.health.checked", attributes: { status: "ready" } });
  assert.equal(getDocumentContradictions(root).some((finding) => finding.id === runtimeConflict.id), true);

  recordEvent(root, {
    event_name: "knowledge.codegraph.completed",
    attributes: { status: "ready" },
  });
  assert.throws(() => getDocumentContradictions(root), /Runtime contradiction evidence is stale/);
});

test("tool manager discovers and validates Node and invokes allowlisted executables without a shell", () => {
  const root = temporaryProject();
  initializeProject(root);
  const tools = discoverTools(root);
  const nodeTool = tools.tools.find((tool) => tool.id === "node");
  assert.equal(nodeTool.available, true);
  assert.equal(nodeTool.invokable, true);

  const validation = validateTool(root, "node");
  assert.equal(validation.validation, "passed");
  assert.match(validation.version, /^v\d+/);
  const npmTool = tools.tools.find((tool) => tool.id === "npm");
  assert.equal(npmTool.available, true);
  assert.equal(npmTool.invokable, true);
  const npmValidation = validateTool(root, "npm");
  assert.equal(npmValidation.validation, "passed", JSON.stringify(npmValidation));
  assert.match(npmValidation.version, /^v?\d+/);

  const result = invokeTool(root, "node", ["--version"]);
  assert.equal(result.status, "success");
  assert.match(result.stdout, /^v\d+/);
  const npmResult = invokeTool(root, "npm", ["--version"]);
  assert.equal(npmResult.status, "success");
  assert.match(npmResult.stdout, /^v?\d+/);
  assert.throws(() => invokeTool(root, "not-in-catalog", []), /not allowlisted/);
  assert.throws(() => invokeTool(root, "node", ["--version"], { cwd: ".." }), /inside the project/);
});

test("npm wrapper resolution finds the JavaScript CLI without invoking a Windows shell wrapper", () => {
  const root = temporaryProject();
  const nodeExecutable = path.join(root, "runtime", "node.exe");
  const npmWrapper = path.join(root, "npm", "npm.cmd");
  const npmCli = path.join(root, "runtime", "node_modules", "npm", "bin", "npm-cli.js");
  fs.mkdirSync(path.dirname(npmCli), { recursive: true });
  fs.mkdirSync(path.dirname(npmWrapper), { recursive: true });
  fs.writeFileSync(nodeExecutable, "");
  fs.writeFileSync(npmWrapper, "");
  fs.writeFileSync(npmCli, "process.exit(0);\n");

  assert.equal(npmCliPath(nodeExecutable, npmWrapper), npmCli);
  assert.equal(npmCliPath(path.join(root, "missing", "node.exe"), npmWrapper), null);
});

test("observe aggregates execution, authorization, and validation outcomes", () => {
  const root = temporaryProject();
  initializeProject(root);
  const observations = [
    {
      event_name: "tool.invocation.completed",
      tool_name: "npm",
      attributes: { duration_ms: 45000, exit_code: 0, failed_to_start: false, timed_out: false },
    },
    {
      event_name: "tool.invocation.completed",
      tool_name: "dotnet",
      attributes: { duration_ms: 30000, exit_code: null, failed_to_start: true, timed_out: true },
    },
    {
      event_name: "routing.plan.created",
      attributes: {
        fallback: true,
        impact_preflight_status: "unavailable",
        memory_candidates: 1,
        knowledge_candidates: 2,
        knowledge_graph_candidates: 3,
        unified_graph_candidates: 2,
        codegraph_candidates: 1,
        available_tools: 4,
      },
    },
    {
      event_name: "copilot.execution.started",
      session_id: "observed-session",
      attributes: { context_mode: "repomix-selected-sources", context_bytes: 512, context_source_count: 2 },
    },
    {
      event_name: "copilot.execution.completed",
      session_id: "observed-session",
      attributes: { outcome: "success", duration_ms: 120 },
    },
    {
      event_name: "copilot.tool.authorization",
      session_id: "observed-session",
      tool_name: "edit_file",
      attributes: { decision: "allow", approval: "human-approved-once" },
    },
    {
      event_name: "copilot.tool.completed",
      session_id: "observed-session",
      tool_name: "edit_file",
      attributes: { result: "success" },
    },
    {
      event_name: "copilot.sdk.assistant.usage",
      session_id: "observed-session",
      attributes: { model: "test-model", input_tokens: 44, output_tokens: 12, cost: 0.02 },
    },
    {
      event_name: "copilot.sdk.tool.execution_complete",
      session_id: "observed-session",
      tool_name: "edit_file",
      attributes: { duration_ms: 35, result: "success" },
    },
    {
      event_name: "evaluation.completed",
      attributes: { status: "passed", check_count: 2, passed_checks: 2, failed_checks: 0, blocked_checks: 0, duration_ms: 250 },
    },
    {
      event_name: "workflow.completed",
      attributes: { status: "failed", check_count: 3, passed_checks: 1, failed_checks: 1, blocked_checks: 1, duration_ms: 450 },
    },
  ];
  for (const event of observations) recordEvent(root, event);

  const output = execFileSync(process.execPath, [cli, "observe", "--project", root, "--json"], {
    encoding: "utf8",
  });
  const report = JSON.parse(output);
  assert.equal(report.outcomes.routing.fallbacks, 1);
  assert.equal(report.outcomes.routing.impact_preflight_unready, 1);
  assert.equal(report.outcomes.routing.codegraph_candidates, 1);
  assert.equal(report.outcomes.context.repomix_packaged, 1);
  assert.equal(report.outcomes.context.bytes_total, 512);
  assert.deepEqual(report.outcomes.copilot, {
    completed: 1,
    succeeded: 1,
    failed: 0,
    duration_ms_total: 120,
    duration_ms_average: 120,
  });
  assert.equal(report.outcomes.tool_authorizations.human_approved, 1);
  assert.equal(report.outcomes.tool_results.succeeded, 1);
  assert.equal(report.outcomes.model_usage.calls, 1);
  assert.equal(report.outcomes.model_usage.input_tokens_total, 44);
  assert.equal(report.outcomes.model_usage.output_tokens_total, 12);
  assert.equal(report.outcomes.model_usage.cost_total, 0.02);
  assert.equal(report.outcomes.model_usage.models["test-model"], 1);
  assert.equal(report.outcomes.tools.duration_ms_total, 35);
  assert.equal(report.outcomes.tools.duration_ms_average, 35);
  assert.deepEqual(report.outcomes.local_tools, {
    total: 2, succeeded: 1, failed: 1, timed_out: 1,
    duration_ms_total: 75000, timed_calls: 2, duration_ms_average: 37500,
  });
  assert.equal(report.outcomes.evaluations.passed, 1);
  assert.equal(report.outcomes.evaluations.passed_checks, 2);
  assert.equal(report.outcomes.workflows.failed, 1);
  assert.equal(report.outcomes.workflows.blocked_checks, 1);
  assert.equal(report.outcomes.workflows.duration_ms_average, 450);
  const exportPath = path.join(root, "reports/observe.json");
  assert.equal(fs.existsSync(exportPath), false);
  const exportedOutput = execFileSync(process.execPath, [
    cli, "observe", "--project", root, "--json", "--export", "reports/observe.json",
  ], { encoding: "utf8" });
  assert.equal(JSON.parse(exportedOutput).event_count, report.event_count);
  const exportedReport = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  assert.equal(exportedReport.generated_by, "mcpee");
  assert.equal(exportedReport.event_count, report.event_count);
});

test("tool installation uses isolated pinned environments and accepts compatible Node runtimes", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const calls = [];
  const systemPython = path.join(root, "test-python");
  const localUv = path.join(root, ".mcpee/tools/bootstrap/uv", process.platform === "win32" ? "Scripts/uv.exe" : "bin/uv");
  let managedPythonVersion = "3.14.8";
  const runtimePython = () => path.join(
    root,
    `.mcpee/tools/python/runtime/cpython-${managedPythonVersion}`,
    process.platform === "win32" ? "python.exe" : "bin/python",
  );
  const runProcess = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === systemPython && args.length === 1 && args[0] === "--version") {
      return { status: 0, stdout: "Python 3.12.1\n", stderr: "" };
    }
    if (command === systemPython && args[0] === "-m" && args[1] === "pip") {
      fs.mkdirSync(path.dirname(localUv), { recursive: true });
      fs.writeFileSync(localUv, "test uv");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === localUv && args[0] === "--version") {
      return { status: 0, stdout: "uv 0.12.24 (5411378eb 2026-10-08 x86_64-pc-windows-msvc)\n", stderr: "" };
    }
    if (command === localUv && args[0] === "python" && args[1] === "find") {
      fs.mkdirSync(path.dirname(runtimePython()), { recursive: true });
      fs.writeFileSync(runtimePython(), "test runtime");
      return { status: 0, stdout: `${runtimePython()}\n`, stderr: "" };
    }
    if (command === localUv && args[0] === "python") return { status: 0, stdout: "", stderr: "" };
    if (command === runtimePython() && args[0] === "--version") {
      return { status: 0, stdout: `Python ${managedPythonVersion}\n`, stderr: "" };
    }
    if (command === localUv && args[0] === "venv") {
      const environment = args.at(-1);
      const scripts = path.join(environment, process.platform === "win32" ? "Scripts" : "bin");
      fs.mkdirSync(scripts, { recursive: true });
      fs.writeFileSync(path.join(scripts, process.platform === "win32" ? "python.exe" : "python"), "test environment");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === localUv && args[0] === "pip") return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "-c") return { status: 0, stdout: "0.1.8\n", stderr: "" };
    throw new Error(`Unexpected test command: ${command} ${args.join(" ")}`);
  };
  const pythonInstall = await installCatalogTools(root, {
    onlyTools: ["markitdown"],
    skipNodeTools: true,
    approveInstall: async () => true,
    pythonExecutable: systemPython,
    runProcess,
  });
  assert.equal(pythonInstall.results[0].status, "installed");
  assert.equal(pythonInstall.pythonRuntime.version, "3.14.8");
  assert.ok(calls.some((call) => call.command === systemPython && call.args.includes("uv==0.12.24")));
  assert.ok(calls.some((call) => call.command === localUv && call.args.join(" ") === "python install"));
  assert.ok(calls.some((call) => call.command === localUv && call.args.join(" ") === "python upgrade"));
  assert.ok(calls.some((call) => call.args.includes("markitdown[pdf,docx,pptx,xlsx]==0.1.8")));
  assert.ok(calls.every((call) => call.options.shell !== true));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/tools/.mcpee-owned")));
  assert.equal(discoverTools(root).tools.find((tool) => tool.id === "python").executable, runtimePython());

  const repeatedInstall = await installCatalogTools(root, {
    onlyTools: ["markitdown"],
    skipNodeTools: true,
    approveInstall: async () => true,
    pythonExecutable: systemPython,
    runProcess,
  });
  assert.equal(repeatedInstall.results[0].status, "already-installed");
  assert.equal(repeatedInstall.pythonRuntime.version, "3.14.8");
  managedPythonVersion = "3.15.0";
  const upgradedRuntime = await installCatalogTools(root, {
    onlyTools: ["markitdown"],
    skipNodeTools: true,
    approveInstall: async () => true,
    pythonExecutable: systemPython,
    runProcess,
  });
  assert.equal(upgradedRuntime.results[0].status, "installed");
  assert.equal(upgradedRuntime.pythonRuntime.version, "3.15.0");
  const environmentPaths = calls.filter((call) => call.command === localUv && call.args[0] === "venv")
    .map((call) => call.args.at(-1));
  assert.ok(environmentPaths.some((environment) => environment.includes("3.14.8")));
  assert.ok(environmentPaths.some((environment) => environment.includes("3.15.0")));
  assert.equal(discoverTools(root).tools.find((tool) => tool.id === "python").executable, runtimePython());
  assert.equal(isVersionAtLeast("24.21.0", "24.0.0"), true);
  assert.equal(isVersionAtLeast("22.23.0", "24.0.0"), false);

  const deniedRoot = temporaryProject();
  initializeProject(deniedRoot);
  const deniedInstall = await installCatalogTools(deniedRoot, {
    onlyTools: ["repomix"],
    latestLts: process.version,
    approveInstall: async () => false,
    runProcess: () => {
      throw new Error("a denied installation must not invoke a package manager");
    },
  });
  assert.equal(deniedInstall.results[0].status, "blocked");
  assert.equal(fs.existsSync(path.join(deniedRoot, ".mcpee/tools/npm/node_modules/repomix")), false);

  const nodeRoot = temporaryProject();
  initializeProject(nodeRoot);
  const nodeInstall = await installCatalogTools(nodeRoot, {
    onlyTools: ["repomix"],
    latestLts: "v99.0.0",
    approveInstall: async () => true,
    npmCli: path.join(nodeRoot, "fixture-npm.js"),
    runProcess: () => ({ status: 1, stderr: "Fixture package install failure" }),
  });
  assert.equal(nodeInstall.results[0].status, "failed");
  assert.match(nodeInstall.results[0].reason, /Fixture package install failure/);
});

test("npm CLI tools install and execute inside MCPEE's isolated tool prefix", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const npmCli = path.join(root, "test-npm-cli.js");
  const runProcess = (command, args) => {
    assert.equal(command, process.execPath);
    assert.equal(args[0], npmCli);
    const prefix = args[args.indexOf("--prefix") + 1];
    const packageRoot = path.join(prefix, "node_modules/repomix");
    fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ version: "1.18.1" }));
    fs.writeFileSync(path.join(packageRoot, "bin/repomix.cjs"), "process.stdout.write(process.argv.at(-1));\n");
    return { status: 0, stdout: "", stderr: "" };
  };
  const result = await installCatalogTools(root, {
    onlyTools: ["repomix"],
    latestLts: process.version,
    npmCli,
    approveInstall: async () => true,
    runProcess,
  });
  assert.equal(result.results[0].status, "installed");
  assert.equal(fs.existsSync(path.join(root, "package.json")), false);
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
  const available = discoverTools(root).tools.find((tool) => tool.id === "repomix");
  assert.equal(available.available, true);
  assert.equal(invokeTool(root, "repomix", ["--version"]).stdout, "--version");
  assert.equal(validateTool(root, "repomix").validation, "passed");
});

test("CodeGraph installs its scoped platform bundle locally and disables user-home downloads", async () => {
  const root = temporaryProject();
  initializeProject(root);
  const npmCli = path.join(root, "test-npm-cli.js");
  const runProcess = (command, args) => {
    assert.equal(command, process.execPath);
    assert.equal(args[0], npmCli);
    const prefix = args[args.indexOf("--prefix") + 1];
    const packageRoot = path.join(prefix, "node_modules/@colbymchenry/codegraph");
    const platformRoot = path.join(
      prefix,
      `node_modules/@colbymchenry/codegraph-${process.platform}-${process.arch}`,
    );
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(platformRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ version: "1.6.2" }));
    fs.writeFileSync(
      path.join(packageRoot, "npm-shim.js"),
      "process.stdout.write(`${process.env.CODEGRAPH_NO_DOWNLOAD}:${process.argv.at(-1)}`);\n",
    );
    fs.writeFileSync(path.join(platformRoot, "package.json"), JSON.stringify({ version: "1.6.2" }));
    return { status: 0, stdout: "", stderr: "" };
  };
  const result = await installCatalogTools(root, {
    onlyTools: ["codegraph"],
    latestLts: process.version,
    npmCli,
    approveInstall: async () => true,
    runProcess,
  });
  assert.equal(result.results[0].status, "installed");
  assert.ok(result.results[0].version === "1.6.2");
  const discovered = discoverTools(root).tools.find((tool) => tool.id === "codegraph");
  assert.equal(discovered.available, true);
  assert.equal(invokeTool(root, "codegraph", ["--version"]).stdout, "1:--version");
  assert.equal(validateTool(root, "codegraph").validation, "passed");

  const missingBundleRoot = temporaryProject();
  initializeProject(missingBundleRoot);
  const missingBundleInstall = await installCatalogTools(missingBundleRoot, {
    onlyTools: ["codegraph"],
    latestLts: process.version,
    npmCli,
    approveInstall: async () => true,
    runProcess: (command, args) => {
      assert.equal(command, process.execPath);
      const prefix = args[args.indexOf("--prefix") + 1];
      const packageRoot = path.join(prefix, "node_modules/@colbymchenry/codegraph");
      fs.mkdirSync(packageRoot, { recursive: true });
      fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ version: "1.6.2" }));
      fs.writeFileSync(path.join(packageRoot, "npm-shim.js"), "");
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(missingBundleInstall.results[0].status, "failed");
  assert.match(missingBundleInstall.results[0].reason, /did not provide the platform runtime/);
});

function installFakeCodeGraph(root) {
  const packageRoot = path.join(root, ".mcpee/tools/npm/node_modules/@colbymchenry/codegraph");
  const platformRoot = path.join(
    root,
    `.mcpee/tools/npm/node_modules/@colbymchenry/codegraph-${process.platform}-${process.arch}`,
  );
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(platformRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ version: "1.6.2" }));
  fs.writeFileSync(path.join(platformRoot, "package.json"), JSON.stringify({ version: "1.6.2" }));
  fs.writeFileSync(path.join(packageRoot, "npm-shim.js"), [
    '"use strict";',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const [command] = process.argv.slice(2);',
    'const directory = process.env.CODEGRAPH_DIR;',
    'if (directory !== ".codegraph") throw new Error("CodeGraph requires a plain relative directory name");',
    'const stateFile = path.join(directory, "index.json");',
    'if (command === "status") {',
    '  const initialized = fs.existsSync(stateFile);',
    '  process.stdout.write(JSON.stringify({ initialized, version: "1.6.2", fileCount: 3, nodeCount: 8, edgeCount: 5 }));',
    '} else if (command === "init" || command === "sync") {',
    '  fs.mkdirSync(directory, { recursive: true });',
    '  fs.appendFileSync(path.join(directory, "calls.jsonl"), `${JSON.stringify({ command, doNotTrack: process.env.DO_NOT_TRACK, noDownload: process.env.CODEGRAPH_NO_DOWNLOAD, noUpdateCheck: process.env.CODEGRAPH_NO_UPDATE_CHECK })}\\n`);',
    '  fs.writeFileSync(stateFile, "{}");',
    '} else if (command === "query") {',
    '  const filePath = process.argv.includes("outside") ? "../outside.js" : "src/app.js";',
    '  process.stdout.write(JSON.stringify([{ node: { filePath, name: "handleRequest", kind: "function", startLine: 12 }, score: 1.2 }]));',
    '} else { process.exitCode = 2; }',
  ].join("\n"), "utf8");
}

test("CodeGraph lifecycle builds and refreshes a project-local graph and exposes traceable queries", () => {
  const root = temporaryProject();
  initializeProject(root);
  const requiredButUnavailable = updateCodeGraph(root, { available: false, required: true });
  assert.equal(requiredButUnavailable.status, "failed");
  assert.match(requiredButUnavailable.error, /CodeGraph is required/);
  installFakeCodeGraph(root);
  const first = updateCodeGraph(root, { available: true, required: true });
  assert.equal(first.status, "ready");
  assert.equal(first.operation, "init");
  assert.equal(first.summary.node_count, 8);
  assert.equal(first.mcp.status, "configured");
  const config = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
  const server = config.mcpServers["mcpee-codegraph"];
  assert.deepEqual(server.env, {
    CODEGRAPH_NO_DOWNLOAD: "1",
    CODEGRAPH_NO_UPDATE_CHECK: "1",
    DO_NOT_TRACK: "1",
    CODEGRAPH_DIR: ".codegraph",
  });
  assert.ok(server.args.includes("--no-watch"));
  assert.deepEqual(server.args.slice(server.args.indexOf("--path"), server.args.indexOf("--path") + 2), ["--path", "."]);
  assert.deepEqual(config.mcpServers.mcpee, {
    type: "stdio",
    command: "node",
    args: ["./.mcpee/runtime/mcp-server.cjs"],
  });
  assert.equal(JSON.stringify(config).includes("${workspaceFolder}"), false);
  assert.equal(fs.existsSync(path.join(root, ".vscode/mcp.json")), false);
  assert.match(
    fs.readFileSync(path.join(root, ".github/instructions/mcpee-catalog.instructions.md"), "utf8"),
    /invoke the project-scoped\n`mcpee_run` MCP tool from ordinary Copilot Chat/,
  );
  assert.equal(fs.existsSync(path.join(root, ".codegraph")), true);

  const second = updateCodeGraph(root, { available: true });
  assert.equal(second.status, "ready");
  assert.equal(second.operation, "sync");
  const calls = fs.readFileSync(path.join(root, ".codegraph/calls.jsonl"), "utf8")
    .trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.deepEqual(calls.map((call) => call.command), ["init", "sync"]);
  assert.ok(calls.every((call) =>
    call.doNotTrack === "1" && call.noDownload === "1" && call.noUpdateCheck === "1"));
  const matches = searchCodeGraph(root, "handle request", 5);
  assert.deepEqual(matches, [{
    source_path: "src/app.js",
    symbol: "handleRequest",
    symbol_kind: "function",
    start_line: 12,
    score: 1.2,
  }]);
  assert.throws(() => searchCodeGraph(root, "outside"), /source outside the project/);
});

test("CodeGraph MCP configuration preserves existing servers and refuses an owned-name conflict", () => {
  const root = temporaryProject();
  const configPath = path.join(root, ".mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: { existing: { command: "node", args: ["existing.js"] } },
    inputs: [],
  }));
  assert.equal(configureProjectMcp(root, { available: true }).status, "configured");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(config.mcpServers.existing.args, ["existing.js"]);
  assert.equal(configureProjectMcp(root, { available: true }).status, "unchanged");
  config.mcpServers["mcpee-codegraph"] = { command: "user-owned" };
  fs.writeFileSync(configPath, JSON.stringify(config));
  assert.equal(configureProjectMcp(root, { available: true }).status, "conflict");
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).mcpServers["mcpee-codegraph"].command, "user-owned");
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")).mcpServers.mcpee, {
    type: "stdio",
    command: "node",
    args: ["./.mcpee/runtime/mcp-server.cjs"],
  });
});

test("CodeGraph accepts equivalent host-resolved stdio paths without replacing host settings", () => {
  const root = temporaryProject();
  assert.equal(configureProjectMcp(root, { available: true }).status, "configured");
  const configPath = path.join(root, ".mcp.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  for (const server of Object.values(config.mcpServers)) {
    server.args[0] = path.resolve(root, server.args[0]);
    server.tools = ["*"];
  }
  const codegraph = config.mcpServers["mcpee-codegraph"];
  codegraph.args[4] = root;
  codegraph.env.CODEGRAPH_DIR = path.join(root, ".codegraph");
  fs.writeFileSync(configPath, JSON.stringify(config));
  const before = fs.readFileSync(configPath, "utf8");
  assert.equal(configureProjectMcp(root, { available: true }).status, "unchanged");
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
  codegraph.args[0] = path.join(root, "other-shim.js");
  fs.writeFileSync(configPath, JSON.stringify(config));
  assert.equal(configureProjectMcp(root, { available: true }).status, "conflict");
  codegraph.args[0] = path.resolve(root, ".mcpee/tools/npm/node_modules/@colbymchenry/codegraph/npm-shim.js");
  codegraph.env.DO_NOT_TRACK = "0";
  fs.writeFileSync(configPath, JSON.stringify(config));
  assert.equal(configureProjectMcp(root, { available: true }).status, "conflict");
});

test("one init extracts brownfield implementation and assertions across arbitrary project roots without manual discovery", () => {
  const root = temporaryProject();
  const files = {
    "package.json": JSON.stringify({ name: "brownfield-onboarding", scripts: { test: "node --test" } }),
    "custom/backend/Infrastructure/AccountService.cs": [
      "public class AccountService {",
      "  public bool Accept(int value) {",
      "    if (value < 8) return false;",
      "    return true;",
      "  }",
      "}",
    ].join("\n"),
    "custom/frontend/modules/accounts/account.ts": [
      "export function accept(value) {",
      "  if (value < 8) throw new Error('too short');",
      "  return true;",
      "}",
    ].join("\n"),
    "custom/frontend/modules/accounts/account.spec.ts": [
      "import { accept } from './account';",
      "  it('accepts a valid account', () => {",
      "    expect(accept(8)).toBe(true);",
      "  });",
    ].join("\n"),
    "custom/python/account.py": "def accept(value):\n    return value >= 8\n",
    "custom/python/test_account.py": "def test_accept():\n    assert accept(8)\n",
    "custom/node/account.js": "exports.accept = function accept(value) {\n return value > 0;\n};\n",
    "custom/react/Account.tsx": "export function Account() {\n return <button onClick={() => save()}>Save</button>;\n}\n",
    "custom/angular/account.component.html": '<form [formGroup]="account" (ngSubmit)="save()"><input formControlName="name" required></form>\n',
    "custom/data/account.sql": "CREATE TABLE Account (id int PRIMARY KEY);\nINSERT INTO Account VALUES (1);\n",
    "custom/scripts/account.ps1": "function Save-Account {\n param([string]$Name)\n Set-Content -Path result.txt -Value $Name\n}\n",
    "custom/scripts/account.Tests.ps1": "It 'accepts the account' {\n Get-Account | Should -Be 8\n}\n",
    "custom/backend/AccountTests.cs": "[Fact]\npublic void Accepts() {\n Assert.Equal(8, Accept(8));\n}\n",
    "custom/infra/main.bicep": "param enabled bool\nresource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = if (enabled) {\n name: 'example'\n}\n",
    "custom/infra/local.bicepparam": "using './main.bicep'\nparam enabled = true\n",
    ".github/workflows/check.yml": "jobs:\n  test:\n    steps:\n      - run: echo check\n",
  };
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  installFakeCodeGraph(root);
  const args = [cli, "init", "--project", root, "--skip-tool-install", "--embeddings", "none"];
  const output = execFileSync(process.execPath, args, { encoding: "utf8" });
  assert.match(output, /Automatic brownfield extraction:/);
  assert.match(output, /No extra discovery command is needed/);
  const latestPath = path.join(root, ".mcpee/specs/latest.json");
  const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  assert.ok(fs.existsSync(path.join(root, latest.index_path)));
  assert.ok(latest.coverage.implementation_recognition.supported.includes("custom/python/account.py"));
  assert.equal(latest.coverage.associated_assertions, 4);
  assert.equal(latest.coverage.source_relationships.status, "available");
  assert.ok(latest.coverage.source_relationships.relationships > 0);
  assert.deepEqual(latest.coverage.language_capabilities.map((item) => item.family).sort(), [
    "angular-template", "bicep", "csharp", "javascript", "pipeline-yaml",
    "powershell", "python", "react", "sql", "typescript",
  ]);
  const evidence = latest.proposals.map((item) =>
    JSON.parse(fs.readFileSync(path.join(root, item.path.replace(/\.md$/, ".evidence.json")), "utf8")));
  const sources = evidence.flatMap((item) => item.sources);
  for (const relative of Object.keys(files)) assert.ok(sources.some((item) => item.path === relative), relative);
  for (const relative of Object.keys(files).filter((item) => item !== "package.json")) {
    assert.ok(sources.find((item) => item.path === relative).facts.some((fact) => fact.kind === "implementation-observation"), relative);
  }
  const backend = sources.find((item) => item.path.endsWith("AccountService.cs"));
  const testSource = sources.find((item) => item.path.endsWith("account.spec.ts"));
  assert.ok(testSource.facts.some((fact) => fact.kind === "source-relationship" &&
    fact.relationship === "tests_source" && fact.target.endsWith("/account.ts")));
  assert.equal(backend.category, "infrastructure");
  assert.ok(backend.facts.some((fact) => fact.observations?.includes("return")));
  assert.ok(evidence.flatMap((item) => item.test_cases).some((item) =>
    item.kind === "implementation-candidate" && item.source.endsWith("AccountService.cs")));
  const editedPath = path.join(root, latest.proposals[0].path);
  fs.appendFileSync(editedPath, "\nOwner review in progress.\n");
  const edited = fs.readFileSync(editedPath, "utf8");
  const repeat = execFileSync(process.execPath, args, { encoding: "utf8" });
  assert.match(repeat, /Automatic brownfield extraction:/);
  assert.equal(fs.readFileSync(editedPath, "utf8"), edited);
  const second = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  assert.deepEqual(second.proposals, latest.proposals);
  assert.equal(second.index_path, latest.index_path);
  const newSource = path.join(root, "custom/frontend/modules/accounts/changed.ts");
  fs.writeFileSync(newSource, "export function changed(value) {\n  if (!value) return false;\n  return true;\n}\n");
  const syncOutput = execFileSync(process.execPath, [cli, "sync", "--project", root], { encoding: "utf8" });
  assert.match(syncOutput, /specification proposals created/);
  const updated = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  assert.notEqual(updated.index_path, second.index_path);
  assert.equal(fs.readFileSync(editedPath, "utf8"), edited);
  assert.ok(updated.proposals.some((item) => {
    const evidence = JSON.parse(fs.readFileSync(path.join(root, item.path.replace(/\.md$/, ".evidence.json")), "utf8"));
    return evidence.sources.some((source) => source.path.endsWith("/changed.ts"));
  }));
  assert.equal(fs.existsSync(path.join(root, "specs/approved")), false);
});

test("greenfield init through reviewed requirements, implementation, real tests and drift is reproducible locally", () => {
  const { listBrownfieldSpecs, prepareApprovedSpecContext, checkSpecDrift } = require("../packages/spec-engine/src/brownfield");
  const root = temporaryProject();
  installFakeCodeGraph(root);
  const invoke = (...args) => execFileSync(process.execPath, [cli, ...args, "--project", root], { encoding: "utf8" });
  const init = invoke("init", "--skip-tool-install", "--embeddings", "none");
  assert.match(init, /Project files configured/);
  const initial = listBrownfieldSpecs(root);
  assert.ok(initial.every((item) => item.status !== "approved"));
  const requirementPath = path.join(root, "requirements.md");
  fs.writeFileSync(requirementPath, "# Invoice requirement\n\nReturn the sum of nonnegative invoice lines. Reject negative values without side effects.\n");
  invoke("sync");
  const latestPath = path.join(root, ".mcpee/specs/latest.json");
  const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  const proposal = latest.proposals.find((item) => {
    const evidence = JSON.parse(fs.readFileSync(path.join(root, item.path.replace(/\.md$/, ".evidence.json")), "utf8"));
    return evidence.sources.some((source) => source.path === "requirements.md");
  });
  assert.ok(proposal);
  const filename = path.join(root, proposal.path);
  const reviewed = fs.readFileSync(filename, "utf8")
    .replace("<!-- Replace this prompt with behavior confirmed by the accountable owner. -->",
      "Sum nonnegative invoice lines. Reject negative values without side effects. Source: requirements.md.")
    .replace("<!-- Add observable, testable criteria and link each criterion to evidence. -->",
      "Given [2, 3], return 5. Given [-1], throw RangeError. Source: requirements.md.");
  fs.writeFileSync(filename, reviewed);
  const digest = crypto.createHash("sha256").update(reviewed).digest("hex");
  invoke("specs", "ratify", "--slug", proposal.slug, "--reviewer", "Local acceptance fixture owner", "--confirm-sha256", digest);
  const approved = listBrownfieldSpecs(root).find((item) => item.status === "approved");
  assert.ok(approved);
  const approvedPath = path.join(root, approved.path);
  const contract = fs.readFileSync(approvedPath, "utf8");
  const plan = routeTask(root, "Implement invoice totals");
  assert.ok(plan.approved_specs.some((item) => item.path === approved.path));
  const context = prepareApprovedSpecContext(root, plan);
  assert.match(context.content, /Given \[2, 3\], return 5/);
  fs.writeFileSync(path.join(root, "invoice.js"), [
    "exports.total = (lines) => {",
    '  if (lines.some((value) => value < 0)) throw new RangeError("negative invoice");',
    "  return lines.reduce((sum, value) => sum + value, 0);",
    "};",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "invoice.test.js"), [
    'const { test } = require("node:test");',
    'const assert = require("node:assert/strict");',
    'const { total } = require("./invoice");',
    'test("sums nonnegative lines", () => assert.equal(total([2, 3]), 5));',
    'test("rejects negative lines without mutating input", () => {',
    "  const lines = [-1];",
    "  assert.throws(() => total(lines), RangeError);",
    "  assert.deepEqual(lines, [-1]);",
    "});",
  ].join("\n"));
  const testEnvironment = { ...process.env };
  delete testEnvironment.NODE_TEST_CONTEXT;
  const tests = execFileSync(process.execPath, ["--test", path.join(root, "invoice.test.js")], {
    encoding: "utf8", env: testEnvironment,
  });
  assert.match(tests, /(?:pass 2|# pass 2)/);
  invoke("sync");
  assert.equal(fs.readFileSync(approvedPath, "utf8"), contract);
  assert.equal(checkSpecDrift(root).specifications.find((item) => item.specPath === approved.path).drift_status, "current");
  fs.appendFileSync(requirementPath, "\nA future change proposes rounding; approval is pending.\n");
  invoke("sync");
  assert.equal(fs.readFileSync(approvedPath, "utf8"), contract);
  assert.equal(checkSpecDrift(root).specifications.find((item) => item.specPath === approved.path).drift_status, "drifted");
});

test("business and architecture Office sources retain their domain category and require document extraction", () => {
  const root = temporaryProject();
  initializeProject(root);
  for (const category of ["business", "architecture"]) {
    fs.writeFileSync(path.join(root, `knowledge/sources/${category}/requirements.docx`), Buffer.from([0x50, 0x4b, 0, 0, 1]));
  }
  const result = syncProject(root, { tools: [], graphify: { installed: false } });
  const documents = result.sources.filter((source) => source.path.endsWith("requirements.docx"));
  assert.equal(documents.length, 2);
  for (const source of documents) {
    assert.ok(["business", "architecture"].includes(source.category));
    assert.equal(source.processor, "office-documents");
    assert.equal(source.status, "requires-tool");
    assert.equal(source.required_tool, "markitdown");
  }
});

test("CLI supports init, doctor, tools, captured traces, memory, observe, knowledge search, and sync", () => {
  const root = temporaryProject();
  fs.writeFileSync(path.join(root, "README.md"), "# Temporary project\n\nThis local source should be indexed during initialization.\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "temporary-project",
    dependencies: { express: "^5.0.0" },
    scripts: { test: "node --version", lint: "node --version" },
  }));
  installFakeCodeGraph(root);
  const initOutput = execFileSync(process.execPath, [cli, "init", "--project", root, "--skip-tool-install"], { encoding: "utf8" });
  assert.match(initOutput, /Discovered \d+\/\d+ catalogued local tools/);
  assert.match(initOutput, /Initial local sync: \d+ source\(s\)/);
  assert.match(initOutput, /CodeGraph init completed/);
  assert.ok(fs.existsSync(path.join(root, ".mcpee/state/tools.json")));
  assert.ok(fs.existsSync(path.join(root, ".mcpee/indexes/knowledge-index.json")));
  assert.match(initOutput, /Workflow validation: generated=\d+, preserved=0, checks=npm:npm-test, npm:npm-lint/);
  const workflowSpec = JSON.parse(fs.readFileSync(
    path.join(root, ".mcpee/workflows/resolve-bug.json"),
    "utf8",
  ));
  assert.equal(workflowSpec.workflow_id, "resolve-bug");
  assert.deepEqual(workflowSpec.steps.map((step) => step.args), [
    ["run", "test"],
    ["run", "lint"],
  ]);
  assert.ok(fs.existsSync(path.join(root, GRAPH_PATH)));
  assert.ok(fs.existsSync(path.join(root, ".mcp.json")));
  assert.ok(fs.existsSync(path.join(root, "docs/generated/project-overview.md")));
  assert.ok(fs.existsSync(path.join(root, "knowledge/traceability/source-manifest.json")));
  fs.writeFileSync(path.join(root, ".mcpee/workflows/verify-node.json"), `${JSON.stringify({
    workflow_id: "verify-node",
    task: "Verify the project Node runtime",
    evidence: ["README.md"],
    steps: [{ id: "node-version", label: "Node version", tool: "node", args: ["--version"] }],
  }, null, 2)}\n`);
  const workflowOutput = execFileSync(process.execPath, [
    cli, "workflow", "run", "--project", root, "--spec", ".mcpee/workflows/verify-node.json",
  ], { encoding: "utf8" });
  assert.match(workflowOutput, /Workflow verify-node: passed/);
  assert.match(workflowOutput, /Impact preflight: ready/);
  assert.ok(workflowOutput.indexOf("Impact preflight: ready") < workflowOutput.indexOf("Workflow verify-node: passed"));
  execFileSync(process.execPath, [cli, "doctor", "--project", root], { encoding: "utf8" });
  const route = execFileSync(process.execPath, [
    cli, "route", "--project", root, "--task", "Fix a failing backend test", "--json",
  ], { encoding: "utf8" });
  const routePlan = JSON.parse(route);
  assert.equal(routePlan.workflow.id, "resolve-bug");
  assert.equal(routePlan.knowledge_graph[0].symbol, "handleRequest");
  assert.ok(routePlan.technical_guidance.some((item) => item.id === "node-engineering"));
  assert.ok(!routePlan.technical_guidance.some((item) => item.id === "dotnet-csharp"));
  assert.ok(routePlan.scorecards.some((item) => item.id === "engineering-response-quality"));
  const explanation = execFileSync(process.execPath, [
    cli, "explain", "--project", root, "--json",
  ], { encoding: "utf8" });
  const explained = JSON.parse(explanation);
  assert.ok(explained.catalog.agents.length > 0);
  assert.ok(explained.catalog.patterns.length > 0);
  assert.ok(explained.catalog.playbooks.some((playbook) => playbook.id === "migration-strategy"));
  assert.ok(explained.catalog.templates.length > 0);
  assert.ok(explained.catalog.technical_guidance.some((item) => item.id === "azure-engineering"));
  assert.ok(explained.catalog.scorecards.some((item) => item.id === "engineering-response-quality"));
  assert.ok(explained.catalog.eval_cases.some((item) => item.id === "evidence-grounding"));
  assert.ok(explained.catalog.prompt_examples.some((item) => item.id === "backend-change-example"));
  assert.ok(explained.catalog.policies.some((policy) =>
    policy.id === "human-in-the-loop" && policy.enforcement === "runtime" && policy.evidence));
  assert.ok(explained.catalog.tool_capabilities.some((capability) => capability.id === "test-runners"));
  assert.match(explained.execution.approval_hook, /installed/);
  assert.ok(explained.execution.flow.some((stage) => /impact preflight/.test(stage)));
  assert.ok(explained.execution.enforcement_limits.some((limit) => /does not enforce naming/.test(limit)));
  assert.match(explained.execution.chat_integration, /mcpee_run MCP tool/);
  assert.match(explained.execution.run, /grounded context is the default/);
  const cacheFile = path.join(root, ".mcpee/cache/temporary/cache.json");
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, "{}");
  const cleanAttempt = spawnSync(process.execPath, [cli, "clean", "--project", root], { encoding: "utf8" });
  assert.equal(cleanAttempt.status, 1);
  assert.ok(fs.existsSync(cacheFile));
  const updateAttempt = spawnSync(process.execPath, [cli, "update", "--project", root], { encoding: "utf8" });
  assert.equal(updateAttempt.status, 1);
  const rebuildAttempt = spawnSync(process.execPath, [cli, "rebuild", "--project", root], { encoding: "utf8" });
  assert.equal(rebuildAttempt.status, 1);
  const runAttempt = spawnSync(process.execPath, [
    cli, "run", "--project", root, "--task", "Inspect the project configuration",
  ], { encoding: "utf8" });
  assert.equal(runAttempt.status, 1);
  assert.match(runAttempt.stderr, /non-interactive approval is denied/);
  assert.match(runAttempt.stdout, /Impact preflight:/);
  const transferApproval = readEvents(root).find((event) =>
    event.event_name === "copilot.data_transfer.approval");
  assert.equal(transferApproval.attributes.decision, "denied");
  assert.equal(transferApproval.attributes.workflow, "understand-project");
  assert.equal(typeof transferApproval.attributes.duration_ms, "number");
  const discoveredTools = execFileSync(process.execPath, [cli, "tools", "list", "--project", root], {
    encoding: "utf8",
  });
  assert.match(discoveredTools, /node: not-run/);
  const toolOutput = execFileSync(process.execPath, [cli, "tools", "validate", "--project", root, "--tool", "node"], {
    encoding: "utf8",
  });
  assert.match(toolOutput, /node: passed/);

  const hook = path.join(root, ".mcpee/runtime/copilot-hook.cjs");
  execFileSync(process.execPath, [hook, "postToolUse"], {
    cwd: root,
    input: JSON.stringify({ sessionId: "cli-session", toolName: "node", toolCallId: "call-1" }),
  });
  const trace = execFileSync(process.execPath, [cli, "trace", "--project", root, "--session", "cli-session", "--json"], {
    encoding: "utf8",
  });
  assert.equal(JSON.parse(trace)[0].tool_name, "node");

  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/decision.md"), "# Decision\nKeep telemetry local.\n");
  execFileSync(process.execPath, [
    cli, "memory", "add", "--project", root, "--kind", "decision",
    "--text", "Keep telemetry local", "--source", "docs/decision.md",
  ], { encoding: "utf8" });
  const memories = execFileSync(process.execPath, [cli, "memory", "list", "--project", root], {
    encoding: "utf8",
  });
  assert.match(memories, /Keep telemetry local/);
  const memoryMatches = execFileSync(process.execPath, [
    cli, "memory", "search", "--project", root, "--query", "telemetry local",
  ], { encoding: "utf8" });
  assert.match(memoryMatches, /"status": "current"/);

  const observation = execFileSync(process.execPath, [cli, "observe", "--project", root, "--json"], {
    encoding: "utf8",
  });
  assert.ok(JSON.parse(observation).event_count >= 2);
  fs.mkdirSync(path.join(root, "knowledge/sources/technical"), { recursive: true });
  fs.writeFileSync(path.join(root, "knowledge/sources/technical/design.md"), "# Local architecture\nSource traceability matters.\n");
  execFileSync(process.execPath, [cli, "sync", "--project", root], { encoding: "utf8" });
  assert.ok(fs.existsSync(path.join(root, ".mcpee/indexes/source-inventory.json")));
  const vectorSearch = execFileSync(process.execPath, [
    cli, "knowledge", "search", "--project", root, "--query", "source traceability", "--mode", "vector", "--json",
  ], { encoding: "utf8" });
  assert.equal(JSON.parse(vectorSearch)[0].source_path, "knowledge/sources/technical/design.md");
  const context = execFileSync(process.execPath, [
    cli, "knowledge", "context", "--project", root, "--query", "source traceability",
    "--max-tokens", "512",
  ], { encoding: "utf8" });
  assert.match(context, /Grounded local context/);
  assert.match(context, /knowledge\/sources\/technical\/design\.md/);
  assert.match(context, /sha256 [a-f0-9]{64}/);
  const graphSearch = execFileSync(process.execPath, [
    cli, "knowledge", "graph", "--project", root, "--query", "request handler", "--json",
  ], { encoding: "utf8" });
  const graphMatches = JSON.parse(graphSearch);
  assert.ok(graphMatches.length <= 10);
  assert.equal(graphMatches[0].source_path, "src/app.js");
  const unifiedGraphSearch = execFileSync(process.execPath, [
    cli, "knowledge", "graph", "--project", root, "--query", "local architecture", "--json",
  ], { encoding: "utf8" });
  assert.ok(JSON.parse(unifiedGraphSearch).some((match) => match.graph === "unified"));
  const invalidGraphLimit = spawnSync(process.execPath, [
    cli, "knowledge", "graph", "--project", root, "--query", "request handler", "--limit", "101",
  ], { encoding: "utf8" });
  assert.equal(invalidGraphLimit.status, 2);
  assert.match(invalidGraphLimit.stderr, /between 1 and 100/);
  const search = execFileSync(process.execPath, [
    cli, "knowledge", "search", "--project", root, "--query", "source traceability", "--json",
  ], { encoding: "utf8" });
  assert.ok(JSON.parse(search).some((result) => result.source_path === "knowledge/sources/technical/design.md"));
  execFileSync(process.execPath, [cli, "doctor", "--project", root], { encoding: "utf8" });
});
