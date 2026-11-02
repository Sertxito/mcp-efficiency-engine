"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  loadBehavioralOracles, behavioralRunSpecs, buildBehavioralAcceptance,
} = require("../packages/evaluation-engine/src/behavioral-oracles");
const {
  loadRunSpec, executeRunSpec, readEvaluation,
} = require("../packages/evaluation-engine/src/evaluate");

const repository = path.resolve(__dirname, "..");
const fixture = path.join(repository, "templates", "specialist-acceptance", "azure-bicep-runtime");
const files = [
  ".gitignore", "README.md", "package.json", "package-lock.json",
  "azure-client.cjs", "main.bicep", "checks.cjs", "run-oracle.cjs",
];
const azureChecks = [
  "azure-sdk-load", "azure-list-pagination", "azure-request-page-size", "azure-transient-retry",
  "azure-permanent-error-propagation", "azure-abort-propagation",
];
const bicepChecks = [
  "bicep-compile", "storage-https-only", "storage-tls12", "storage-no-public-blobs",
  "storage-deny-network-default", "storage-output-resource-id", "storage-parameter-wiring",
];
const azureControl = `"use strict";

async function listContainerNames(service, abortSignal) {
  const names = [];
  for await (const page of service.listContainers({ abortSignal }).byPage({ maxPageSize: 2 })) {
    names.push(...page.containerItems.map(item => item.name));
  }
  return names;
}

module.exports = { listContainerNames };
`;

function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (["npm_config_allow_scripts", "node_test_context"].includes(key.toLowerCase())) delete env[key];
  }
  return env;
}

function restoreDependencies(directory) {
  const args = ["ci", "--ignore-scripts", "--no-audit", "--no-fund",
    "--cache", path.join(directory, ".npm-cache"), "--logs-dir", path.join(directory, ".npm-logs")];
  const npmCli = process.env.npm_execpath ||
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const result = fs.existsSync(npmCli)
    ? spawnSync(process.execPath, [npmCli, ...args], {
      cwd: directory, env: childEnv(), encoding: "utf8", timeout: 180000,
    })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      cwd: directory, env: childEnv(), encoding: "utf8", timeout: 180000, shell: process.platform === "win32",
    });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

function copyFixture(t, restore = true) {
  assert.deepEqual(fs.readdirSync(fixture).sort(), [...files].sort(), "all shipped files must be enumerated");
  const before = files.map(file => fs.readFileSync(path.join(fixture, file)));
  const directory = fs.mkdtempSync(path.join(repository, ".mcpee-azure-bicep-oracle-"));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [index, file] of files.entries()) {
      assert.deepEqual(fs.readFileSync(path.join(fixture, file)), before[index], `shipped fixture changed: ${file}`);
    }
    assert.deepEqual(fs.readdirSync(fixture).sort(), [...files].sort());
  });
  for (const file of files) fs.copyFileSync(path.join(fixture, file), path.join(directory, file));
  if (restore) restoreDependencies(directory);
  return directory;
}

function run(directory, mode, env = {}) {
  return spawnSync(process.execPath, ["run-oracle.cjs", mode], {
    cwd: directory, env: { ...childEnv(), ...env }, encoding: "utf8", timeout: 60000,
  });
}

function verify(result, id, status, checks) {
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  assert.equal(result.error, undefined, output);
  assert.equal(result.status, status === "passed" ? 0 : 1, output);
  assert.doesNotMatch(output, /MCPEE_ORACLE_SETUP_ERROR/, output);
  const prefix = status === "passed" ? "MCPEE_ORACLE_RESULT " : "MCPEE_ORACLE_FAILURE ";
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.filter(line => line.startsWith(prefix)).length, 1, output);
  assert.ok(lines.at(-1).startsWith(prefix), "marker must be last stdout line");
  assert.deepEqual(JSON.parse(lines.at(-1).slice(prefix.length)), { schema_version: 1, id, status, checks }, output);
  assert.doesNotMatch(output, status === "passed" ? /MCPEE_ORACLE_FAILURE / : /MCPEE_ORACLE_RESULT /);
}

function verifySetupError(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MCPEE_ORACLE_SETUP_ERROR/);
  assert.doesNotMatch(result.stdout, /MCPEE_ORACLE_(RESULT|FAILURE) /);
}

