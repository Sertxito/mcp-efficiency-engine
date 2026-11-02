"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  loadBehavioralOracles, behavioralRunSpecs, buildBehavioralAcceptance,
} = require("../packages/evaluation-engine/src/behavioral-oracles");
const { loadRunSpec, executeRunSpec } = require("../packages/evaluation-engine/src/evaluate");

const fixture = path.resolve(__dirname, "../templates/specialist-acceptance/terraform-local-lifecycle");
const baselineSource = fs.readFileSync(path.join(fixture, "main.tf"), "utf8");
const control = baselineSource
  .replace("count = length(var.entries)", "for_each = { for entry in var.entries : entry.name => entry }")
  .replaceAll("var.entries[count.index]", "each.value");

test("native Terraform checks preserve local resource identities and reject lifecycle mutations", async t => {
  const runtime = spawnSync("terraform", ["version", "-json"], { encoding: "utf8", timeout: 30000 });
  if (runtime.error?.code === "ENOENT") return t.skip("Terraform absent; native Terraform oracle was not executed.");
  assert.equal(runtime.error, undefined);
  assert.equal(runtime.status, 0, runtime.stdout + runtime.stderr);
  const version = JSON.parse(runtime.stdout).terraform_version;
  if (version !== "1.14.0") return t.skip(`Native fixture pins Terraform 1.14.0; installed ${version} was not used.`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-terraform-oracle-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const suite = loadBehavioralOracles();
  const oracle = suite.oracles.find(item => item.id === "terraform-local-lifecycle");
  assert.ok(oracle);
  const copy = directory => {
    for (const file of oracle.files) {
      const destination = path.join(root, directory, file.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(fixture, file.path), destination);
    }
  };
  const before = oracle.files.map(file => fs.readFileSync(path.join(fixture, file.path)));
  copy("candidate");
  const main = path.join(root, "candidate", "main.tf");
  const run = () => spawnSync(process.execPath, ["run-oracle.cjs"], {
    cwd: path.join(root, "candidate"), encoding: "utf8", timeout: 240000,
    env: { ...process.env, TF_CLI_ARGS: "-invalid", TF_WORKSPACE: "untrusted", TF_VAR_environment: "production" },
  });
  const seeded = run();
  assert.equal(seeded.error, undefined);
  assert.equal(seeded.status, 1, seeded.stdout + seeded.stderr);
  assert.match(seeded.stdout, /MCPEE_ORACLE_FAILURE /);
  assert.doesNotMatch(seeded.stderr, /MCPEE_ORACLE_SETUP_ERROR/);
  fs.writeFileSync(main, control);
  const repaired = run();
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  const marker = repaired.stdout.split(/\r?\n/).find(line => line.startsWith("MCPEE_ORACLE_RESULT "));
  assert.ok(marker, repaired.stdout);
  assert.deepEqual(JSON.parse(marker.slice("MCPEE_ORACLE_RESULT ".length)).checks, oracle.checks);
  for (const [label, mutant] of [
    ["indexed identities", baselineSource],
    ["replacement on value update", control.replace("  input = {", "  triggers_replace = each.value.value\n  input = {")],
    ["ignored environment", control.replace("environment = var.environment", 'environment = "test"')],
    ["wrong output", control.replace("value       = each.value.value", 'value       = "wrong"')],
  ]) {
    assert.notEqual(mutant, control, label);
    fs.writeFileSync(main, mutant);
    const failed = run();
    assert.equal(failed.error, undefined, label);
    assert.equal(failed.status, 1, label + failed.stdout + failed.stderr);
    assert.match(failed.stdout, /MCPEE_ORACLE_FAILURE /, label + failed.stdout + failed.stderr);
    assert.doesNotMatch(failed.stdout, /MCPEE_ORACLE_RESULT /, label);
  }
  fs.writeFileSync(main, "this is not valid HCL {{{");
  const malformed = run();
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /MCPEE_ORACLE_SETUP_ERROR/);
  assert.doesNotMatch(malformed.stdout, /MCPEE_ORACLE_(RESULT|FAILURE) /);
  fs.writeFileSync(main, control);
  copy("baseline");
  const specs = behavioralRunSpecs(oracle);
  const ids = {};
  let approvals = 0;
  for (const variant of ["baseline", "candidate"]) {
    fs.writeFileSync(path.join(root, `${variant}.json`), JSON.stringify(specs[variant]));
    const report = await executeRunSpec(root, loadRunSpec(root, `${variant}.json`), {
      approveStep: async check => {
        assert.equal(check.tool, "node");
        assert.deepEqual(check.args, ["run-oracle.cjs"]);
        approvals += 1;
        return true;
      },
    });
    assert.equal(report.status, variant === "baseline" ? "failed" : "passed", JSON.stringify(report.checks));
    assert.equal(report.checks[0].error, undefined, JSON.stringify(report.checks));
    assert.equal(report.checks[0].exit_code, variant === "baseline" ? 1 : 0, JSON.stringify(report.checks));
    ids[variant] = report.id;
  }
  assert.equal(approvals, 2);
  fs.writeFileSync(path.join(root, "results.json"), JSON.stringify({
    suite_id: suite.id, suite_sha256: suite.suite_sha256, catalog_sha256: suite.catalog_sha256,
    trials: [{
      oracle: oracle.id, baseline_validation_id: ids.baseline, candidate_validation_id: ids.candidate,
    }],
  }));
  const accepted = buildBehavioralAcceptance(root, "results.json");
  assert.equal(accepted.summary.checked_fixtures, 1);
  assert.equal(accepted.summary.specialist_trials_certified, 0);
  assert.equal(accepted.status, "incomplete");
  for (const [index, file] of oracle.files.entries()) {
    assert.deepEqual(fs.readFileSync(path.join(fixture, file.path)), before[index], file.path);
  }
});
