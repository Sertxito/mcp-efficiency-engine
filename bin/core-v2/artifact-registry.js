const fs = require("node:fs");
const path = require("node:path");

function registryPath(workspaceRoot) {
  return path.join(workspaceRoot, ".mcpee", "artifacts", "registry.json");
}

function loadRegistry(workspaceRoot) {
  const filePath = registryPath(workspaceRoot);
  if (!fs.existsSync(filePath)) {
    return { version: "1.0", artifacts: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.artifacts)) {
      return parsed;
    }
  } catch {
    // fall through to empty registry
  }

  return { version: "1.0", artifacts: [] };
}

function saveRegistry(workspaceRoot, registry) {
  const filePath = registryPath(workspaceRoot);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function upsertArtifact(workspaceRoot, artifact) {
  const registry = loadRegistry(workspaceRoot);
  const existingIndex = registry.artifacts.findIndex((item) => item.artifactId === artifact.artifactId);
  const normalizedArtifact = {
    artifactId: String(artifact.artifactId),
    type: String(artifact.type || "unknown"),
    provider: String(artifact.provider || "unknown"),
    createdAt: String(artifact.createdAt || new Date().toISOString()),
    qualityScore: Number.isFinite(artifact.qualityScore) ? artifact.qualityScore : 0,
    groundingQuality: Number.isFinite(artifact.groundingQuality) ? artifact.groundingQuality : 0,
    dependencies: Array.isArray(artifact.dependencies) ? artifact.dependencies.map((item) => String(item)) : [],
    path: String(artifact.path || ""),
    usageCount: Number.isFinite(artifact.usageCount) ? artifact.usageCount : 1,
    metadata: artifact.metadata && typeof artifact.metadata === "object" ? artifact.metadata : {},
  };

  if (existingIndex >= 0) {
    const current = registry.artifacts[existingIndex];
    registry.artifacts[existingIndex] = {
      ...current,
      ...normalizedArtifact,
      usageCount: (Number(current.usageCount) || 0) + 1,
    };
  } else {
    registry.artifacts.push(normalizedArtifact);
  }

  saveRegistry(workspaceRoot, registry);
  return normalizedArtifact;
}

function registerExecutionArtifact(workspaceRoot, event, executionReportPath) {
  return upsertArtifact(workspaceRoot, {
    artifactId: `execution.${event.executionId}`,
    type: "execution-report",
    provider: event.boost,
    createdAt: event.timestamp || new Date().toISOString(),
    qualityScore: event.qualityScore || 0,
    groundingQuality: event.groundingScore || 0,
    dependencies: [event.capability].filter(Boolean),
    path: executionReportPath,
    metadata: {
      traceId: event.traceId,
      status: event.status,
      agent: event.agent,
    },
  });
}

function listArtifacts(workspaceRoot) {
  return loadRegistry(workspaceRoot).artifacts;
}

module.exports = {
  upsertArtifact,
  registerExecutionArtifact,
  listArtifacts,
};
