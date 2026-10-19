#!/usr/bin/env node
// MCPEE-MANAGED-RUNTIME v1
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const statePath = path.join(projectRoot, ".mcpee", "state", "mcp-server.json");

try {
  if (fs.lstatSync(statePath).isSymbolicLink()) {
    throw new Error(`Refusing to read MCPEE MCP state through symbolic link: ${statePath}`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (state.generated_by !== "mcpee" || typeof state.package_root !== "string" ||
      !path.isAbsolute(state.package_root)) {
    throw new Error(`Invalid MCPEE MCP runtime state: ${statePath}`);
  }
  const serverEntry = path.join(state.package_root, "packages", "mcp-server", "src", "server.js");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`MCPEE MCP server package is unavailable at ${serverEntry}; rerun mcpee init from the installed package.`);
  }
  require(serverEntry).startMcpServer({
    projectRoot,
    packageRoot: state.package_root,
  }).catch((error) => {
    process.stderr.write(`[mcpee] MCP server failed: ${error.message}\n`);
    process.exitCode = 1;
  });
} catch (error) {
  process.stderr.write(`[mcpee] MCP server failed: ${error.message}\n`);
  process.exitCode = 1;
}
