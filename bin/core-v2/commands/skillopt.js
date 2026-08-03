const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { summarizeTelemetry } = require("../telemetry-v2");
const { listArtifacts, upsertArtifact } = require("../artifact-registry");
const { loadRuntimeSnapshot } = require("../runtime");

function resolvePythonCommand() {
  if (process.platform === "win32") {
    return ["py", ["-3"]];
  }

  return ["python3", []];
}

function officialSkillOptSleepAvailable() {
  const [pythonCommand, pythonPrefixArgs] = resolvePythonCommand();
  const checkResult = spawnSync(
    pythonCommand,
    [...pythonPrefixArgs, "-c", "import skillopt_sleep"],
    { stdio: "ignore" },
  );

  return !checkResult.error && (checkResult.status ?? 1) === 0;
}

function delegateToOfficialSkillOptSleep(workspaceRoot, args) {
  const [pythonCommand, pythonPrefixArgs] = resolvePythonCommand();
  const result = spawnSync(
    pythonCommand,
    [...pythonPrefixArgs, "-m", "skillopt_sleep", ...args],
    {
      cwd: workspaceRoot,
      stdio: "inherit",
    },
  );

  if (result.error) {
    return null;
  }

  return result.status ?? 0;
}

function runLocalBridge(workspaceRoot) {
  const summary = summarizeTelemetry(workspaceRoot);
  const artifacts = listArtifacts(workspaceRoot);
  const snapshot = loadRuntimeSnapshot(workspaceRoot);
  const capabilityEntries = Object.entries(summary.byCapability).sort((a, b) => b[1] - a[1]);

  if (capabilityEntries.length === 0) {
    process.stdout.write("MCPEE SkillOpt-Sleep bridge v2\n\nNo telemetry available yet. Nothing to optimize.\n");
    return 0;
  }

  const [topCapability, topCount] = capabilityEntries[0];
  const capability = snapshot.registry.getCapability(topCapability);
  const artifact = artifacts.find((item) => item.dependencies.includes(topCapability));
  const boostName = capability ? capability.boost : artifact ? artifact.provider : "@mcpee/backend";
  const boostFolder = boostName.replace(/^@mcpee\//, "");
  const draftDir = path.join(workspaceRoot, ".mcpee", "generated-skills", boostFolder);
  const draftPath = path.join(draftDir, `${topCapability.replace(/[^a-zA-Z0-9.-]+/g, "-")}.md`);

  fs.mkdirSync(draftDir, { recursive: true });
  const content = [
    `# Generated Skill Draft: ${topCapability}`,
    "",
    `- Telemetry executions: ${topCount}`,
    `- Boost: ${boostName}`,
    `- Source artifact: ${artifact ? artifact.artifactId : "none"}`,
    "",
    "## Draft Guidance",
    "- Strengthen evidence retrieval for this capability.",
    "- Reduce unused context before LLM input.",
    "- Keep grounded outputs short and traceable.",
  ].join("\n");
  fs.writeFileSync(draftPath, `${content}\n`, "utf8");

  upsertArtifact(workspaceRoot, {
    artifactId: `generated-skill.${topCapability}`,
    type: "generated-skill",
    provider: boostName,
    createdAt: new Date().toISOString(),
    qualityScore: 0.75,
    groundingQuality: 0.8,
    dependencies: [topCapability],
    path: draftPath,
    metadata: {
      sourceExecutions: topCount,
      bridge: "local",
    },
  });

  process.stdout.write("MCPEE SkillOpt-Sleep bridge v2\n\n");
  process.stdout.write(`draft generated: ${draftPath}\n`);
  process.stdout.write(`capability optimized: ${topCapability}\n`);
  return 0;
}

function runSkillOpt(workspaceRoot, args = []) {
  const officialStatus = officialSkillOptSleepAvailable();
  const forwardedArgs = Array.isArray(args) ? args : [];

  if (officialStatus) {
    const delegated = delegateToOfficialSkillOptSleep(workspaceRoot, forwardedArgs);
    if (delegated !== null) {
      process.stdout.write("MCPEE SkillOpt-Sleep bridge v2\n");
      process.stdout.write("Delegated to upstream microsoft/SkillOpt skillopt_sleep module.\n");
      return delegated;
    }
  }

  process.stdout.write("MCPEE SkillOpt-Sleep bridge v2\n");
  process.stdout.write("Upstream skillopt_sleep unavailable or failed. Using local fallback.\n\n");
  return runLocalBridge(workspaceRoot);
}

module.exports = {
  runSkillOpt,
};
