"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { recordEvent } = require("./telemetry");
const { createInitialCapabilityState, renderCatalog } = require("../../copilot-renderer/src/render");

const PROJECT_DIRECTORIES = [
  ".github/agents",
  ".github/instructions",
  ".github/skills",
  ".mcpee/generated",
  ".mcpee/state",
  ".mcpee/cache",
  ".mcpee/indexes",
  ".mcpee/graphs",
  ".mcpee/graphs/unified",
  ".mcpee/memory",
  ".mcpee/telemetry/events",
  ".mcpee/telemetry/traces",
  ".mcpee/observability/runtime",
  ".mcpee/learning",
  ".mcpee/logs",
  ".mcpee/reports",
  ".mcpee/reports/evaluations",
  ".mcpee/reports/workflows",
  ".mcpee/reports/runs",
  ".mcpee/workflows",
  ".mcpee/tasks",
  ".mcpee/tools",
  "knowledge/sources/business",
  "knowledge/sources/technical",
  "knowledge/sources/architecture",
  "knowledge/sources/infrastructure",
  "knowledge/sources/data",
  "knowledge/sources/operations",
  "knowledge/sources/external",
  "knowledge/normalized",
  "knowledge/extracted",
  "knowledge/traceability",
  "knowledge/generated",
  "docs/generated",
];

const PROJECT_FILES = [
  ["mcpee.config.yml", (name) => `version: 1

project:
  name: ${JSON.stringify(name)}
  root: .

host:
  provider: github-copilot

knowledge:
  sourceRoots:
    - .
    - knowledge/sources
  ignore:
    - node_modules
    - bin
    - obj
    - dist
    - coverage
    - .git
    - .mcpee/cache

sync:
  incremental: true

integrations:
  mcp: auto
`],
  [".github/copilot-instructions.md", () => `# MCPEE project instructions

Use the project's verified sources and local knowledge before making assumptions.
Prefer the smallest relevant context, use local tools first, and cite evidence for
important conclusions. Before changing code, assess impact; validate each change
and update affected technical documentation. Never report a tool action or
validation as successful unless it actually completed.

When the project-scoped mcpee-codegraph MCP server is available, use its
codegraph_explore, codegraph_search, and codegraph_impact tools for source-level
discovery and change-impact evidence. Run mcpee sync after source changes to
refresh the local graph and lexical knowledge index.

For every engineering request about this project, use the project-scoped
mcpee_run MCP tool in ordinary Copilot Chat. It routes the task through MCPEE
and the Copilot CLI agent runtime; do not require the user to invoke a special
chat participant or repeat the same work in Chat.

Human approval is required before any file write or other action that changes
project/system state, affects permissions, deploys, publishes, deletes data, or
sends project data externally. If the exact target and consequence are not
clearly authorized by the user's request, explain the impact and ask first.
Read-only inspection and verified local checks may proceed without approval.
Never treat an agent plan, a TODO, a passing evaluation, or a prior approval for
a different action as authorization.

MCPEE records supported Copilot hook events locally. Do not copy credentials or
personal data into project memory or committed artifacts.
`],
  [".mcpee/runtime/approval-policy.cjs", () => fs.readFileSync(
    path.resolve(__dirname, "approval.js"),
    "utf8",
  ).replace(/^/, "// MCPEE-MANAGED-RUNTIME v1\n")],
  [".github/hooks/mcpee-observability.json", () => JSON.stringify({
    version: 1,
    hooks: Object.fromEntries([
      "sessionStart",
      "sessionEnd",
      "userPromptSubmitted",
      "preToolUse",
      "postToolUse",
      "errorOccurred",
      "agentStop",
    ].map((event) => [event, [{
      type: "command",
      command: `node .mcpee/runtime/copilot-hook.cjs ${event}`,
      cwd: ".",
      timeoutSec: 10,
    }]])),
  }, null, 2) + "\n"],
  [".mcpee/runtime/copilot-hook.cjs", () => fs.readFileSync(
    path.resolve(__dirname, "../../../templates/project/copilot-hook.cjs"),
    "utf8",
  )],
  [".mcpee/runtime/mcp-server.cjs", () => fs.readFileSync(
    path.resolve(__dirname, "../../../templates/project/mcp-server.cjs"),
    "utf8",
  )],
  [".mcpee/.gitignore", () => [
    "/cache/",
    "/tools/",
    "/state/tools.json",
    "/state/embeddings.json",
    "/state/mcp-server.json",
    "/reports/evaluations/",
    "/reports/workflows/",
    "/reports/runs/",
    "/tasks/",
    "/learning/proposals.jsonl",
    "/indexes/",
    "/graphs/",
    "/specs/",
    "/telemetry/events/",
    "/telemetry/traces/",
    "/observability/runtime/",
    "/logs/",
    "",
  ].join("\n")],
];

