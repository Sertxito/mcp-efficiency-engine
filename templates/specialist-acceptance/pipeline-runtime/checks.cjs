"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { nativeEnvironment } = require("./native-tool.cjs");

const checks = [
  "native-workflow-schema-and-graph",
  "native-expression-contracts",
  "native-script-input-trust",
];

function run(executable, directory) {
  const workflow = path.join(directory, "workflow.yml");
  const config = path.join(directory, "actionlint.yaml");
  fs.copyFileSync(path.join(__dirname, "workflow.yml"), workflow);
  fs.copyFileSync(path.join(__dirname, "actionlint.yaml"), config);
  const result = spawnSync(executable, [
    "-no-color", "-shellcheck=", "-pyflakes=", "-config-file", config,
    "-format", "{{json .}}", workflow,
  ], {
    cwd: directory, env: nativeEnvironment(directory),
    encoding: "utf8", timeout: 20000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status) || result.stderr.trim()) {
    throw new Error(`Native actionlint execution failed: ${result.error?.message || result.stderr || result.status}`);
  }
  let diagnostics;
  try {
    diagnostics = JSON.parse(result.stdout);
  } catch {
    throw new Error("Native actionlint returned malformed diagnostics.");
  }
  if (diagnostics === null) diagnostics = [];
  if (!Array.isArray(diagnostics) || diagnostics.some(item =>
    !item || typeof item.kind !== "string" || typeof item.message !== "string" ||
    !Number.isInteger(item.line) || item.line < 1 || !Number.isInteger(item.column) || item.column < 0
  )) throw new Error("Native actionlint returned incomplete diagnostics.");
  if ((result.status === 0) !== (diagnostics.length === 0)) {
    throw new Error("Native actionlint exit status disagrees with diagnostics.");
  }
  const failed = new Set(diagnostics.map(item => {
    if (item.kind !== "expression") return checks[0];
    return item.message.includes("potentially untrusted") ? checks[2] : checks[1];
  }));
  for (const item of diagnostics) {
    process.stderr.write(`actionlint:${item.line}:${item.column}: ${item.message} [${item.kind}]\n`);
  }
  return { checks, failed: checks.filter(check => failed.has(check)) };
}

module.exports = { checks, run };
