"use strict";

const { spawnSync } = require("node:child_process");
const checkIds = require("./oracle.json").checks;

function cleanEnvironment(source) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    const normalized = key.toLowerCase();
    if (normalized === "node_test_context" || normalized === "node_options" ||
        normalized === "node_path" || normalized === "http_proxy" ||
        normalized === "https_proxy" || normalized === "all_proxy" ||
        normalized === "no_proxy" || normalized.startsWith("azure_") ||
        normalized.startsWith("cosmos_")) {
      delete env[key];
    }
  }
  return env;
}

const child = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "checks.cjs"], {
  cwd: __dirname,
  encoding: "utf8",
  timeout: 30000,
  env: cleanEnvironment(process.env),
  maxBuffer: 2 * 1024 * 1024,
});

if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);

if (child.error || child.signal || !child.stdout) {
  process.stderr.write(`MCPEE_ORACLE_SETUP_ERROR: ${child.error?.message ?? child.signal ?? "no test output"}\n`);
  process.exitCode = 1;
} else {
  const observed = [];
  for (const line of child.stdout.split(/\r?\n/)) {
    const match = line.match(/^(ok|not ok) \d+ - (.+)$/);
    if (match) observed.push({ status: match[1], id: match[2] });
  }
  const summary = child.stdout.match(/^# tests (\d+)$/m);
  const failures = observed.filter(result => result.status === "not ok").map(result => result.id);
  const known = observed.length === checkIds.length &&
    observed.every(result => checkIds.includes(result.id)) &&
    new Set(observed.map(result => result.id)).size === checkIds.length &&
    Number(summary?.[1]) === checkIds.length;

  if (!known || child.status !== (failures.length ? 1 : 0)) {
    process.stderr.write("MCPEE_ORACLE_SETUP_ERROR: checker did not complete the known behavioral suite\n");
    process.exitCode = 1;
  } else {
    const passed = failures.length === 0;
    const payload = {
      schema_version: 1,
      id: "cosmos-sdk-runtime",
      status: passed ? "passed" : "failed",
      checks: passed ? checkIds : failures,
    };
    process.stdout.write(`MCPEE_ORACLE_${passed ? "RESULT" : "FAILURE"} ${JSON.stringify(payload)}\n`);
    process.exitCode = passed ? 0 : 1;
  }
}
