"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  loadBehavioralOracles, behavioralOracleTask, behavioralRunSpecs, buildBehavioralAcceptance,
} = require("../packages/evaluation-engine/src/behavioral-oracles");
const { sourceEvidence } = require("../packages/memory-engine/src/memory");

const fixtureRoot = path.resolve(__dirname, "../templates/specialist-acceptance");
function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-native-evidence-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return root;
}
function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
function records(t, oracleId = "python-resource-lifetime") {
  const root = project(t);
  const suite = loadBehavioralOracles();
  const oracle = suite.oracles.find(item => item.id === oracleId);
  const ids = { baseline: crypto.randomUUID(), candidate: crypto.randomUUID() };
  const reports = {};
  for (const directory of ["baseline", "candidate"]) {
    for (const file of oracle.files) {
      const destination = path.join(root, directory, file.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(fixtureRoot, oracle.fixture, file.path), destination);
    }
    const baseline = directory === "baseline";
    const spec = behavioralRunSpecs(oracle)[directory];
    reports[directory] = {
      schema_version: 1, generated_by: "mcpee", id: ids[directory],
      task: behavioralOracleTask(oracle), status: baseline ? "failed" : "passed",
      evidence: sourceEvidence(root, spec.evidence),
      checks: [{
        ...spec.checks[0], duration_ms: 10,
        status: baseline ? "failed" : "passed", exit_code: baseline ? 1 : 0,
        stdout_tail: baseline ? `MCPEE_ORACLE_FAILURE ${JSON.stringify({
          schema_version: 1, id: oracle.id,
          ...(oracle.failure_output === "assertion"
            ? { check: oracle.checks[0], message: "Known behavioral assertion" }
            : oracle.failure_output === "check-list"
              ? { status: "failed", checks: [oracle.checks.find(id => id !== "ts-typecheck")] }
              : { status: "failed", tests_run: oracle.checks.length, failures: 1, errors: 0 }),
        })}\n` : `MCPEE_ORACLE_RESULT ${JSON.stringify({
          schema_version: 1, id: oracle.id, status: "passed", checks: oracle.checks,
        })}\n`,
        stderr_tail: baseline ? "FAIL: test_order_and_capacity\nFAILED (failures=1)" : "",
      }],
    };
  }
  const input = {
    suite_id: suite.id, suite_sha256: suite.suite_sha256, catalog_sha256: suite.catalog_sha256,
    trials: [{ oracle: oracle.id, baseline_validation_id: ids.baseline, candidate_validation_id: ids.candidate }],
  };
  const reportPath = directory => `.mcpee/reports/evaluations/${ids[directory]}.json`;
  const save = () => {
    for (const directory of ["baseline", "candidate"]) write(root, reportPath(directory), reports[directory]);
    write(root, "native-results.json", input);
  };
  save();
  return { root, oracle, input, reports, save, reportPath };
}

