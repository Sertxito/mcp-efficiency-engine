"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  loadBehavioralOracles, behavioralRunSpecs, buildBehavioralAcceptance,
} = require("../packages/evaluation-engine/src/behavioral-oracles");
const { loadRunSpec, executeRunSpec, readEvaluation } = require("../packages/evaluation-engine/src/evaluate");

const repository = path.resolve(__dirname, "..");
const fixture = path.join(repository, "templates", "specialist-acceptance", "pipeline-runtime");
const files = [
  "workflow.yml", "actionlint.yaml", "toolchain.json", "native-tool.cjs",
  "checks.cjs", "run-oracle.cjs", "README.md", ".gitignore",
];
const checks = [
  "native-workflow-schema-and-graph",
  "native-expression-contracts",
  "native-script-input-trust",
];
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

test("native actionlint rejects the seeded workflow and bounded semantic mutations", { timeout: 240000 }, async t => {
  const root = fs.mkdtempSync(path.join(repository, ".mcpee-pipeline-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = new Map(files.map(file => [file, hash(fs.readFileSync(path.join(fixture, file)))]));
  assert.deepEqual(fs.readdirSync(fixture).filter(file => !file.startsWith(".oracle-")).sort(), [...files].sort());
  const candidate = path.join(root, "candidate");
  fs.mkdirSync(candidate);
  for (const file of files) fs.copyFileSync(path.join(fixture, file), path.join(candidate, file));
  const workflow = path.join(candidate, "workflow.yml");
  const baseline = fs.readFileSync(workflow, "utf8").replace(/\r\n/g, "\n");
  const control = baseline.replace("needs: [buid]", "needs: [build]");
  assert.notEqual(control, baseline);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (["node_test_context", "node_options", "npm_config_allow_scripts"].includes(key.toLowerCase())) delete env[key];
  }
  const invoke = () => spawnSync(process.execPath, ["run-oracle.cjs"], {
    cwd: candidate, env, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  });
  const marker = (result, status) => {
    assert.equal(result.error, undefined);
    assert.equal(result.status, status === "passed" ? 0 : 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /MCPEE_ORACLE_SETUP_ERROR/);
    const lines = result.stdout.trim().split(/\r?\n/);
    const prefix = status === "passed" ? "MCPEE_ORACLE_RESULT " : "MCPEE_ORACLE_FAILURE ";
    assert.equal(lines.filter(line => /^MCPEE_ORACLE_(RESULT|FAILURE) /.test(line)).length, 1, result.stdout);
    assert.ok(lines.at(-1).startsWith(prefix), result.stdout);
    const value = JSON.parse(lines.at(-1).slice(prefix.length));
    assert.deepEqual(Object.keys(value).sort(), ["schema_version", "id", "status", "checks"].sort());
    assert.equal(value.schema_version, 1);
    assert.equal(value.id, "pipeline-runtime");
    assert.equal(value.status, status);
    assert.ok(value.checks.length > 0);
    assert.ok(value.checks.every(check => checks.includes(check)));
    if (status === "passed") assert.deepEqual(value.checks, checks);
    return value;
  };
  marker(invoke(), "failed");
  fs.writeFileSync(workflow, control);
  marker(invoke(), "passed");
  const mutations = [
    ["unknown prerequisite", baseline, "native-workflow-schema-and-graph"],
    ["dependency cycle", control.replace("  build:\n", "  build:\n    needs: [consume]\n"), "native-workflow-schema-and-graph"],
    ["invalid permission", control.replace("contents: read", "contents: unrestricted"), "native-workflow-schema-and-graph"],
    ["artifact job output", control.replace("needs.build.outputs.artifact-id", "needs.build.outputs.missing"), "native-expression-contracts"],
    ["artifact action output", control.replace("steps.archive.outputs.artifact-id", "steps.archive.outputs.missing"), "native-expression-contracts"],
    ["failure function arity", control.replace("success()", "success('unexpected')"), "native-expression-contracts"],
    ["unavailable expression context", control.replace("runs-on: ubuntu-latest", "runs-on: ${{ steps.archive.outputs.artifact-id }}"), "native-expression-contracts"],
    ["untrusted script interpolation", control.replace('"$PR_TITLE"', '"${{ github.event.pull_request.title }}"'), "native-script-input-trust"],
    ["malformed YAML", control.replace("runs-on: ubuntu-latest", "runs-on: [ubuntu-latest"), "native-workflow-schema-and-graph"],
  ];
  for (const [label, source, check] of mutations) {
    await t.test(label, () => {
      assert.notEqual(source, control, label);
      fs.writeFileSync(workflow, source);
      const result = invoke();
      const value = marker(result, "failed");
      assert.ok(value.checks.includes(check), label + result.stdout + result.stderr);
      assert.match(result.stderr, /actionlint:\d+:\d+:/);
    });
  }
  fs.writeFileSync(workflow, control);
  await t.test("exported run specs retain native baseline and candidate acceptance evidence", async () => {
    const suite = loadBehavioralOracles();
    const oracle = suite.oracles.find(item => item.id === "pipeline-runtime");
    assert.ok(oracle);
    assert.deepEqual(oracle.command, { tool: "node", args: ["run-oracle.cjs"], timeout_ms: 120000 });
    assert.deepEqual(oracle.checks, checks);
    assert.deepEqual(oracle.files.map(file => file.path).sort(), files.filter(file => file !== ".gitignore").sort());
    const baselineDirectory = path.join(root, "baseline");
    fs.mkdirSync(baselineDirectory);
    for (const file of oracle.files) {
      fs.copyFileSync(path.join(fixture, file.path), path.join(baselineDirectory, file.path));
    }
    // Both evaluations use the exact packaged checker; only the candidate workflow is repaired.
    const specs = behavioralRunSpecs(oracle);
    const ids = {};
    let approvals = 0;
    for (const variant of ["baseline", "candidate"]) {
      const specFile = `${variant}.json`;
      fs.writeFileSync(path.join(root, specFile), JSON.stringify(specs[variant]));
      const spec = loadRunSpec(root, specFile);
      const report = await executeRunSpec(root, spec, {
        approveStep: async check => {
          assert.equal(check.tool, "node");
          assert.deepEqual(check.args, ["run-oracle.cjs"]);
          assert.equal(check.timeout_ms, 120000);
          approvals += 1;
          return true;
        },
      });
      const expectedStatus = variant === "baseline" ? "failed" : "passed";
      assert.equal(report.status, expectedStatus, JSON.stringify(report.checks));
      assert.equal(report.checks.length, 1);
      const retained = readEvaluation(root, report.id);
      assert.equal(retained.id, report.id);
      assert.equal(retained.checks[0].error, undefined, JSON.stringify(retained.checks));
      assert.equal(retained.checks[0].exit_code, variant === "baseline" ? 1 : 0);
      assert.equal(retained.checks[0].timeout_ms, 120000);
      const output = retained.checks[0].stdout_tail;
      assert.ok(output.length <= 2048 + "[truncated]\n".length);
      const value = marker({
        status: retained.checks[0].exit_code,
        stdout: output,
        stderr: retained.checks[0].stderr_tail,
      }, expectedStatus);
      const lastLine = output.trimEnd().split(/\r?\n/).at(-1);
      assert.equal(output.slice(-2048).trimEnd().split(/\r?\n/).at(-1), lastLine);
      // The exact retained native marker also survives a fully occupied output tail.
      assert.equal(("bounded diagnostic output\n".repeat(200) + output)
        .slice(-2048).trimEnd().split(/\r?\n/).at(-1), lastLine);
      if (variant === "baseline") {
        assert.ok(value.checks.includes("native-workflow-schema-and-graph"));
        assert.match(retained.checks[0].stderr_tail, /buid/);
      }
      ids[variant] = report.id;
    }
    assert.equal(approvals, 2);
    assert.notEqual(ids.baseline, ids.candidate);
    fs.writeFileSync(path.join(root, "results.json"), JSON.stringify({
      suite_id: suite.id, suite_sha256: suite.suite_sha256, catalog_sha256: suite.catalog_sha256,
      trials: [{
        oracle: oracle.id, baseline_validation_id: ids.baseline, candidate_validation_id: ids.candidate,
      }],
    }));
    const acceptance = buildBehavioralAcceptance(root, "results.json");
    assert.equal(acceptance.summary.checked_fixtures, 1);
    assert.equal(acceptance.summary.specialist_trials_certified, 0);
    assert.equal(acceptance.status, "incomplete");
    assert.deepEqual(acceptance.oracles.find(item => item.id === oracle.id).observation, {
      oracle: oracle.id, status: "checked-fixture",
      baseline_validation_id: ids.baseline, candidate_validation_id: ids.candidate,
      verified_checks: checks,
    });
  });
  await t.test("missing candidate is a setup error, not behavioral evidence", () => {
    fs.renameSync(workflow, workflow + ".missing");
    const result = invoke();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /MCPEE_ORACLE_SETUP_ERROR/);
    assert.doesNotMatch(result.stdout, /MCPEE_ORACLE_(RESULT|FAILURE) /);
    fs.renameSync(workflow + ".missing", workflow);
  });
  await t.test("corrupt cached archive is a setup error, not behavioral evidence", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(candidate, "toolchain.json"), "utf8"));
    const archive = path.join(candidate, ".oracle-tools", manifest.archives[`${process.platform}-${process.arch}`].file);
    fs.writeFileSync(archive, "not the pinned actionlint archive");
    const result = invoke();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MCPEE_ORACLE_SETUP_ERROR: Pinned actionlint archive SHA256 mismatch/);
    assert.doesNotMatch(result.stdout, /MCPEE_ORACLE_(RESULT|FAILURE) /);
  });
  for (const file of files) {
    assert.equal(hash(fs.readFileSync(path.join(fixture, file))), before.get(file), file);
    if (file !== "workflow.yml") {
      assert.equal(hash(fs.readFileSync(path.join(candidate, file))), before.get(file), file);
    }
  }
  assert.equal(fs.readdirSync(candidate).some(file => file.startsWith(".oracle-run-")), false);
});
