"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { prepare } = require("./native-tool.cjs");
const { run } = require("./checks.cjs");

async function main() {
  const directory = fs.mkdtempSync(path.join(__dirname, ".oracle-run-"));
  let result;
  try {
    const executable = await prepare(directory);
    result = run(executable, directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const failed = result.failed.length > 0;
  console.log(`${failed ? "MCPEE_ORACLE_FAILURE" : "MCPEE_ORACLE_RESULT"} ${JSON.stringify({
    schema_version: 1, id: "pipeline-runtime", status: failed ? "failed" : "passed",
    checks: failed ? result.failed : result.checks,
  })}`);
  return failed ? 1 : 0;
}

main().then(code => { process.exitCode = code; }).catch(error => {
  process.stderr.write(`MCPEE_ORACLE_SETUP_ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