test("native Azure SDK controlled transport rejects baseline and pagination/error/cancellation mutations", t => {
  const directory = copyFixture(t);
  const source = path.join(directory, "azure-client.cjs");
  const baseline = fs.readFileSync(source, "utf8");
  verify(run(directory, "azure"), "azure-sdk-runtime", "failed", [
    "azure-list-pagination", "azure-request-page-size",
    "azure-permanent-error-propagation", "azure-abort-propagation",
  ]);
  fs.writeFileSync(source, azureControl);
  verify(run(directory, "azure", { NODE_TEST_CONTEXT: "child-v8", MCPEE_ORACLE_SOURCE_BASE64: "untrusted" }),
    "azure-sdk-runtime", "passed", azureChecks);
  const immutable = ["package.json", "package-lock.json", "checks.cjs", "run-oracle.cjs", "main.bicep"]
    .map(file => [file, fs.readFileSync(path.join(directory, file))]);
  for (const [label, mutant, failures] of [
    ["pagination", azureControl.replace("names.push(...page.containerItems.map(item => item.name));",
      "names.push(...page.containerItems.map(item => item.name)); break;"), ["azure-list-pagination"]],
    ["page size", azureControl.replace("maxPageSize: 2", "maxPageSize: 1"), ["azure-request-page-size"]],
    ["error swallowing", azureControl.replace("const names = [];", "try { const names = [];")
      .replace("return names;", "return names; } catch { return []; }"),
    ["azure-permanent-error-propagation", "azure-abort-propagation"]],
    ["cancellation", azureControl.replace("service.listContainers({ abortSignal })", "service.listContainers()"),
      ["azure-abort-propagation"]],
  ]) {
    assert.notEqual(mutant, azureControl, label);
    fs.writeFileSync(source, mutant);
    verify(run(directory, "azure"), "azure-sdk-runtime", "failed", failures);
  }
  fs.writeFileSync(source, "syntax error {{{");
  verifySetupError(run(directory, "azure"));
  fs.writeFileSync(source, azureControl);
  const sdk = path.join(directory, "node_modules", "@azure", "storage-blob");
  fs.renameSync(sdk, `${sdk}-unavailable`);
  verifySetupError(run(directory, "azure"));
  fs.renameSync(`${sdk}-unavailable`, sdk);
  for (const [file, bytes] of immutable) assert.deepEqual(fs.readFileSync(path.join(directory, file)), bytes, file);
  fs.writeFileSync(source, baseline);
});

test("pinned native Bicep emitted ARM contract rejects baseline and security/output mutations", t => {
  const executable = process.env.MCPEE_BICEP_PATH || "bicep";
  const tool = spawnSync(executable, ["--version"], { env: childEnv(), encoding: "utf8", timeout: 15000 });
  if (tool.error?.code === "ENOENT") return t.skip("Bicep 0.39.26 absent; native Bicep oracle not executed.");
  assert.equal(tool.error, undefined);
  assert.equal(tool.status, 0, `${tool.stdout}${tool.stderr}`);
  assert.match(tool.stdout, /^Bicep CLI version 0\.39\.26\b/, "install pinned Bicep 0.39.26; wrong tools are not behavioral failures");
  const directory = copyFixture(t);
  const source = path.join(directory, "main.bicep");
  const baseline = fs.readFileSync(source, "utf8");
  const control = baseline
    .replace("supportsHttpsTrafficOnly: false", "supportsHttpsTrafficOnly: true")
    .replace("minimumTlsVersion: 'TLS1_0'", "minimumTlsVersion: 'TLS1_2'")
    .replace("allowBlobPublicAccess: true", "allowBlobPublicAccess: false")
    .replace("defaultAction: 'Allow'", "defaultAction: 'Deny'")
    .replace("storageId string = storage.name", "storageId string = storage.id");
  verify(run(directory, "bicep"), "bicep-output-contract", "failed", [
    "storage-https-only", "storage-tls12", "storage-no-public-blobs",
    "storage-deny-network-default", "storage-output-resource-id",
  ]);
  fs.writeFileSync(source, control);
  verify(run(directory, "bicep"), "bicep-output-contract", "passed", bicepChecks);
  for (const [from, to, failure] of [
    ["supportsHttpsTrafficOnly: true", "supportsHttpsTrafficOnly: false", "storage-https-only"],
    ["minimumTlsVersion: 'TLS1_2'", "minimumTlsVersion: 'TLS1_0'", "storage-tls12"],
    ["allowBlobPublicAccess: false", "allowBlobPublicAccess: true", "storage-no-public-blobs"],
    ["defaultAction: 'Deny'", "defaultAction: 'Allow'", "storage-deny-network-default"],
    ["storageId string = storage.id", "storageId string = storage.name", "storage-output-resource-id"],
    ["location: location", "location: 'eastus'", "storage-parameter-wiring"],
  ]) {
    const mutant = control.replace(from, to);
    assert.notEqual(mutant, control, failure);
    fs.writeFileSync(source, mutant);
    verify(run(directory, "bicep"), "bicep-output-contract", "failed", [failure]);
  }
  fs.writeFileSync(source, "this is not valid Bicep {{{");
  verifySetupError(run(directory, "bicep"));
  fs.writeFileSync(source, control);
  verifySetupError(run(directory, "bicep", { MCPEE_BICEP_PATH: path.join(directory, "missing-bicep") }));
});