function writeIfMissing(root, relativePath, content, options = {}) {
  const destination = path.join(root, relativePath);
  if (fs.existsSync(destination)) {
    const existing = fs.readFileSync(destination, "utf8");
    if (relativePath.startsWith(".mcpee/runtime/") &&
        content.includes("MCPEE-MANAGED-RUNTIME") &&
        (existing.includes("MCPEE-MANAGED-RUNTIME") || options.refreshRuntime === true) &&
        existing !== content) {
      fs.writeFileSync(destination, content, "utf8");
      return "updated";
    }
    return "preserved";
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content, "utf8");
  return "created";
}

function approvalHookInstalled(projectRoot) {
  const configPath = path.join(projectRoot, ".github/hooks/mcpee-observability.json");
  if (!fs.existsSync(configPath)) return false;
  if (fs.lstatSync(configPath).isSymbolicLink()) {
    throw new Error(`Refusing to inspect Copilot hook configuration through symbolic link: ${configPath}`);
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot inspect Copilot hook configuration: ${error.message}`);
  }
  const hooks = config?.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error("Copilot hook configuration must contain a hooks object");
  }
  const registrations = hooks.preToolUse;
  if (registrations === undefined) return false;
  if (!Array.isArray(registrations)) {
    throw new Error("Copilot preToolUse hooks must be an array");
  }
  return registrations.some((hook) =>
    hook?.type === "command" &&
    typeof hook.command === "string" &&
    hook.command.includes(".mcpee/runtime/copilot-hook.cjs preToolUse"));
}

function addApprovalHook(projectRoot) {
  if (approvalHookInstalled(projectRoot)) return false;
  const configPath = path.join(projectRoot, ".github/hooks/mcpee-observability.json");
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot update Copilot hook configuration: ${error.message}`);
  }
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
    throw new Error("Cannot add approval hook: Copilot hook configuration must contain a hooks object");
  }
  config.hooks.preToolUse ||= [];
  if (!Array.isArray(config.hooks.preToolUse)) {
    throw new Error("Cannot add approval hook: preToolUse must be an array");
  }
  config.hooks.preToolUse.push({
    type: "command",
    command: "node .mcpee/runtime/copilot-hook.cjs preToolUse",
    cwd: ".",
    timeoutSec: 10,
  });
  if (fs.lstatSync(configPath).isSymbolicLink()) {
    throw new Error(`Refusing to update Copilot hook configuration through symbolic link: ${configPath}`);
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return true;
}

function ensureRuntimeIgnoreRules(projectRoot) {
  const relativePath = ".mcpee/.gitignore";
  const destination = path.join(projectRoot, relativePath);
  const required = [
    "/cache/",
    "/tools/",
    "/state/tools.json",
    "/state/embeddings.json",
    "/reports/evaluations/",
    "/reports/workflows/",
    "/reports/runs/",
    "/tasks/",
    "/learning/proposals.jsonl",
    "/indexes/",
    "/graphs/",
    "/specs/",
    "/telemetry/events/",
    "/telemetry/traces/",
    "/observability/runtime/",
    "/logs/",
  ];
  const existing = fs.readFileSync(destination, "utf8");
  const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = required.filter((rule) => !lines.has(rule));
  if (missing.length === 0) return false;
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(destination, `${separator}${missing.join("\n")}\n`, "utf8");
  return true;
}

