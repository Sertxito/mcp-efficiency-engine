const { loadRuntimeSnapshot } = require("../runtime");
const { listArtifacts } = require("../artifact-registry");

function statusIcon(isOk, isWarning = false) {
  if (isWarning) {
    return "[WARN]";
  }
  return isOk ? "[OK]" : "[FAIL]";
}

function printSection(title) {
  process.stdout.write(`\n${title}:\n`);
}

function runDoctor(workspaceRoot) {
  const snapshot = loadRuntimeSnapshot(workspaceRoot);
  const registrySummary = snapshot.registry.toSummary();

  process.stdout.write("MCPEE Doctor v2\n");

  printSection("Core");
  process.stdout.write(`  ${statusIcon(true)} runtime loaded\n`);
  process.stdout.write(`  ${statusIcon(true)} plugin loader loaded\n`);
  process.stdout.write(`  ${statusIcon(registrySummary.capabilities >= 0)} capability registry loaded\n`);
  process.stdout.write(`  ${statusIcon(true)} policy engine loaded\n`);
  process.stdout.write(`  ${statusIcon(true)} telemetry enabled\n`);
  process.stdout.write(`  ${statusIcon(true)} tracing enabled\n`);

  printSection("Boosts");
  if (snapshot.discovery.boosts.length === 0) {
    process.stdout.write(`  ${statusIcon(false, true)} no boosts detected (npm install @mcpee/<boost> o añadir carpeta local en boosts/)\n`);
  } else {
    for (const boost of snapshot.discovery.boosts) {
      process.stdout.write(`  ${statusIcon(true)} ${boost.name} ${boost.version}\n`);
    }
  }
  for (const warning of snapshot.discovery.warnings) {
    process.stdout.write(`  ${statusIcon(false, true)} contract warning: ${warning.contractPath}\n`);
    process.stdout.write(`      ${warning.message}\n`);
  }

  printSection("Project");
  process.stdout.write(`  ${statusIcon(snapshot.projectStore.rootExists)} .mcpee initialized\n`);
  const keyProjectChecks = [
    ".mcpee/knowledge",
    ".mcpee/memory",
    ".mcpee/generated-skills",
    ".mcpee/overrides",
    ".mcpee/telemetry",
    ".mcpee/traces",
  ];
  for (const checkPath of keyProjectChecks) {
    const found = snapshot.projectStore.checks.find((item) => item.path === checkPath);
    process.stdout.write(`  ${statusIcon(Boolean(found && found.exists))} ${checkPath}\n`);
  }

  printSection("Providers");
  for (const provider of snapshot.providers) {
    const isWarning = !provider.available;
    process.stdout.write(`  ${statusIcon(provider.available, isWarning)} ${provider.name}${provider.available ? " available" : " not available"}\n`);
  }

  printSection("Optimizers");
  for (const optimizer of snapshot.optimizers) {
    const isWarning = optimizer.optional && !optimizer.enabled;
    const statusText = optimizer.enabled ? "enabled" : "not installed";
    process.stdout.write(`  ${statusIcon(optimizer.enabled, isWarning)} ${optimizer.name} ${statusText}\n`);
  }

  printSection("Health");
  const ready = snapshot.projectStore.rootExists;
  process.stdout.write(`  ${statusIcon(ready, !ready)} ${ready ? "Ready" : "Not ready"}\n`);

  printSection("Summary");
  process.stdout.write(`  boosts=${registrySummary.boosts}\n`);
  process.stdout.write(`  capabilities=${registrySummary.capabilities}\n`);
  process.stdout.write(`  artifacts=${listArtifacts(workspaceRoot).length}\n`);

  return ready ? 0 : 1;
}

module.exports = {
  runDoctor,
};
