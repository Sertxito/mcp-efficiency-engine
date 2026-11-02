"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  loadBehavioralOracles, behavioralOracleTask, behavioralRunSpecs, buildBehavioralAcceptance,
} = require("../packages/evaluation-engine/src/behavioral-oracles");
const { evaluateExecution, readEvaluation } = require("../packages/evaluation-engine/src/evaluate");

const fixture = path.resolve(__dirname, "../templates/specialist-acceptance/aws-sdk-runtime");
const immutable = [
  "package.json", "package-lock.json", "run-oracle.cjs", "checks.cjs", "transport.cjs", "README.md",
];
const inventory = [...immutable, "scanner.cjs"];
const checks = [
  "native-pagination", "stable-aggregation", "empty-results", "inflight-cancellation",
  "preaborted-cancellation", "service-failure-propagation", "owned-transport-cleanup",
  "borrowed-client-ownership",
];
const control = `"use strict";
const { DynamoDBClient, paginateScan } = require("@aws-sdk/client-dynamodb");

async function scanTable({ tableName, signal, requestHandler, client }) {
  const active = client || new DynamoDBClient({
    region: "us-east-1",
    credentials: { accessKeyId: "LOCAL_ONLY", secretAccessKey: "LOCAL_ONLY" },
    endpoint: "http://127.0.0.1:1",
    requestHandler,
    maxAttempts: 1,
  });
  try {
    const rows = new Map();
    for await (const page of paginateScan({ client: active }, { TableName: tableName }, { abortSignal: signal })) {
      for (const item of page.Items || []) {
        if (!rows.has(item.pk.S)) rows.set(item.pk.S, { id: item.pk.S, name: item.name.S });
      }
    }
    return [...rows.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  } finally {
    if (!client) active.destroy();
  }
}
module.exports = { scanTable };
`;

function environment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^npm_config_allow_scripts$/i.test(key) && !/^NODE_TEST_CONTEXT$/i.test(key)));
}

function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const found = candidates.find(file => file && fs.existsSync(file));
  assert.ok(found, "npm CLI must be available to install each disposable fixture");
  return found;
}

function parseMarker(result, prefix) {
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  assert.equal(result.error, undefined, output);
  const lines = result.stdout.trimEnd().split(/\r?\n/);
  assert.ok(lines.at(-1).startsWith(prefix), output);
  assert.equal(lines.filter(line => line.startsWith(prefix)).length, 1, output);
  assert.doesNotMatch(output, /MCPEE_ORACLE_SETUP_ERROR/, output);
  return JSON.parse(lines.at(-1).slice(prefix.length));
}

