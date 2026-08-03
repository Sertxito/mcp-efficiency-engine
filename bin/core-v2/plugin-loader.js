const fs = require("node:fs");
const path = require("node:path");
const { loadBoostContract } = require("./contracts");

function findBoostContractsInNodeModules(workspaceRoot) {
  const scopeDir = path.join(workspaceRoot, "node_modules", "@mcpee");
  if (!fs.existsSync(scopeDir)) {
    return [];
  }

  const boostDirs = fs.readdirSync(scopeDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const contracts = [];
  for (const boostDir of boostDirs) {
    const contractPath = path.join(scopeDir, boostDir.name, "mcpee.json");
    if (fs.existsSync(contractPath)) {
      contracts.push(contractPath);
    }
  }

  return contracts;
}

function findLocalBoostContracts(workspaceRoot) {
  const localBoostRoot = path.join(workspaceRoot, "boosts");
  if (!fs.existsSync(localBoostRoot)) {
    return [];
  }

  const contracts = [];
  for (const entry of fs.readdirSync(localBoostRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const contractPath = path.join(localBoostRoot, entry.name, "mcpee.json");
    if (fs.existsSync(contractPath)) {
      contracts.push(contractPath);
    }
  }

  return contracts;
}

function discoverBoosts(workspaceRoot) {
  const contractPaths = [
    ...findBoostContractsInNodeModules(workspaceRoot),
    ...findLocalBoostContracts(workspaceRoot),
  ];

  const boosts = [];
  const warnings = [];
  for (const contractPath of contractPaths) {
    try {
      boosts.push(loadBoostContract(contractPath));
    } catch (error) {
      warnings.push({
        contractPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    boosts,
    warnings,
  };
}

module.exports = {
  discoverBoosts,
};