test("Azure and Bicep native commands produce real saved MCPEE behavioral acceptance evidence", async t => {
  const suite = loadBehavioralOracles();
  for (const [mode, id, mutable, checks] of [
    ["azure", "azure-sdk-runtime", "azure-client.cjs", azureChecks],
    ["bicep", "bicep-output-contract", "main.bicep", bicepChecks],
  ]) {
    await t.test(id, async t => {
      if (mode === "bicep") {
        const tool = spawnSync(process.env.MCPEE_BICEP_PATH || "bicep", ["--version"], {
          env: childEnv(), encoding: "utf8", timeout: 15000,
        });
        if (tool.error?.code === "ENOENT") return t.skip("Bicep 0.39.26 absent; native MCPEE Bicep integration not executed.");
        assert.equal(tool.error, undefined);
        assert.equal(tool.status, 0, `${tool.stdout}${tool.stderr}`);
        assert.match(tool.stdout, /^Bicep CLI version 0\.39\.26\b/);
      }
      const oracle = suite.oracles.find(item => item.id === id);
      assert.ok(oracle, `packaged registry must declare ${id}`);
      assert.deepEqual(oracle.mutable, [mutable]);
      assert.deepEqual(oracle.files.map(file => file.path).sort(), files.filter(file => file !== ".gitignore").sort());
      assert.deepEqual(oracle.checks, checks);
      assert.deepEqual(oracle.command, {
        tool: "node", args: ["run-oracle.cjs", mode], timeout_ms: 60000,
      });
      const root = copyFixture(t, false);
      for (const variant of ["baseline", "candidate"]) {
        const directory = path.join(root, variant);
        fs.mkdirSync(directory);
        for (const file of files) fs.copyFileSync(path.join(fixture, file), path.join(directory, file));
        restoreDependencies(directory);
      }
      const candidate = path.join(root, "candidate", mutable);
      const baseline = fs.readFileSync(candidate, "utf8");
      const control = mode === "azure" ? azureControl : baseline
        .replace("supportsHttpsTrafficOnly: false", "supportsHttpsTrafficOnly: true")
        .replace("minimumTlsVersion: 'TLS1_0'", "minimumTlsVersion: 'TLS1_2'")
        .replace("allowBlobPublicAccess: true", "allowBlobPublicAccess: false")
        .replace("defaultAction: 'Allow'", "defaultAction: 'Deny'")
        .replace("storageId string = storage.name", "storageId string = storage.id");
      fs.writeFileSync(candidate, control);
      const specs = behavioralRunSpecs(oracle);
      let approvals = 0;
      const reports = {};
      const execute = async variant => {
        const file = `${variant}.json`;
        fs.writeFileSync(path.join(root, file), JSON.stringify(specs[variant]));
        const report = await executeRunSpec(root, loadRunSpec(root, file), {
          approveStep: async check => {
            assert.equal(check.tool, "node");
            assert.deepEqual(check.args, ["run-oracle.cjs", mode]);
            assert.equal(check.cwd, variant);
            assert.equal(check.timeout_ms, 60000);
            approvals += 1;
            return true;
          },
        });
        const { task_proposals, learning_proposals, file: savedFile, ...persisted } = report;
        assert.ok(fs.existsSync(path.join(root, savedFile)), "real evaluator must save its report");
        assert.deepEqual(readEvaluation(root, report.id), persisted, "saved native evidence must match the executed report");
        return report;
      };
      for (const variant of ["baseline", "candidate"]) {
        const report = await execute(variant);
        const check = report.checks[0];
        const diagnostic = JSON.stringify(report.checks);
        assert.equal(report.status, variant === "baseline" ? "failed" : "passed", diagnostic);
        assert.equal(check.error, undefined, diagnostic);
        assert.equal(check.exit_code, variant === "baseline" ? 1 : 0, diagnostic);
        assert.doesNotMatch(`${check.stdout_tail}\n${check.stderr_tail}`, /MCPEE_ORACLE_SETUP_ERROR/, diagnostic);
        const prefix = variant === "baseline" ? "MCPEE_ORACLE_FAILURE " : "MCPEE_ORACLE_RESULT ";
        const lastLine = check.stdout_tail.trim().split(/\r?\n/).at(-1);
        assert.ok(lastLine.startsWith(prefix), diagnostic);
        const marker = JSON.parse(lastLine.slice(prefix.length));
        assert.equal(marker.id, id);
        assert.equal(marker.schema_version, 1);
        assert.ok(marker.checks.length > 0);
        assert.ok(marker.checks.every(name => checks.includes(name)));
        assert.doesNotMatch(check.stdout_tail, variant === "baseline"
          ? /MCPEE_ORACLE_RESULT / : /MCPEE_ORACLE_FAILURE /);
        if (variant === "candidate") assert.deepEqual(marker.checks, checks);
        if (mode === "bicep" && variant === "baseline") {
          assert.ok(!marker.checks.includes("bicep-compile"), "baseline must compile before emitted-output assertions fail");
          assert.ok(marker.checks.includes("storage-https-only"));
        }
        assert.ok(lastLine.length < 2048, "complete marker must fit the evaluator's 2048-character tail");
        assert.equal(("irrelevant diagnostics\n".repeat(200) + check.stdout_tail)
          .slice(-2048).trim().split(/\r?\n/).at(-1), lastLine);
        reports[variant] = report;
      }
      const input = {
        suite_id: suite.id, suite_sha256: suite.suite_sha256, catalog_sha256: suite.catalog_sha256,
        trials: [{
          oracle: id, baseline_validation_id: reports.baseline.id, candidate_validation_id: reports.candidate.id,
        }],
      };
      fs.writeFileSync(path.join(root, "results.json"), JSON.stringify(input));
      const acceptance = buildBehavioralAcceptance(root, "results.json");
      assert.equal(acceptance.summary.checked_fixtures, 1);
      assert.equal(acceptance.summary.specialist_trials_certified, 0);
      assert.equal(acceptance.status, "incomplete");
      const observation = acceptance.oracles.find(item => item.id === id).observation;
      assert.equal(observation.status, "checked-fixture");
      assert.deepEqual(observation.verified_checks, checks);
      assert.equal(approvals, 2);

      fs.writeFileSync(candidate, "invalid syntax {{{");
      const setup = await execute("candidate");
      assert.equal(setup.status, "failed");
      assert.equal(setup.checks[0].exit_code, 1);
      assert.match(setup.checks[0].stderr_tail, /MCPEE_ORACLE_SETUP_ERROR/);
      assert.doesNotMatch(setup.checks[0].stdout_tail, /MCPEE_ORACLE_(RESULT|FAILURE) /);
      input.trials[0].candidate_validation_id = setup.id;
      fs.writeFileSync(path.join(root, "setup-results.json"), JSON.stringify(input));
      assert.throws(() => buildBehavioralAcceptance(root, "setup-results.json"), /setup errors/i,
        "real setup/compilation failures must never become behavioral acceptance");
      fs.writeFileSync(candidate, control);
      assert.equal(buildBehavioralAcceptance(root, "results.json").summary.checked_fixtures, 1);
      assert.equal(approvals, 3);
    });
  }
});
