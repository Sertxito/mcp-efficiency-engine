const fs = require("node:fs");
const path = require("node:path");
const { loadRuntimeSnapshot } = require("../runtime");
const { upsertArtifact } = require("../artifact-registry");

function runKnowledgeBuild(workspaceRoot) {
  const snapshot = loadRuntimeSnapshot(workspaceRoot);
  const capabilities = snapshot.registry.listCapabilities().map((capability) => ({
    id: capability.id,
    title: capability.title,
    boost: capability.boost,
    agent: capability.agent,
    skills: capability.skills,
    specs: capability.specs,
    providerNeeds: capability.providerNeeds,
  }));

  const outputPath = path.join(workspaceRoot, ".mcpee", "knowledge", "index", "capabilities.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({ capabilities }, null, 2)}\n`, "utf8");

  upsertArtifact(workspaceRoot, {
    artifactId: "knowledge.capabilities.index",
    type: "knowledge-index",
    provider: "Core",
    createdAt: new Date().toISOString(),
    qualityScore: capabilities.length > 0 ? 0.9 : 0.5,
    groundingQuality: capabilities.length > 0 ? 0.9 : 0.5,
    dependencies: capabilities.map((capability) => capability.id),
    path: outputPath,
    metadata: {
      capabilityCount: capabilities.length,
    },
  });

  process.stdout.write("MCPEE Knowledge Build v2\n\n");
  process.stdout.write(`capabilities indexed: ${capabilities.length}\n`);
  process.stdout.write(`output: ${outputPath}\n`);
  return 0;
}

module.exports = {
  runKnowledgeBuild,
};
