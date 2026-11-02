"use strict";

async function main() {
  const { runChecks, definitions } = require("./checks.cjs");
  const mode = process.argv[2];
  if (!Object.hasOwn(definitions, mode)) throw new Error("Specify exactly one oracle: azure or bicep");
  const definition = definitions[mode];
  const failures = await runChecks(mode);
  const failed = failures.length > 0;
  process.stdout.write(`${failed ? "MCPEE_ORACLE_FAILURE" : "MCPEE_ORACLE_RESULT"} ${JSON.stringify({
    schema_version: 1,
    id: definition.id,
    status: failed ? "failed" : "passed",
    checks: failed ? failures : definition.checks,
  })}\n`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => {
  process.stderr.write(`MCPEE_ORACLE_SETUP_ERROR: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
