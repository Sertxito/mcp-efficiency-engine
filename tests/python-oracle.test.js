"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { loadRunSpec, executeRunSpec } = require("../packages/evaluation-engine/src/evaluate");
const {
  loadBehavioralOracles, behavioralRunSpecs, buildBehavioralAcceptance,
} = require("../packages/evaluation-engine/src/behavioral-oracles");

const fixture = path.resolve(__dirname, "../templates/specialist-acceptance/python-resource-lifetime");
const control = `import asyncio

async def process_files(paths, limit, consume, open_file):
    if type(limit) is not int or limit < 1:
        raise ValueError("limit must be a positive integer")
    results = [None] * len(paths)
    cursor = 0
    stopped = False

    async def runner():
        nonlocal cursor, stopped
        while not stopped:
            index = cursor
            cursor += 1
            if index >= len(paths):
                return
            try:
                async with await open_file(paths[index], encoding="utf-8") as resource:
                    results[index] = await consume(await resource.read())
            except BaseException:
                stopped = True
                raise

    tasks = [asyncio.create_task(runner()) for _ in range(min(limit, len(paths)))]
    try:
        await asyncio.gather(*tasks)
    except BaseException:
        stopped = True
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
    return results
`;

test("native Python oracle rejects seeded defects, accepts repaired control and detects mutations", async t => {
  const runtime = spawnSync("python", ["--version"], { encoding: "utf8", timeout: 10000 });
  if (runtime.error?.code === "ENOENT") return t.skip("Python is unavailable; native Python acceptance was not run.");
  assert.equal(runtime.status, 0, runtime.stderr);
  const version = runtime.stdout.match(/Python (\d+)\.(\d+)/);
  assert.ok(version, runtime.stdout);
  if (Number(version[1]) < 3 || Number(version[1]) === 3 && Number(version[2]) < 11) {
    return t.skip("Native resource oracle requires Python >=3.11; not verified here.");
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-python-oracle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(fixture, root, { recursive: true });
  const run = () => spawnSync("python", ["-B", "checks.py"], {
    cwd: root, encoding: "utf8", timeout: 60000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: "", PYTHONSAFEPATH: "" },
  });
  const baseline = run();
  assert.equal(baseline.error, undefined);
  assert.equal(baseline.status, 1, baseline.stdout + baseline.stderr);
  assert.match(baseline.stderr, /FAIL:|ERROR:/, "baseline must fail behavioral assertions, not a missing tool");
  assert.doesNotMatch(baseline.stdout, /MCPEE_ORACLE_RESULT/);
  const worker = path.join(root, "worker.py");
  fs.writeFileSync(worker, control);
  const repaired = run();
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  const marker = repaired.stdout.split(/\r?\n/).find(line => line.startsWith("MCPEE_ORACLE_RESULT "));
  assert.ok(marker, repaired.stdout);
  const result = JSON.parse(marker.slice("MCPEE_ORACLE_RESULT ".length));
  assert.equal(result.id, "python-resource-lifetime");
  assert.equal(result.checks.length, 7);
  for (const [label, mutant] of [
    ["unbounded fanout", control.replace("min(limit, len(paths))", "len(paths)")],
    ["wrong order", control.replace("results[index] =", "results[0] =")],
    ["boolean limit", control.replace("type(limit) is not int", "not isinstance(limit, int)")],
    ["encoding", control.replace('encoding="utf-8"', 'encoding="ascii"')],
  ]) {
    assert.notEqual(mutant, control, label);
    fs.writeFileSync(worker, mutant);
    const failed = run();
    assert.equal(failed.error, undefined, `${label}: ${failed.stderr}`);
    assert.equal(failed.status, 1, `${label}: ${failed.stdout}${failed.stderr}`);
    assert.doesNotMatch(failed.stdout, /MCPEE_ORACLE_RESULT/, label);
  }

  const project = path.join(root, "evaluation-project");
  const suite = loadBehavioralOracles();
  const oracle = suite.oracles.find(item => item.id === "python-resource-lifetime");
  const specs = behavioralRunSpecs(oracle);
  const ids = {};
  let approvals = 0;
  for (const variant of ["baseline", "candidate"]) {
    fs.cpSync(fixture, path.join(project, variant), { recursive: true });
    if (variant === "candidate") fs.writeFileSync(path.join(project, variant, "worker.py"), control);
    const specPath = `${variant}.json`;
    fs.writeFileSync(path.join(project, specPath), JSON.stringify(specs[variant]));
    const report = await executeRunSpec(project, loadRunSpec(project, specPath), {
      approveStep: async check => {
        assert.equal(check.tool, "python");
        assert.deepEqual(check.args, ["-B", "checks.py"]);
        approvals += 1;
        return true;
      },
    });
    assert.equal(report.status, variant === "baseline" ? "failed" : "passed",
      JSON.stringify(report.checks));
    assert.equal(report.checks[0].error, undefined, JSON.stringify(report.checks));
    assert.equal(report.checks[0].exit_code, variant === "baseline" ? 1 : 0,
      JSON.stringify(report.checks));
    ids[variant] = report.id;
  }
  assert.equal(approvals, 2, "native commands must retain the ordinary evaluator approval boundary");
  fs.writeFileSync(path.join(project, "native-results.json"), JSON.stringify({
    suite_id: suite.id, suite_sha256: suite.suite_sha256, catalog_sha256: suite.catalog_sha256,
    trials: [{
      oracle: oracle.id, baseline_validation_id: ids.baseline, candidate_validation_id: ids.candidate,
    }],
  }));
  const accepted = buildBehavioralAcceptance(project, "native-results.json");
  assert.equal(accepted.summary.checked_fixtures, 1, "actual retained native evaluations must be consumable");
  assert.equal(accepted.summary.specialist_trials_certified, 0);
  assert.equal(accepted.status, "incomplete");
});
