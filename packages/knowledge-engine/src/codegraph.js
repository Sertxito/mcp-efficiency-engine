"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { invokeTool } = require("../../tool-manager/src/tools");
const { recordEvent } = require("../../core/src/telemetry");

const STATE_FILE = ".mcpee/state/codegraph.json";
const MCP_CONFIG_FILE = ".mcp.json";
const GRAPH_DIRECTORY = ".codegraph";
const SERVER_NAME = "mcpee-codegraph";
const CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
const CODEGRAPH_ENV = {
  CODEGRAPH_NO_DOWNLOAD: "1",
  CODEGRAPH_NO_UPDATE_CHECK: "1",
  DO_NOT_TRACK: "1",
};

function assertNoSymlink(root, relativePath) {
  let current = root;
  for (const part of relativePath.split(/[\\/]/).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to access MCPEE CodeGraph path through symbolic link: ${current}`);
    }
  }
}

function codeGraphEnvironment(root) {
  return {
    ...CODEGRAPH_ENV,
    CODEGRAPH_DIR: GRAPH_DIRECTORY,
  };
}

function readState(root) {
  const statePath = path.join(root, STATE_FILE);
  assertNoSymlink(root, STATE_FILE);
  if (!fs.existsSync(statePath)) return null;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read MCPEE CodeGraph state: ${error.message}`);
  }
  if (state.generated_by !== "mcpee") {
    throw new Error(`Refusing to update non-MCPEE CodeGraph state: ${statePath}`);
  }
  return state;
}

function writeState(root, state) {
  assertNoSymlink(root, ".mcpee");
  assertNoSymlink(root, ".mcpee/state");
  const statePath = path.join(root, STATE_FILE);
  const current = readState(root);
  if (current && current.generated_by !== "mcpee") {
    throw new Error(`Refusing to overwrite non-MCPEE CodeGraph state: ${statePath}`);
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ generated_by: "mcpee", ...state }, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, statePath);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

function serverConfiguration() {
  return {
    type: "stdio",
    command: "node",
    args: [
      `./.mcpee/tools/npm/node_modules/${CODEGRAPH_PACKAGE}/npm-shim.js`,
      "serve",
      "--mcp",
      "--path",
      ".",
      "--no-watch",
    ],
    env: {
      ...CODEGRAPH_ENV,
      CODEGRAPH_DIR: GRAPH_DIRECTORY,
    },
  };
}

function mcpeeServerConfiguration() {
  return {
    type: "stdio",
    command: "node",
    args: ["./.mcpee/runtime/mcp-server.cjs"],
  };
}

function sameServerConfiguration(root, name, current, desired) {
  if (!current || typeof current !== "object" || Array.isArray(current)) return false;
  const normalize = (server) => {
    const result = { ...server };
    if (result.type === "stdio") delete result.type;
    delete result.tools;
    if (Array.isArray(result.args)) {
      const pathIndexes = name === SERVER_NAME ? [0, 4] : [0];
      result.args = result.args.map((arg, index) =>
        pathIndexes.includes(index) && typeof arg === "string"
          ? path.resolve(root, arg.replace(/[\\/]/g, path.sep))
          : arg);
    }
    if (result.env) {
      result.env = { ...result.env };
      if (typeof result.env.CODEGRAPH_DIR === "string") {
        result.env.CODEGRAPH_DIR = path.resolve(root, result.env.CODEGRAPH_DIR.replace(/[\\/]/g, path.sep));
      }
    }
    return result;
  };
  return isDeepStrictEqual(normalize(current), normalize(desired));
}