test("native inventory never confuses static technology probes with native runtime coverage", t => {
  const root = project(t);
  const suite = loadBehavioralOracles();
  assert.equal(suite.technologies.length, 14);
  assert.ok(suite.oracles.some(item => item.id === "node-bounded-operation"));
  assert.ok(suite.oracles.some(item => item.id === "python-resource-lifetime"));
  assert.ok(suite.technologies.every(item => item.status === "fixture-available"));
  assert.equal(suite.oracles.length, 13);
  const report = buildBehavioralAcceptance(root);
  assert.equal(report.status, "incomplete");
  assert.equal(report.summary.checked_fixtures, 0);
  assert.equal(report.summary.specialist_trials_certified, 0);
  assert.equal(report.summary.technologies_with_native_fixtures + report.summary.missing_native_fixtures, 14);
  assert.equal(report.summary.not_run, suite.oracles.length);
  for (const id of ["angular-runtime", "react-runtime", "vue-runtime", "dotnet-api-data-change", "sql-result-semantics", "terraform-local-lifecycle", "pipeline-runtime", "aws-sdk-runtime", "azure-sdk-runtime", "bicep-output-contract", "cosmos-sdk-runtime"]) {
    assert.ok(suite.oracles.some(oracle => oracle.id === id), id);
  }
  assert.ok(suite.technologies.find(item => item.guide === "typescript-engineering").native_oracles.length > 0);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("native structured failure markers bind known assertions rather than setup errors", t => {
  for (const { id } of loadBehavioralOracles().oracles.filter(oracle =>
    ["check-list", "assertion"].includes(oracle.failure_output))) {
    const f = records(t, id);
    assert.equal(buildBehavioralAcceptance(f.root, "native-results.json").summary.checked_fixtures, 1);
    for (const payload of [
      { schema_version: 1, id: "wrong-oracle", status: "failed", checks: ["input-immutability"] },
      { schema_version: 1, id, status: "failed", checks: ["ts-typecheck"] },
      { schema_version: 1, id, status: "failed", checks: [], check: "restore-failed", message: "Missing SDK" },
    ]) {
      f.reports.baseline.checks[0].stdout_tail = `MCPEE_ORACLE_FAILURE ${JSON.stringify(payload)}`;
      f.save();
      assert.throws(() => buildBehavioralAcceptance(f.root, "native-results.json"), id);
    }
  }
});

test("native evidence reader requires separate task-bound current baseline and complete candidate evidence", t => {
  const f = records(t);
  const report = buildBehavioralAcceptance(f.root, "native-results.json");
  assert.equal(report.summary.checked_fixtures, 1, "synthetic reader records are not a model execution");
  assert.equal(report.summary.specialist_trials_certified, 0);
  assert.equal(report.status, "incomplete");
  f.reports.baseline.checks[0].stdout_tail = `MCPEE_ORACLE_FAILURE ${JSON.stringify({
    schema_version: 1, id: f.oracle.id, status: "failed",
    tests_run: f.oracle.checks.length, failures: 12, errors: 0,
  })}`;
  f.save();
  assert.equal(buildBehavioralAcceptance(f.root, "native-results.json").summary.checked_fixtures, 1,
    "unittest subtest failures may outnumber test methods");
  const originals = structuredClone(f.reports);
  for (const mutate of [
    reports => { reports.candidate.task = "unrelated green build"; },
    reports => { reports.candidate.checks[0].args.push("--filtered"); },
    reports => { reports.candidate.checks[0].duration_ms = reports.candidate.checks[0].timeout_ms; },
    reports => { reports.candidate.checks[0].error = "timeout"; },
    reports => { reports.candidate.checks[0].stdout_tail = ""; },
    reports => { reports.candidate.checks[0].stdout_tail += reports.candidate.checks[0].stdout_tail; },
    reports => { reports.candidate.checks[0].stdout_tail = 'MCPEE_ORACLE_RESULT {"id":"forged"}'; },
    reports => { reports.candidate.checks[0].exit_code = 1; },
    reports => { reports.candidate.checks[0].status = "skipped"; },
    reports => { reports.candidate.checks[0].stdout_tail += '\nMCPEE_ORACLE_FAILURE {"status":"failed"}'; },
    reports => { reports.candidate.checks[0].stderr_tail = "MCPEE_ORACLE_SETUP_ERROR: missing dependency"; },
    reports => { reports.baseline.checks[0].stderr_tail = "MCPEE_ORACLE_SETUP_ERROR: compiler failed"; },
    reports => {
      reports.baseline.checks[0].stdout_tail = "";
      reports.baseline.checks[0].stderr_tail = "command not found";
    },
    reports => {
      reports.baseline.checks[0].stdout_tail = "MCPEE_ORACLE_FAILURE not-json";
    },
    reports => {
      reports.baseline.checks[0].stdout_tail = `MCPEE_ORACLE_FAILURE ${JSON.stringify({
        schema_version: 1, id: f.oracle.id, status: "failed", tests_run: 1, failures: 1, errors: 0,
      })}`;
    },
    reports => {
      reports.baseline.checks[0].stdout_tail += `\n${reports.baseline.checks[0].stdout_tail}`;
    },
    reports => { reports.baseline.checks[0].exit_code = 127; },
    reports => { reports.baseline.status = "passed"; },
    reports => { reports.candidate.evidence.pop(); },
    reports => { delete reports.candidate.evidence[0].sha256; },
    reports => { reports.candidate.evidence[0].sha256 = "stale"; },
    reports => { reports.candidate.evidence.push(reports.candidate.evidence[0]); },
  ]) {
    Object.assign(f.reports, structuredClone(originals));
    mutate(f.reports);
    f.save();
    assert.throws(() => buildBehavioralAcceptance(f.root, "native-results.json"));
  }
  Object.assign(f.reports, structuredClone(originals));
  f.save();
  const checker = path.join(f.root, "candidate", "checks.py");
  fs.appendFileSync(checker, "\n# weakened checker\n");
  assert.throws(() => buildBehavioralAcceptance(f.root, "native-results.json"), /evidence changed/);
  f.reports.candidate.evidence = sourceEvidence(f.root, ["candidate/worker.py", "candidate/checks.py"]);
  f.save();
  assert.throws(() => buildBehavioralAcceptance(f.root, "native-results.json"), /oracle or baseline changed/);
});

test("native manifests reject stale digests, unknown or duplicate oracles and reused evaluations", t => {
  const f = records(t);
  const original = structuredClone(f.input);
  for (const mutate of [
    input => { input.suite_sha256 = "0".repeat(64); },
    input => { input.catalog_sha256 = "0".repeat(64); },
    input => { input.trials[0].oracle = "accept-any-technology"; },
    input => { input.trials.push(input.trials[0]); },
    input => { input.trials[0].baseline_validation_id = input.trials[0].candidate_validation_id; },
  ]) {
    const input = structuredClone(original);
    mutate(input);
    write(f.root, "native-results.json", input);
    assert.throws(() => buildBehavioralAcceptance(f.root, "native-results.json"));
  }
});

test("every registered native oracle exports complete source-bound baseline and candidate specifications", () => {
  for (const oracle of loadBehavioralOracles().oracles) {
    assert.ok(oracle.mutable.length > 0, oracle.id);
    assert.ok(oracle.immutable.length > 0, oracle.id);
    const files = [...oracle.mutable, ...oracle.immutable];
    assert.equal(new Set(files).size, files.length, oracle.id);
    assert.deepEqual(oracle.files.map(file => file.path), files, oracle.id);
    const specs = behavioralRunSpecs(oracle);
    for (const variant of ["baseline", "candidate"]) {
      assert.equal(specs[variant].task, behavioralOracleTask(oracle));
      assert.deepEqual(specs[variant].evidence, files.map(file => `${variant}/${file}`));
      assert.deepEqual(specs[variant].checks, [{
        id: oracle.id, label: oracle.scope, ...oracle.command, cwd: variant,
      }]);
    }
  }
});

test("native CLI exports exact checks without initializing a project or executing them", t => {
  const root = project(t);
  const cli = path.resolve(__dirname, "../packages/cli/bin/mcpee.js");
  const run = args => spawnSync(process.execPath, [
    cli, "evaluate", "--suite", "technology-runtime", "--project", root, "--json", ...args,
  ], { encoding: "utf8", timeout: 30000 });
  const inspected = run([]);
  assert.equal(inspected.status, 2, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).summary.specialist_trials_certified, 0);
  for (const variant of ["baseline", "candidate"]) {
    const exported = run(["--scenario", "python-resource-lifetime", "--variant", variant]);
    assert.equal(exported.status, 0, exported.stderr);
    const result = JSON.parse(exported.stdout);
    assert.equal(result.evaluation_spec.task, behavioralOracleTask(result.oracle));
    assert.deepEqual(result.evaluation_spec.checks[0].args, ["-B", "checks.py"]);
    assert.ok(result.evaluation_spec.evidence.includes(`${variant}/checks.py`));
  }
  assert.equal(run(["--scenario", "python-resource-lifetime", "--variant", "normal"]).status, 1);
  assert.equal(run(["--scenario", "not-an-oracle", "--variant", "candidate"]).status, 1);
  assert.equal(run(["--run", "spec.json"]).status, 1);
  assert.deepEqual(fs.readdirSync(root), []);
});
