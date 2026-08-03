const fs = require("node:fs");
const path = require("node:path");

const PROJECT_STORE_DIRS = [
  ".mcpee",
  ".mcpee/knowledge",
  ".mcpee/knowledge/raw",
  ".mcpee/knowledge/markdown",
  ".mcpee/knowledge/graph",
  ".mcpee/knowledge/index",
  ".mcpee/memory",
  ".mcpee/telemetry",
  ".mcpee/traces",
  ".mcpee/generated-skills",
  ".mcpee/overrides",
  ".mcpee/artifacts",
  ".mcpee/artifacts/generated-documents",
  ".mcpee/artifacts/adr",
  ".mcpee/artifacts/plans",
  ".mcpee/artifacts/reports",
  ".mcpee/cache",
  ".mcpee/reports",
];

function initProjectStore(workspaceRoot) {
  const created = [];
  for (const relativeDir of PROJECT_STORE_DIRS) {
    const absoluteDir = path.join(workspaceRoot, relativeDir);
    if (!fs.existsSync(absoluteDir)) {
      fs.mkdirSync(absoluteDir, { recursive: true });
      created.push(relativeDir);
    }
  }

  return {
    created,
    root: path.join(workspaceRoot, ".mcpee"),
  };
}

function getProjectStoreStatus(workspaceRoot) {
  const checks = PROJECT_STORE_DIRS.map((relativeDir) => ({
    path: relativeDir,
    exists: fs.existsSync(path.join(workspaceRoot, relativeDir)),
  }));

  return {
    rootExists: fs.existsSync(path.join(workspaceRoot, ".mcpee")),
    checks,
  };
}

module.exports = {
  PROJECT_STORE_DIRS,
  initProjectStore,
  getProjectStoreStatus,
};
