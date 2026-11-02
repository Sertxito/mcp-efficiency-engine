"use strict";

async function main() {
  const { checks, runChecks } = require("./checks.cjs");
  const failed = await runChecks();
  const passed = failed.length === 0;
  console.log(`${passed ? "MCPEE_ORACLE_RESULT" : "MCPEE_ORACLE_FAILURE"} ${JSON.stringify({
    schema_version: 1,
    id: "aws-sdk-runtime",
    status: passed ? "passed" : "failed",
    checks: passed ? checks : failed,
  })}`);
  process.exitCode = passed ? 0 : 1;
}

main().catch(error => {
  console.error(`MCPEE_ORACLE_SETUP_ERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
});