function configureProjectMcp(projectRoot, options = {}) {
  if (!options.available) return { status: "unavailable" };
  const root = path.resolve(projectRoot);
  assertNoSymlink(root, MCP_CONFIG_FILE);
  const configPath = path.join(root, MCP_CONFIG_FILE);
  let config = { mcpServers: {} };
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      return {
        status: "failed",
        error: `Cannot safely merge project MCP config ${configPath}: ${error.message}`,
      };
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return { status: "failed", error: `Project MCP config must contain a JSON object: ${configPath}` };
    }
  }
  if (config.mcpServers !== undefined &&
      (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))) {
    return { status: "failed", error: `The "mcpServers" value must be an object in ${configPath}` };
  }
  config.mcpServers ||= {};
  const desiredServers = {
    [SERVER_NAME]: serverConfiguration(),
    mcpee: mcpeeServerConfiguration(),
  };
  let configured = false;
  let conflicts = [];
  for (const [name, desired] of Object.entries(desiredServers)) {
    if (config.mcpServers[name]) {
      if (!sameServerConfiguration(root, name, config.mcpServers[name], desired)) {
        conflicts.push(name);
      }
      continue;
    }
    config.mcpServers[name] = desired;
    configured = true;
  }
  if (!configured && conflicts.length === 0) {
    return { status: "unchanged", file: MCP_CONFIG_FILE };
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (configured) {
    const temporary = `${configPath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      fs.renameSync(temporary, configPath);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw error;
    }
  }
  if (conflicts.length > 0) {
    return {
      status: "conflict",
      file: MCP_CONFIG_FILE,
      error: `Existing user-owned MCP server configuration was preserved: ${conflicts.join(", ")}.`,
    };
  }
  return { status: "configured", file: MCP_CONFIG_FILE };
}

function invokeCodeGraph(root, args, timeoutMs) {
  return invokeTool(root, "codegraph", args, {
    cwd: ".",
    env: codeGraphEnvironment(root),
    timeoutMs,
  });
}

function requireSuccess(result, action) {
  if (result.status !== "success") {
    const details = result.error || result.stderr?.trim() || `exit code ${result.exit_code}`;
    throw new Error(`CodeGraph ${action} failed: ${details}`);
  }
}

function getCodeGraphStatus(root) {
  const result = invokeCodeGraph(root, ["status", root, "--json"], 30_000);
  requireSuccess(result, "status check");
  let status;
  try {
    status = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`CodeGraph returned invalid status JSON: ${error.message}`);
  }
  if (typeof status.initialized !== "boolean") {
    throw new Error("CodeGraph status did not include an initialized flag.");
  }
  return status;
}

function statusSummary(status) {
  return {
    initialized: status.initialized,
    version: status.version || null,
    last_indexed: status.lastIndexed || null,
    file_count: status.fileCount ?? status.stats?.fileCount ?? null,
    node_count: status.nodeCount ?? status.stats?.nodeCount ?? null,
    edge_count: status.edgeCount ?? status.stats?.edgeCount ?? null,
  };
}

function searchCodeGraph(projectRoot, query, limit = 10) {
  const root = path.resolve(projectRoot);
  const state = readState(root);
  if (state?.status !== "ready") {
    throw new Error("CodeGraph index is not ready. Run mcpee init or mcpee sync first.");
  }
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error("CodeGraph search query must not be empty.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("CodeGraph search limit must be an integer between 1 and 100.");
  }
  const result = invokeCodeGraph(root, [
    "query",
    query.trim(),
    "--path",
    root,
    "--limit",
    String(limit),
    "--json",
  ], 30_000);
  requireSuccess(result, "query");
  let matches;
  try {
    matches = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`CodeGraph returned invalid query JSON: ${error.message}`);
  }
  if (!Array.isArray(matches)) {
    throw new Error("CodeGraph query result must be a JSON array.");
  }
  return matches.map((match) => {
    const node = match?.node;
    if (!node || typeof node.filePath !== "string" || typeof node.name !== "string") {
      throw new Error("CodeGraph query returned a result without a symbol name and source path.");
    }
    const absoluteSource = path.resolve(root, node.filePath);
    const relativeSource = path.relative(root, absoluteSource);
    if (relativeSource === ".." || relativeSource.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeSource)) {
      throw new Error(`CodeGraph query returned a source outside the project: ${node.filePath}`);
    }
    return {
      source_path: relativeSource.split(path.sep).join("/"),
      symbol: node.name,
      symbol_kind: node.kind || null,
      start_line: node.startLine ?? null,
      score: match.score ?? null,
    };
  });
}

function updateCodeGraph(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const mcp = configureProjectMcp(root, { available: options.available });
  if (mcp.status === "failed" || mcp.status === "conflict") {
    throw new Error(mcp.error);
  }
  if (!options.available) {
    return {
      status: options.required ? "failed" : "unavailable",
      operation: "skipped",
      error: options.required ? "CodeGraph is required but its project-local installation is unavailable." : undefined,
      mcp,
    };
  }

  const previous = readState(root);
  let operation = previous?.operation || "init";
  try {
    const currentStatus = getCodeGraphStatus(root);
    operation = currentStatus.initialized ? "sync" : "init";
    const args = operation === "init"
      ? ["init", root, "--yes"]
      : ["sync", root, "--quiet"];
    requireSuccess(invokeCodeGraph(root, args, options.timeoutMs || 900_000), operation);

    const status = getCodeGraphStatus(root);
    if (!status.initialized) {
      throw new Error(`CodeGraph ${operation} completed without creating an initialized index.`);
    }
    const summary = statusSummary(status);
    writeState(root, {
      schema_version: 1,
      status: "ready",
      operation,
      updated_at: new Date().toISOString(),
      graph_directory: GRAPH_DIRECTORY,
      mcp_server: SERVER_NAME,
      summary,
      error: null,
    });
    const result = { status: "ready", operation, summary, mcp };
    recordEvent(root, {
      event_name: "knowledge.codegraph.completed",
      attributes: {
        operation,
        status: result.status,
        file_count: summary.file_count,
        node_count: summary.node_count,
        edge_count: summary.edge_count,
      },
    });
    return result;
  } catch (error) {
    const failure = {
      schema_version: 1,
      status: "failed",
      operation,
      updated_at: new Date().toISOString(),
      graph_directory: GRAPH_DIRECTORY,
      mcp_server: SERVER_NAME,
      summary: previous?.summary || null,
      error: error.message,
    };
    writeState(root, failure);
    recordEvent(root, {
      event_name: "knowledge.codegraph.completed",
      attributes: { operation: failure.operation, status: "failed" },
    });
    return { status: "failed", operation: failure.operation, error: error.message, mcp };
  }
}

module.exports = {
  configureProjectMcp,
  readCodeGraphState: readState,
  searchCodeGraph,
  updateCodeGraph,
};
