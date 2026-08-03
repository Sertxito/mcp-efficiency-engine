const { summarizeTelemetry } = require("../telemetry-v2");

function runTelemetryReport(workspaceRoot) {
  const summary = summarizeTelemetry(workspaceRoot);
  process.stdout.write("MCPEE Telemetry Report v2\n\n");
  process.stdout.write(`totalExecutions: ${summary.totalExecutions}\n`);
  process.stdout.write(`avgLatencyMs: ${summary.avgLatencyMs}\n`);
  process.stdout.write(`avgInputTokens: ${summary.avgInputTokens}\n`);
  process.stdout.write(`avgOutputTokens: ${summary.avgOutputTokens}\n`);
  process.stdout.write(`avgGroundingScore: ${summary.avgGroundingScore}\n`);

  process.stdout.write("\nbyCapability:\n");
  const capabilityEntries = Object.entries(summary.byCapability);
  if (capabilityEntries.length === 0) {
    process.stdout.write("  (no data)\n");
  } else {
    for (const [capability, count] of capabilityEntries) {
      process.stdout.write(`  - ${capability}: ${count}\n`);
    }
  }

  process.stdout.write("\nbyBoost:\n");
  const boostEntries = Object.entries(summary.byBoost);
  if (boostEntries.length === 0) {
    process.stdout.write("  (no data)\n");
  } else {
    for (const [boost, count] of boostEntries) {
      process.stdout.write(`  - ${boost}: ${count}\n`);
    }
  }

  return 0;
}

module.exports = {
  runTelemetryReport,
};
