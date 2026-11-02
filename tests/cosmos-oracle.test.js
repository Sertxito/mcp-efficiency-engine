"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  loadBehavioralOracles,
  behavioralRunSpecs,
  buildBehavioralAcceptance,
} = require("../packages/evaluation-engine/src/behavioral-oracles");
const { loadRunSpec, executeRunSpec, readEvaluation } = require("../packages/evaluation-engine/src/evaluate");

const fixture = path.resolve(__dirname, "../templates/specialist-acceptance/cosmos-sdk-runtime");
const control = `"use strict";

async function createItem(container, item) {
  return container.items.create(item);
}

async function readItem(container, id, partitionKey) {
  return container.item(id, partitionKey).read();
}

async function readItems(container, { partitionKey, maxItemCount = 2, signal } = {}) {
  const iterator = container.items.readAll({
    partitionKey,
    maxItemCount,
    abortSignal: signal,
  });
  const items = [];
  while (iterator.hasMoreResults()) {
    const page = await iterator.fetchNext();
    items.push(...page.resources);
  }
  return items;
}

module.exports = { createItem, readItem, readItems };
`;

function filesUnder(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory()
      ? filesUnder(path.join(directory, entry.name), relative)
      : [relative.replaceAll(path.sep, "/")];
  }).sort();
}

function environmentWithout(source, blockedNames) {
  const blocked = new Set(blockedNames.map(name => name.toLowerCase()));
  return Object.fromEntries(Object.entries(source).filter(([key]) => !blocked.has(key.toLowerCase())));
}

function parseMarker(stdout, prefix) {
  const markerLines = stdout.split(/\r?\n/).filter(line => line.startsWith(prefix));
  assert.equal(markerLines.length, 1, stdout);
  assert.equal(stdout.trimEnd().split(/\r?\n/).at(-1), markerLines[0], "marker must be the final stdout line");
  return JSON.parse(markerLines[0].slice(prefix.length));
}

function runOracle(directory, env) {
  return spawnSync(process.execPath, ["run-oracle.cjs"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    env,
  });
}

function installDependencies(directory, workspace, npmConfig, npmCache) {
  const env = environmentWithout({
    ...process.env,
    npm_config_allow_scripts: "false",
    NPM_CONFIG_ALLOW_SCRIPTS: "false",
    npm_config_cache: npmCache,
    npm_config_userconfig: npmConfig,
    npm_config_registry: "https://registry.npmjs.org/",
    TEMP: workspace,
    TMP: workspace,
  }, ["npm_config_allow_scripts"]);
  const install = spawnSync("npm", [
    "ci",
    "--no-audit",
    "--no-fund",
    "--registry=https://registry.npmjs.org/",
    `--cache=${npmCache}`,
    `--userconfig=${npmConfig}`,
  ], {
    cwd: directory,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 2 * 1024 * 1024,
    env,
    shell: process.platform === "win32",
  });
  assert.equal(install.error, undefined, install.stderr || install.stdout);
  assert.equal(install.status, 0, install.stdout + install.stderr);
}

