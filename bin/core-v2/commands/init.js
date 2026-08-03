const { initProjectStore } = require("../project-store");

function runInit(workspaceRoot) {
  const result = initProjectStore(workspaceRoot);
  process.stdout.write("MCPEE Init v2\n\n");
  process.stdout.write(`Workspace: ${workspaceRoot}\n`);
  process.stdout.write(`Project store: ${result.root}\n`);

  if (result.created.length === 0) {
    process.stdout.write("No new directories were created.\n");
  } else {
    process.stdout.write("Created:\n");
    for (const relativeDir of result.created) {
      process.stdout.write(`  + ${relativeDir}\n`);
    }
  }

  return 0;
}

module.exports = {
  runInit,
};
