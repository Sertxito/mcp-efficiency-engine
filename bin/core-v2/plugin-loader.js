const fs = require("node:fs");
const path = require("node:path");
const { loadBoostContract } = require("./contracts");

function isDirectoryLike(baseDir, entry) {
  if (entry.isDirectory()) {
    return true;
  }

  // On Windows, Dirent for junctions/symlinks may not report isDirectory().
  if (entry.isSymbolicLink()) {
    try {
      const fullPath = path.join(baseDir, entry.name);
      return fs.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  }

  return false;
}

function findBoostContractsInNodeModules(workspaceRoot) {
  const scopeDir = path.join(workspaceRoot, "node_modules", "@mcpee");
  const contracts = [];

  if (fs.existsSync(scopeDir)) {
    const scopedBoostDirs = fs
      .readdirSync(scopeDir, { withFileTypes: true })
      .filter((entry) => isDirectoryLike(scopeDir, entry));

    for (const boostDir of scopedBoostDirs) {
      const contractPath = path.join(scopeDir, boostDir.name, "mcpee.json");
      if (fs.existsSync(contractPath)) {
        contracts.push(contractPath);
      }
    }
  }

  // Backward compatibility: allow unscoped boost packages such as mcpee-backend.
  const nodeModulesRoot = path.join(workspaceRoot, "node_modules");
  if (fs.existsSync(nodeModulesRoot)) {
    const unscopedBoostDirs = fs
      .readdirSync(nodeModulesRoot, { withFileTypes: true })
      .filter((entry) => isDirectoryLike(nodeModulesRoot, entry) && entry.name.startsWith("mcpee-"));

    for (const boostDir of unscopedBoostDirs) {
      const contractPath = path.join(nodeModulesRoot, boostDir.name, "mcpee.json");
      if (fs.existsSync(contractPath)) {
        contracts.push(contractPath);
      }
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
    if (!isDirectoryLike(localBoostRoot, entry)) {
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
  const contractPaths = Array.from(new Set([
    ...findBoostContractsInNodeModules(workspaceRoot),
    ...findLocalBoostContracts(workspaceRoot),
  ]));

  const boosts = [];
  const seenBoostNames = new Set();
  const warnings = [];
  for (const contractPath of contractPaths) {
    try {
      const boost = loadBoostContract(contractPath);
      if (seenBoostNames.has(boost.name)) {
        continue;
      }
      seenBoostNames.add(boost.name);
      boosts.push(boost);
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
