"use strict";

const { spawnSync } = require("node:child_process");

const id = "vue-runtime";
const checks = [
  "ts-typecheck",
  "input-immutability",
  "reactive-render",
  "latest-request-wins",
  "unmount-aborts-request",
  "server-render",
];
const behaviorChecks = checks.slice(1);
const root = __dirname;

const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const native = spawnSync(process.execPath, [
  "--test",
  "--test-reporter=tap",
  "checks.cjs",
], { cwd: root, env, encoding: "utf8" });
const output = `${native.stdout || ""}${native.stderr || ""}`;
if (native.stdout) process.stdout.write(native.stdout);
if (native.stderr) process.stderr.write(native.stderr);

const testCount = Number(output.match(/# tests (\d+)/)?.[1] || 0);
const passCount = Number(output.match(/# pass (\d+)/)?.[1] || 0);
const failCount = Number(output.match(/# fail (\d+)/)?.[1] || 0);
const behavioralFailures = [...new Set(
  [...output.matchAll(/\[MCPEE_BEHAVIOR:([a-z0-9-]+)\]/g)].map(match => match[1]),
)];

if (native.error) {
  process.stderr.write(`MCPEE_ORACLE_SETUP_ERROR: ${native.error.message}\n`);
  process.exitCode = 1;
} else if (native.status === 0 && testCount === checks.length &&
  passCount === checks.length && failCount === 0 &&
  output.includes("[MCPEE_TYPECHECK:passed]")) {
  process.stdout.write(`MCPEE_ORACLE_RESULT ${JSON.stringify({
    schema_version: 1,
    id,
    status: "passed",
    checks,
  })}\n`);
} else if (native.status !== 0 && testCount === checks.length &&
  failCount > 0 && behavioralFailures.length === failCount &&
  behavioralFailures.every(check => behaviorChecks.includes(check)) &&
  output.includes("[MCPEE_TYPECHECK:passed]")) {
  process.stdout.write(`MCPEE_ORACLE_FAILURE ${JSON.stringify({
    schema_version: 1,
    id,
    status: "failed",
    checks: behavioralFailures,
  })}\n`);
  process.exitCode = 1;
} else {
  if (!output.includes("[MCPEE_TYPECHECK:passed]")) {
    process.stderr.write("MCPEE_ORACLE_SETUP_ERROR: compiler check did not complete successfully\n");
  }
  process.exitCode = native.status || 1;
}
