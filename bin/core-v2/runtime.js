const { discoverBoosts } = require("./plugin-loader");
const { CapabilityRegistry } = require("./capability-registry");
const { detectProviders } = require("./providers");
const { detectOptimizers } = require("./optimizers");
const { getProjectStoreStatus } = require("./project-store");

function loadRuntimeSnapshot(workspaceRoot) {
  const discovery = discoverBoosts(workspaceRoot);
  const registry = new CapabilityRegistry();
  registry.registerMany(discovery.boosts);

  return {
    discovery,
    registry,
    providers: detectProviders(workspaceRoot),
    optimizers: detectOptimizers(),
    projectStore: getProjectStoreStatus(workspaceRoot),
  };
}

module.exports = {
  loadRuntimeSnapshot,
};