test("AWS SDK native transport baseline, repaired control and semantic mutations", { timeout: 600000 }, async t => {
  const before = new Map(inventory.map(file => [file, fs.readFileSync(path.join(fixture, file))]));
  const originalEntries = fs.readdirSync(fixture).sort();
  const root = fs.mkdtempSync(path.join(__dirname, ".aws-oracle-cases-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    assert.deepEqual(fs.readdirSync(fixture).sort(), originalEntries);
    for (const [file, bytes] of before) {
      assert.deepEqual(fs.readFileSync(path.join(fixture, file)), bytes, `shipped ${file} changed`);
    }
  });
  const npm = npmCli();
  const retained = new Map();
  const variants = [
    {
      label: "shipped-baseline",
      source: before.get("scanner.cjs").toString("utf8"),
      failures: checks.filter(id => id !== "empty-results"),
    },
    { label: "repaired-control", source: control, failures: [] },
    {
      label: "stop-after-first-page",
      source: control.replace("    }\n    return", "      break;\n    }\n    return"),
      includes: ["native-pagination", "service-failure-propagation"],
    },
    {
      label: "last-duplicate-wins",
      source: control.replace("if (!rows.has(item.pk.S)) ", ""),
      includes: ["stable-aggregation"],
    },
    {
      label: "unstable-order",
      source: control.replace(".sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)", ""),
      includes: ["stable-aggregation"],
    },
    {
      label: "drop-abort-signal",
      source: control.replace("{ abortSignal: signal }", "{}"),
      includes: ["inflight-cancellation", "preaborted-cancellation"],
    },
    {
      label: "swallow-service-error",
      source: control.replace("  } finally {", "  } catch { return []; } finally {"),
      includes: ["service-failure-propagation"],
    },
    {
      label: "leak-owned-client",
      source: control.replace("if (!client) active.destroy();", ""),
      includes: ["owned-transport-cleanup"],
    },
    {
      label: "destroy-borrowed-client",
      source: control.replace("if (!client) active.destroy();", "active.destroy();"),
      includes: ["borrowed-client-ownership"],
    },
  ];
  for (const variant of variants) {
    await t.test(variant.label, () => {
      if (variant.includes) assert.notEqual(variant.source, control, "mutation must change candidate bytes");
      const retainedVariant = variant.label === "shipped-baseline" ? "baseline"
        : variant.label === "repaired-control" ? "candidate" : null;
      const directory = retainedVariant
        ? path.join(root, retainedVariant)
        : fs.mkdtempSync(path.join(root, `${variant.label}-`));
      fs.mkdirSync(directory, { recursive: true });
      for (const [file, bytes] of before) fs.writeFileSync(path.join(directory, file), bytes);
      fs.writeFileSync(path.join(directory, "scanner.cjs"), variant.source);
      const install = spawnSync(process.execPath, [
        npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund",
      ], { cwd: directory, env: environment(), encoding: "utf8", timeout: 120000 });
      assert.equal(install.error, undefined, install.stdout + install.stderr);
      assert.equal(install.status, 0, install.stdout + install.stderr);
      const result = spawnSync(process.execPath, ["run-oracle.cjs"], {
        cwd: directory, env: environment(), encoding: "utf8", timeout: 60000,
      });
      const passed = variant.failures?.length === 0;
      assert.equal(result.status, passed ? 0 : 1, result.stdout + result.stderr);
      const payload = parseMarker(result, passed ? "MCPEE_ORACLE_RESULT " : "MCPEE_ORACLE_FAILURE ");
      assert.deepEqual(Object.keys(payload).sort(), ["schema_version", "id", "status", "checks"].sort());
      assert.equal(payload.schema_version, 1);
      assert.equal(payload.id, "aws-sdk-runtime");
      assert.equal(payload.status, passed ? "passed" : "failed");
      assert.doesNotMatch(result.stdout + result.stderr,
        passed ? /MCPEE_ORACLE_FAILURE / : /MCPEE_ORACLE_RESULT /);
      if (variant.failures) assert.deepEqual(payload.checks, passed ? checks : variant.failures);
      else {
        assert.ok(payload.checks.length > 0);
        assert.equal(new Set(payload.checks).size, payload.checks.length);
        assert.ok(payload.checks.every(id => checks.includes(id)));
        for (const id of variant.includes) assert.ok(payload.checks.includes(id), `${id}: ${result.stdout}`);
      }
      assert.equal(result.stdout.split(/\r?\n/).filter(line => line.startsWith("CHECK ")).length, checks.length);
      for (const file of immutable) assert.deepEqual(fs.readFileSync(path.join(directory, file)), before.get(file));
      if (retainedVariant) retained.set(retainedVariant, directory);
    });
  }
  await t.test("retained MCPEE evaluations feed current-hash behavioral acceptance", async () => {
    const suite = loadBehavioralOracles();
    const oracle = suite.oracles.find(item => item.id === "aws-sdk-runtime");
    assert.ok(oracle);
    assert.deepEqual(oracle.command, { tool: "node", args: ["run-oracle.cjs"], timeout_ms: 60000 });
    assert.deepEqual(oracle.checks, checks);
    assert.deepEqual(oracle.mutable, ["scanner.cjs"]);
    assert.deepEqual(oracle.immutable, immutable);
    assert.deepEqual(oracle.files.map(file => file.path).sort(), [...inventory].sort());
    const specs = behavioralRunSpecs(oracle);
    const ids = {};
    let approvals = 0;
    for (const variant of ["baseline", "candidate"]) {
      assert.equal(retained.get(variant), path.join(root, variant));
      assert.equal(specs[variant].task, behavioralOracleTask(oracle));
      assert.deepEqual(specs[variant].checks, [{
        id: oracle.id, label: oracle.scope, ...oracle.command, cwd: variant,
      }]);
      assert.deepEqual(specs[variant].evidence, oracle.files.map(file => `${variant}/${file.path}`));
      const specFile = `${variant}.json`;
      fs.writeFileSync(path.join(root, specFile), JSON.stringify(specs[variant]));
      const report = await evaluateExecution(root, specFile, {
        approveStep: async check => {
          assert.equal(check.tool, oracle.command.tool);
          assert.deepEqual(check.args, oracle.command.args);
          assert.equal(check.timeout_ms, oracle.command.timeout_ms);
          approvals += 1;
          return true;
        },
      });
      assert.equal(report.status, variant === "baseline" ? "failed" : "passed", JSON.stringify(report.checks));
      assert.equal(report.task, specs[variant].task);
      assert.equal(report.checks.length, 1);
      const check = report.checks[0];
      assert.equal(check.error, undefined, JSON.stringify(check));
      assert.equal(check.exit_code, variant === "baseline" ? 1 : 0, JSON.stringify(check));
      assert.ok(check.stdout_tail.length <= 2048);
      assert.ok(check.stderr_tail.length <= 2048);
      const marker = variant === "baseline" ? "MCPEE_ORACLE_FAILURE " : "MCPEE_ORACLE_RESULT ";
      const lines = check.stdout_tail.trimEnd().split(/\r?\n/);
      assert.ok(lines.at(-1).startsWith(marker), check.stdout_tail);
      const payload = JSON.parse(lines.at(-1).slice(marker.length));
      assert.deepEqual(payload, {
        schema_version: 1, id: oracle.id,
        status: variant === "baseline" ? "failed" : "passed",
        checks: variant === "baseline" ? checks.filter(id => id !== "empty-results") : checks,
      });
      assert.doesNotMatch(check.stdout_tail + check.stderr_tail, /MCPEE_ORACLE_SETUP_ERROR/);
      const persisted = readEvaluation(root, report.id);
      assert.equal(persisted.task, report.task);
      assert.deepEqual(persisted.checks, report.checks);
      assert.deepEqual(persisted.evidence, report.evidence);
      for (const file of oracle.files) {
        const evidence = persisted.evidence.find(item => item.path === `${variant}/${file.path}`);
        assert.ok(evidence, file.path);
        if (variant === "baseline" || immutable.includes(file.path)) {
          assert.equal(evidence.sha256, file.sha256, file.path);
        } else {
          assert.notEqual(evidence.sha256, file.sha256, "repaired candidate must differ from baseline");
        }
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
    const accepted = buildBehavioralAcceptance(root, "results.json");
    assert.equal(accepted.suite_sha256, suite.suite_sha256);
    assert.equal(accepted.catalog_sha256, suite.catalog_sha256);
    assert.equal(accepted.summary.checked_fixtures, 1);
    assert.equal(accepted.summary.specialist_trials_certified, 0);
    assert.equal(accepted.status, "incomplete");
    assert.deepEqual(accepted.oracles.find(item => item.id === oracle.id).observation, {
      oracle: oracle.id, status: "checked-fixture",
      baseline_validation_id: ids.baseline, candidate_validation_id: ids.candidate,
      verified_checks: checks,
    });
  });
  for (const [label, source] of [
    ["syntax-error", "module.exports = {{{"],
    ["unexpected-runtime-error", 'exports.scanTable = async () => { throw new Error("not an assertion"); };'],
    ["missing-dependency", 'require("@mcpee/nonexistent-oracle-dependency");'],
  ]) {
    await t.test(`setup-${label}-has-no-acceptance-marker`, () => {
      const directory = fs.mkdtempSync(path.join(root, `${label}-`));
      for (const [file, bytes] of before) fs.writeFileSync(path.join(directory, file), bytes);
      // These setup failures need no install; the missing SDK itself must never be acceptance evidence.
      if (label !== "missing-dependency") {
        fs.writeFileSync(path.join(directory, "scanner.cjs"), source);
        const install = spawnSync(process.execPath, [
          npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund",
        ], { cwd: directory, env: environment(), encoding: "utf8", timeout: 120000 });
        assert.equal(install.error, undefined, install.stdout + install.stderr);
        assert.equal(install.status, 0, install.stdout + install.stderr);
      }
      const result = spawnSync(process.execPath, ["run-oracle.cjs"], {
        cwd: directory, env: environment(), encoding: "utf8", timeout: 60000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /MCPEE_ORACLE_SETUP_ERROR/);
      assert.doesNotMatch(result.stdout + result.stderr, /MCPEE_ORACLE_(RESULT|FAILURE) /);
    });
  }
});
