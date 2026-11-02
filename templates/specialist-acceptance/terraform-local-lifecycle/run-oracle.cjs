"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const id = "terraform-local-lifecycle";
const checks = [
  "tests/identity.tftest.hcl/seed",
  "tests/identity.tftest.hcl/reorder",
  "tests/invalid.tftest.hcl/environment",
  "tests/invalid.tftest.hcl/duplicate_names",
  "tests/invalid.tftest.hcl/empty_name",
  "tests/normal.tftest.hcl/nonempty",
  "tests/normal.tftest.hcl/empty",
  "tests/update.tftest.hcl/seed",
  "tests/update.tftest.hcl/update",
];

function run() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-terraform-run-"));
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^TF_/i.test(key)));
    env.TF_IN_AUTOMATION = "1";
    env.TF_INPUT = "0";
    env.CHECKPOINT_DISABLE = "1";
    env.TF_DATA_DIR = path.join(scratch, "data");
    env.TF_CLI_CONFIG_FILE = path.join(__dirname, "cli.tfrc");
    const invoke = args => {
      const result = spawnSync("terraform", args, {
        cwd: __dirname, env, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024,
      });
      if (result.error) throw new Error(`terraform ${args[0]}: ${result.error.message}`);
      return result;
    };
    const version = invoke(["version", "-json"]);
    if (version.status !== 0 || JSON.parse(version.stdout).terraform_version !== "1.14.0") {
      throw new Error("This native fixture requires Terraform 1.14.0.");
    }
    const plugins = path.join(scratch, "plugins");
    fs.mkdirSync(plugins);
    for (const args of [
      ["init", "-backend=false", "-input=false", "-get=false", "-no-color", `-plugin-dir=${plugins}`],
      ["validate", "-no-color"],
    ]) {
      const result = invoke(args);
      if (result.status !== 0) throw new Error(`${args[0]} failed: ${result.stdout}${result.stderr}`);
    }
    const result = invoke(["test", "-json", "-no-color"]);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    // Structured result validation is deliberately separate from command setup.
    const events = result.stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const runs = events.filter(event => event.type === "test_run" && event.test_run?.progress === "complete");
    const summary = events.filter(event => event.type === "test_summary");
    const nameOf = event => `${event.test_run.path.replace(/\\/g, "/")}/${event.test_run.run}`;
    const names = runs.map(nameOf);
    const complete = runs.length === checks.length && new Set(names).size === checks.length &&
      names.every(name => checks.includes(name)) && summary.length === 1;
    if (!complete) throw new Error("Native Terraform results are missing, duplicated or incomplete.");
    const failed = runs.filter(event => event.test_run.status === "fail");
    const passed = runs.filter(event => event.test_run.status === "pass");
    const totals = summary[0].test_summary;
    if (totals.passed !== passed.length || totals.failed !== failed.length ||
        totals.errored !== 0 || totals.skipped !== 0) {
      throw new Error("Native Terraform summary does not match completed checks without skips or errors.");
    }
    const diagnostics = events.filter(event => event.type === "diagnostic" && event.diagnostic?.severity === "error");
    if (result.status === 0 && totals.status === "pass" &&
        passed.length === checks.length && failed.length === 0 && diagnostics.length === 0) {
      console.log(`MCPEE_ORACLE_RESULT ${JSON.stringify({ schema_version: 1, id, status: "passed", checks })}`);
      return 0;
    }
    if (result.status === 1 && totals.status === "fail" &&
        failed.length > 0 && passed.length + failed.length === checks.length &&
        diagnostics.length > 0 && diagnostics.every(event => event.diagnostic.summary === "Test assertion failed")) {
      console.log(`MCPEE_ORACLE_FAILURE ${JSON.stringify({
        schema_version: 1, id, status: "failed",
        checks: failed.map(nameOf),
      })}`);
      return 1;
    }
    throw new Error("Terraform failed setup, validation, execution or cleanup rather than known behavioral assertions.");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`MCPEE_ORACLE_SETUP_ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
