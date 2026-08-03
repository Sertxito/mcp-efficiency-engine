const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function hasCommand(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error && result.error.code === "ENOENT") {
    return false;
  }
  return !result.error;
}

function detectProviders(workspaceRoot) {
  return [
    {
      name: "CodeGraph",
      available: hasCommand("codegraph") || fs.existsSync(path.join(workspaceRoot, ".codegraph")),
      detail: "code-navigation, symbols, call paths",
    },
    {
      name: "GitNexus",
      available: fs.existsSync(path.join(workspaceRoot, ".gitnexus")),
      detail: "multi-repo impact and blast radius",
    },
    {
      name: "Graphify",
      available:
        fs.existsSync(path.join(workspaceRoot, "context", "graphify-out", "manifest.json")) || hasCommand("graphify"),
      detail: "knowledge graph retrieval",
    },
    {
      name: "MarkItDown",
      available: hasCommand("markitdown"),
      detail: "document normalization",
    },
    {
      name: "Repomix",
      available: hasCommand("repomix"),
      detail: "snapshot and export",
    },
  ];
}

module.exports = {
  detectProviders,
};
