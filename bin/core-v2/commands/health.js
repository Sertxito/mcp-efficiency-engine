const { loadRuntimeSnapshot } = require("../runtime");
const { listArtifacts } = require("../artifact-registry");

function runHealth(workspaceRoot) {
  const snapshot = loadRuntimeSnapshot(workspaceRoot);
  const capabilities = snapshot.registry.listCapabilities();

  const health = {
    runtime: "ok",
    projectStore: snapshot.projectStore.rootExists ? "ok" : "missing",
    boosts: snapshot.registry.listBoosts().length,
    capabilities: capabilities.length,
    artifacts: listArtifacts(workspaceRoot).length,
    providersAvailable: snapshot.providers.filter((provider) => provider.available).map((provider) => provider.name),
    providersMissing: snapshot.providers.filter((provider) => !provider.available).map((provider) => provider.name),
    optimizersEnabled: snapshot.optimizers.filter((optimizer) => optimizer.enabled).map((optimizer) => optimizer.name),
    optionalOptimizersMissing: snapshot.optimizers
      .filter((optimizer) => optimizer.optional && !optimizer.enabled)
      .map((optimizer) => optimizer.name),
  };

  process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
  return snapshot.projectStore.rootExists ? 0 : 1;
}

module.exports = {
  runHealth,
};