test("native Cosmos SDK oracle executes local HTTP semantics and rejects behavioral mutations", async t => {
  const originalFiles = filesUnder(fixture);
  const oracle = JSON.parse(fs.readFileSync(path.join(fixture, "oracle.json"), "utf8"));
  const packagedFiles = [...oracle.files.immutable, ...oracle.files.mutable].sort();
  assert.deepEqual(packagedFiles, originalFiles, "oracle.json must enumerate every packaged fixture file");
  assert.equal(oracle.id, "cosmos-sdk-runtime");
  assert.equal(oracle.guide, "cosmos-engineering");
  const packageJson = JSON.parse(fs.readFileSync(path.join(fixture, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(fixture, "package-lock.json"), "utf8"));
  assert.equal(packageJson.dependencies["@azure/cosmos"], "4.10.1");
  assert.equal(lock.packages["node_modules/@azure/cosmos"].version, "4.10.1");
  assert.deepEqual(oracle.checks, [
    "write-partition-key-routing",
    "point-read-partition-key-routing",
    "continuation-pagination",
    "request-cancellation",
    "point-read-not-found-response",
    "query-error-propagation",
  ]);
  assert.ok(oracle.files.mutable.includes("solution.cjs"));
  assert.ok(oracle.files.immutable.includes("checks.cjs"));

  const fixtureSnapshot = new Map(originalFiles.map(file => [
    file,
    fs.readFileSync(path.join(fixture, file)),
  ]));
  const workspace = fs.mkdtempSync(path.join(__dirname, ".cosmos-oracle-work-"));
  const candidate = path.join(workspace, "candidate");
  fs.cpSync(fixture, candidate, { recursive: true });
  const npmConfig = path.join(workspace, "npmrc");
  const npmCache = path.join(workspace, "npm-cache");
  fs.writeFileSync(npmConfig, "");

  t.after(() => {
    try {
      for (const [file, contents] of fixtureSnapshot) {
        assert.deepEqual(fs.readFileSync(path.join(fixture, file)), contents, `${file} is immutable in place`);
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  installDependencies(candidate, workspace, npmConfig, npmCache);
  for (const file of oracle.files.immutable) {
    assert.deepEqual(fs.readFileSync(path.join(candidate, file)), fixtureSnapshot.get(file),
      `${file} stays immutable in the isolated copy`);
  }

  const testEnvironment = {
    ...process.env,
    NODE_TEST_CONTEXT: "inherited-test-runner-state",
    TEMP: workspace,
    TMP: workspace,
  };
  const baseline = runOracle(candidate, testEnvironment);
  assert.equal(baseline.error, undefined, baseline.stderr);
  assert.equal(baseline.status, 1, baseline.stdout + baseline.stderr);
  assert.doesNotMatch(baseline.stderr, /MCPEE_ORACLE_SETUP_ERROR/);
  assert.doesNotMatch(baseline.stdout, /MCPEE_ORACLE_RESULT /);
  const baselineFailure = parseMarker(baseline.stdout, "MCPEE_ORACLE_FAILURE ");
  assert.equal(baselineFailure.id, oracle.id);
  assert.equal(baselineFailure.status, "failed");
  assert.ok(baselineFailure.checks.length > 0);
  assert.ok(baselineFailure.checks.every(check => oracle.checks.includes(check)));

  const solution = path.join(candidate, "solution.cjs");
  fs.writeFileSync(solution, control);
  const repaired = runOracle(candidate, testEnvironment);
  assert.equal(repaired.error, undefined, repaired.stderr);
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  assert.doesNotMatch(repaired.stderr, /MCPEE_ORACLE_SETUP_ERROR/);
  assert.doesNotMatch(repaired.stdout, /MCPEE_ORACLE_FAILURE /);
  const success = parseMarker(repaired.stdout, "MCPEE_ORACLE_RESULT ");
  assert.deepEqual(success, {
    schema_version: 1,
    id: oracle.id,
    status: "passed",
    checks: oracle.checks,
  });

  const mutants = [
    ["wrong create partition value", "write-partition-key-routing", control.replace(
      "return container.items.create(item);",
      'return container.items.create({ ...item, tenantId: "wrong-tenant" });',
    )],
    ["missing point-read partition key", "point-read-partition-key-routing", control.replace(
      "container.item(id, partitionKey).read()",
      "container.item(id).read()",
    )],
    ["stop after first page", "continuation-pagination", control.replace(
      "while (iterator.hasMoreResults())",
      "if (iterator.hasMoreResults())",
    )],
    ["ignore cancellation", "request-cancellation", control.replace(
      "abortSignal: signal,",
      "maxItemCount,",
    )],
    ["swallow query errors", "query-error-propagation", control.replace(
      "  const iterator = container.items.readAll({",
      "  try { const iterator = container.items.readAll({",
    ).replace(
      "  return items;\n}",
      "  return items; } catch { return []; }\n}",
    )],
    ["drop requested page size", "continuation-pagination", control.replace(
      "    maxItemCount,",
      "    maxItemCount: undefined,",
    )],
  ];

  for (const [label, expectedFailure, mutant] of mutants) {
    assert.notEqual(mutant, control, label);
    fs.writeFileSync(solution, mutant);
    const failed = runOracle(candidate, testEnvironment);
    assert.equal(failed.error, undefined, `${label}: ${failed.stderr}`);
    assert.equal(failed.status, 1, `${label}: ${failed.stdout}${failed.stderr}`);
    assert.doesNotMatch(failed.stderr, /MCPEE_ORACLE_SETUP_ERROR/, label);
    assert.doesNotMatch(failed.stdout, /MCPEE_ORACLE_RESULT /, label);
    const failure = parseMarker(failed.stdout, "MCPEE_ORACLE_FAILURE ");
    assert.equal(failure.id, oracle.id, label);
    assert.equal(failure.status, "failed", label);
    assert.ok(failure.checks.length > 0, label);
    assert.ok(failure.checks.every(check => oracle.checks.includes(check)), label);
    assert.ok(failure.checks.includes(expectedFailure), `${label}: ${failure.checks.join(", ")}`);
  }

  const sdkPath = path.join(candidate, "node_modules", "@azure", "cosmos");
  const hiddenSdkPath = path.join(candidate, "node_modules", "@azure", "cosmos-disabled");
  fs.renameSync(sdkPath, hiddenSdkPath);
  try {
    const missingDependency = runOracle(candidate, testEnvironment);
    assert.equal(missingDependency.error, undefined, missingDependency.stderr);
    assert.equal(missingDependency.status, 1, missingDependency.stdout + missingDependency.stderr);
    assert.match(missingDependency.stderr, /MCPEE_ORACLE_SETUP_ERROR/);
    assert.doesNotMatch(missingDependency.stdout, /MCPEE_ORACLE_(RESULT|FAILURE) /);
  } finally {
    fs.renameSync(hiddenSdkPath, sdkPath);
  }

  fs.writeFileSync(solution, control);
  const suite = loadBehavioralOracles();
  const registeredOracle = suite.oracles.find(item => item.id === oracle.id);
  assert.ok(registeredOracle, "the integrated behavioral registry must include the Cosmos fixture");
  assert.deepEqual(registeredOracle.checks, oracle.checks);
  assert.deepEqual(registeredOracle.mutable, ["solution.cjs"]);
  const specs = behavioralRunSpecs(registeredOracle);
  const baselineDirectory = path.join(workspace, "baseline");
  fs.mkdirSync(baselineDirectory);
  for (const file of registeredOracle.files) {
    const destination = path.join(baselineDirectory, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(fixture, file.path), destination);
  }
  installDependencies(baselineDirectory, workspace, npmConfig, npmCache);
  fs.writeFileSync(path.join(workspace, "baseline-run.json"), JSON.stringify(specs.baseline));
  fs.writeFileSync(path.join(workspace, "candidate-run.json"), JSON.stringify(specs.candidate));

  let approvals = 0;
  const validationIds = {};
  for (const variant of ["baseline", "candidate"]) {
    const spec = loadRunSpec(workspace, `${variant}-run.json`);
    const report = await executeRunSpec(workspace, spec, {
      approveStep: async check => {
        assert.equal(check.tool, "node");
        assert.deepEqual(check.args, ["run-oracle.cjs"]);
        assert.equal(check.cwd, variant);
        assert.equal(check.timeout_ms, 120000);
        approvals += 1;
        return true;
      },
    });
    const expectedStatus = variant === "baseline" ? "failed" : "passed";
    const expectedExit = variant === "baseline" ? 1 : 0;
    assert.equal(report.status, expectedStatus, JSON.stringify(report.checks));
    assert.equal(report.checks.length, 1);
    assert.equal(report.checks[0].status, expectedStatus);
    assert.equal(report.checks[0].exit_code, expectedExit);
    assert.equal(report.checks[0].error, undefined);
    assert.equal(report.checks[0].tool, "node");
    assert.deepEqual(report.checks[0].args, ["run-oracle.cjs"]);
    assert.equal(report.checks[0].timeout_ms, 120000);
    assert.ok(report.checks[0].duration_ms < 120000);
    const stdout = report.checks[0].stdout_tail;
    assert.ok(stdout.replace(/^\[truncated\]\n/, "").length <= 2048);
    assert.ok(stdout.length <= 2060);
    assert.doesNotMatch(`${stdout}\n${report.checks[0].stderr_tail}`, /MCPEE_ORACLE_SETUP_ERROR/);
    if (variant === "baseline") {
      assert.match(stdout, /MCPEE_ORACLE_FAILURE /);
      assert.doesNotMatch(stdout, /MCPEE_ORACLE_RESULT /);
      const failure = parseMarker(stdout, "MCPEE_ORACLE_FAILURE ");
      assert.deepEqual(failure, {
        schema_version: 1,
        id: oracle.id,
        status: "failed",
        checks: [
          "write-partition-key-routing",
          "point-read-partition-key-routing",
          "continuation-pagination",
          "request-cancellation",
          "point-read-not-found-response",
        ],
      });
    } else {
      assert.doesNotMatch(stdout, /MCPEE_ORACLE_FAILURE /);
      assert.deepEqual(parseMarker(stdout, "MCPEE_ORACLE_RESULT "), {
        schema_version: 1,
        id: oracle.id,
        status: "passed",
        checks: oracle.checks,
      });
    }

    validationIds[variant] = report.id;
    const persisted = readEvaluation(workspace, report.id);
    assert.equal(persisted.id, report.id);
    assert.equal(persisted.status, expectedStatus);
    assert.equal(persisted.checks[0].exit_code, expectedExit);
    assert.deepEqual(persisted.evidence, report.evidence);
    for (const file of persisted.evidence) {
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
    }
  }
  assert.equal(approvals, 2);

  const resultManifest = {
    suite_id: suite.id,
    suite_sha256: suite.suite_sha256,
    catalog_sha256: suite.catalog_sha256,
    trials: [{
      oracle: oracle.id,
      baseline_validation_id: validationIds.baseline,
      candidate_validation_id: validationIds.candidate,
    }],
  };
  fs.writeFileSync(path.join(workspace, "native-results.json"), JSON.stringify(resultManifest));
  const accepted = buildBehavioralAcceptance(workspace, "native-results.json");
  assert.equal(accepted.summary.checked_fixtures, 1);
  assert.equal(accepted.summary.specialist_trials_certified, 0);
  assert.equal(accepted.status, "incomplete");
  const observation = accepted.oracles.find(item => item.id === oracle.id).observation;
  assert.equal(observation.status, "checked-fixture");
  assert.deepEqual(observation.verified_checks, oracle.checks);
});