function initializeProject(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  fs.mkdirSync(root, { recursive: true });
  const created = [];
  const preserved = [];
  const updated = [];
  for (const relative of PROJECT_DIRECTORIES) {
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
      created.push(relative);
    }
  }
  const projectName = path.basename(root) || "project";
  for (const [relative, contentFactory] of PROJECT_FILES) {
    const result = writeIfMissing(root, relative, contentFactory(projectName), options);
    if (result === "preserved") preserved.push(relative);
    else if (result === "updated") updated.push(relative);
    else created.push(relative);
  }
  if (options.refreshApprovalHook && addApprovalHook(root)) {
    updated.push(".github/hooks/mcpee-observability.json (preToolUse approval hook added)");
  }
  if (ensureRuntimeIgnoreRules(root)) {
    created.push(".mcpee/.gitignore (runtime exclusions added)");
  }
  const statePath = path.join(root, ".mcpee/state/project.json");
  if (!fs.existsSync(statePath)) {
    const state = {
      schema_version: 1,
      generated_by: "mcpee",
      project_name: projectName,
      initialized_at: new Date().toISOString(),
      platform_version: require("../../../package.json").version,
    };
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    created.push(".mcpee/state/project.json");
  } else {
    preserved.push(".mcpee/state/project.json");
  }
  const mcpStatePath = path.join(root, ".mcpee/state/mcp-server.json");
  if (fs.existsSync(mcpStatePath) && fs.lstatSync(mcpStatePath).isSymbolicLink()) {
    throw new Error(`Refusing to update MCPEE MCP state through symbolic link: ${mcpStatePath}`);
  }
  const mcpState = {
    generated_by: "mcpee",
    package_root: path.resolve(options.packageRoot || path.resolve(__dirname, "../../..")),
  };
  if (fs.existsSync(mcpStatePath)) {
    let existingMcpState;
    try {
      existingMcpState = JSON.parse(fs.readFileSync(mcpStatePath, "utf8"));
    } catch (error) {
      throw new Error(`Cannot read MCPEE MCP state: ${error.message}`);
    }
    if (existingMcpState.generated_by !== "mcpee") {
      throw new Error(`Refusing to overwrite user-owned MCPEE MCP state: ${mcpStatePath}`);
    }
    if (existingMcpState.package_root !== mcpState.package_root) {
      fs.writeFileSync(mcpStatePath, `${JSON.stringify(mcpState, null, 2)}\n`, "utf8");
      updated.push(".mcpee/state/mcp-server.json");
    } else {
      preserved.push(".mcpee/state/mcp-server.json");
    }
  } else {
    fs.writeFileSync(mcpStatePath, `${JSON.stringify(mcpState, null, 2)}\n`, "utf8");
    created.push(".mcpee/state/mcp-server.json");
  }
  const catalog = renderCatalog(root, {
    ...(options.initialAgents ? { capabilityState: createInitialCapabilityState(options.initialAgents) } : {}),
  });
  for (const [status, count] of Object.entries(catalog.counts)) {
    if (count > 0) created.push(`catalog ${status}: ${count}`);
  }
  recordEvent(root, {
    event_name: "project.initialized",
    attributes: {
      created_paths: created.length,
      updated_paths: updated.length,
      preserved_paths: preserved.length + catalog.counts.preserved,
      catalog_sha256: catalog.catalog_sha256,
    },
  });
  return { created, preserved, updated, catalog };
}

module.exports = { initializeProject, PROJECT_DIRECTORIES, approvalHookInstalled };
