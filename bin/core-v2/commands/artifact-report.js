const { listArtifacts } = require("../artifact-registry");

function runArtifactReport(workspaceRoot) {
  const artifacts = listArtifacts(workspaceRoot);
  process.stdout.write("MCPEE Artifact Registry v2\n\n");
  process.stdout.write(`totalArtifacts: ${artifacts.length}\n`);
  for (const artifact of artifacts) {
    process.stdout.write(`- ${artifact.artifactId} | ${artifact.type} | ${artifact.provider} | ${artifact.path}\n`);
  }
  return 0;
}

module.exports = {
  runArtifactReport,
};
