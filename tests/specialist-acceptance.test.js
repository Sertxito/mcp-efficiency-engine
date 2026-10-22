"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  loadSpecialistSuite, specialistTask, buildSpecialistAcceptance,
} = require("../packages/evaluation-engine/src/specialist-acceptance");
const { sourceEvidence } = require("../packages/memory-engine/src/memory");
const { readCatalog } = require("../packages/copilot-renderer/src/render");

const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const cli = path.resolve(__dirname, "../packages/cli/bin/mcpee.js");

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-specialist-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, content) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, typeof content === "string" ? content : JSON.stringify(content));
}

// Synthetic execution records test the evidence reader, not a specialist/model.
function trialFixture(t) {
  const root = project(t);
  const { suite, suite_sha256, catalog_sha256 } = loadSpecialistSuite();
  const scenario = suite.scenarios.find(item => item.id === "node-bounded-operation");
  const task = specialistTask(scenario, "failure");
  const runId = crypto.randomUUID();
  const validationId = crypto.randomUUID();
  const runPath = `.mcpee/reports/runs/${runId}.json`;
  const response = "Fixture response; not a model execution.";
  write(root, "response.txt", response);
  write(root, "candidate.cjs", "module.exports = 1;");
  write(root, runPath, {
    generated_by: "mcpee", schema_version: 1, id: runId,
    task_sha256: hash(task), agent_id: scenario.agent, session_id: "fixture-session",
    stages: [{ id: "execute", status: "completed" }],
  });
  const validation = {
    generated_by: "mcpee", id: validationId, task, status: "passed",
    evidence: sourceEvidence(root, ["response.txt", "candidate.cjs"]),
    checks: [{ id: "behavior", status: "passed", exit_code: 0 }],
  };
  write(root, `.mcpee/reports/evaluations/${validationId}.json`, validation);
  const events = [
    { event_name: "copilot.response.received", session_id: "fixture-session",
      attributes: { content_sha256: hash(response) } },
    { event_name: "copilot.execution.completed", session_id: "fixture-session",
      attributes: { task_sha256: hash(task), outcome: "success" } },
  ];
  write(root, ".mcpee/telemetry/events/copilot.jsonl", events.map(event => JSON.stringify(event)).join("\n"));
  const input = {
    suite_id: suite.id, suite_sha256, catalog_sha256,
    trials: [{
      scenario_id: scenario.id, variant: "failure", run_report: runPath,
      validation_id: validationId, response: "response.txt",
      environment: { model: "fixture-not-model", runtime: "test-runtime", fixture_revision: "synthetic-v1" },
      review: {
        reviewer: "fixture-reviewer",
        ratings: Object.keys(suite.review_criteria).map(criterion => ({
          criterion, rating: 2, note: "Synthetic reader test, no competence claim.",
          evidence: ["candidate.cjs"],
        })),
      },
    }],
  };
  function save() { write(root, "results.json", input); }
  save();
  return { root, input, validation, validationId, runPath, events, save };
}

test("suite covers every runtime role and guide with concrete normal/failure/boundary work", t => {
  const root = project(t);
  const { suite } = loadSpecialistSuite();
  const { catalog } = readCatalog();
  assert.equal(new Set(suite.scenarios.map(item => item.agent)).size, catalog.agents.length);
  assert.equal(new Set(suite.scenarios.flatMap(item => item.guides)).size, catalog.technical_guidance.length);
  for (const scenario of suite.scenarios) {
    for (const variant of suite.variants) {
      assert.ok(specialistTask(scenario, variant).includes(`Acceptance: ${scenario.id}/${variant}`));
    }
    assert.ok(scenario.check.length > 60);
  }
  const report = buildSpecialistAcceptance(root);
  assert.equal(report.status, "incomplete");
  assert.equal(report.summary.required_trials, suite.scenarios.length * 3);
  assert.equal(report.summary.not_run, report.summary.required_trials);
  assert.equal(report.summary.passed, 0);
  assert.deepEqual(fs.readdirSync(root), [], "inspection creates no state or telemetry");
  assert.throws(() => specialistTask(suite.scenarios[0], "invented"), /Unknown specialist variant/);
});

test("entry-audit probes cover each guide with bounded source and separate reviewer oracles", () => {
  const fixture = require("../templates/specialist-acceptance/audit-fixtures.json");
  const { catalog } = readCatalog();
  assert.deepEqual(fixture.cases.map(item => item.guide).sort(),
    catalog.technical_guidance.map(item => item.id).sort());
  assert.equal(new Set(fixture.cases.map(item => item.id)).size, fixture.cases.length);
  for (const item of fixture.cases) {
    assert.ok(catalog.agents.some(agent => agent.id === item.agent));
    assert.ok(item.context.length > 50);
    assert.ok(Buffer.byteLength(item.source) < 4096);
    assert.equal(item.expected.length, 2);
    const lines = item.source.trimEnd().split("\n").length;
    for (const finding of item.expected) {
      assert.ok(finding.reason.length > 30);
      assert.ok(finding.lines.length > 0);
      assert.ok(finding.lines.every(line => Number.isInteger(line) && line >= 1 && line <= lines));
    }
  }
});

test("one verified synthetic trial cannot imply complete specialist coverage", t => {
  const { root } = trialFixture(t);
  const report = buildSpecialistAcceptance(root, "results.json");
  assert.equal(report.status, "incomplete");
  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary.not_run, report.summary.required_trials - 1);
});

test("partial review or failed/blocked checks never pass acceptance", t => {
  const fixture = trialFixture(t);
  fixture.input.trials[0].review.ratings[0].rating = 1;
  fixture.save();
  assert.equal(buildSpecialistAcceptance(fixture.root, "results.json").summary.failed, 1);
  fixture.input.trials[0].review.ratings[0].rating = 2;
  fixture.save();
  for (const status of ["failed", "blocked", "skipped"]) {
    fixture.validation.checks[0].status = status;
    fixture.validation.checks[0].exit_code = null;
    write(fixture.root, `.mcpee/reports/evaluations/${fixture.validationId}.json`, fixture.validation);
    assert.equal(buildSpecialistAcceptance(fixture.root, "results.json").summary.failed, 1);
  }
});

test("acceptance rejects stale digests, reused trials, unknown scenarios and missing review", t => {
  const fixture = trialFixture(t);
  const original = structuredClone(fixture.input);
  const mutations = [
    input => { input.catalog_sha256 = "0".repeat(64); },
    input => { input.suite_sha256 = "0".repeat(64); },
    input => { input.trials.push(input.trials[0]); },
    input => { input.trials[0].scenario_id = "unknown"; },
    input => { input.trials[0].review.ratings.pop(); },
    input => { input.trials[0].review.ratings[0].criterion = "not-a-criterion"; },
    input => { input.trials[0].review.ratings[0].evidence = ["not-validated.txt"]; },
    input => { input.trials[0].environment.runtime = ""; },
    input => { input.trials[0].response = "..\\outside.txt"; },
  ];
  for (const mutate of mutations) {
    const input = structuredClone(original);
    mutate(input);
    write(fixture.root, "results.json", input);
    assert.throws(() => buildSpecialistAcceptance(fixture.root, "results.json"));
  }
});

test("acceptance binds response bytes, task, agent, telemetry and current candidate hashes", t => {
  const fixture = trialFixture(t);
  write(fixture.root, "candidate.cjs", "module.exports = 2;");
  assert.throws(() => buildSpecialistAcceptance(fixture.root, "results.json"), /evidence changed/);
  write(fixture.root, "candidate.cjs", "module.exports = 1;");
  write(fixture.root, "response.txt", "a replacement model response");
  assert.throws(() => buildSpecialistAcceptance(fixture.root, "results.json"), /response-hash events/);
  write(fixture.root, "response.txt", "Fixture response; not a model execution.");
  const run = JSON.parse(fs.readFileSync(path.join(fixture.root, fixture.runPath), "utf8"));
  run.agent_id = "frontend";
  write(fixture.root, fixture.runPath, run);
  assert.throws(() => buildSpecialistAcceptance(fixture.root, "results.json"), /does not match/);
  run.agent_id = "backend";
  write(fixture.root, fixture.runPath, run);
  fixture.validation.task = "unrelated green test";
  write(fixture.root, `.mcpee/reports/evaluations/${fixture.validationId}.json`, fixture.validation);
  assert.throws(() => buildSpecialistAcceptance(fixture.root, "results.json"), /must match the scenario/);
});

test("CLI lists honest incomplete status and exports tasks without initialization", t => {
  const root = project(t);
  const result = spawnSync(process.execPath, [cli, "evaluate", "--suite", "specialist-core",
    "--project", root, "--json"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.passed, 0);
  const task = spawnSync(process.execPath, [cli, "evaluate", "--suite", "specialist-core",
    "--scenario", "node-bounded-operation", "--variant", "failure", "--project", root,
    "--json"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(task.status, 0, task.stderr);
  assert.match(JSON.parse(task.stdout).task, /Acceptance: node-bounded-operation\/failure/);
  const invalid = spawnSync(process.execPath, [cli, "evaluate", "--suite", "unknown",
    "--project", root], { encoding: "utf8", timeout: 30_000 });
  assert.notEqual(invalid.status, 0);
});

test("seeded Node checker rejects defective versions and accepts a cooperative control", t => {
  const root = project(t);
  const fixtures = path.resolve(__dirname, "../templates/specialist-acceptance/node-bounded-operation");
  fs.copyFileSync(path.join(fixtures, "checks.cjs"), path.join(root, "checks.cjs"));
  fs.copyFileSync(path.join(fixtures, "worker.cjs"), path.join(root, "worker.cjs"));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = () => spawnSync(process.execPath, ["--test", "--test-timeout=5000", "checks.cjs"],
    { cwd: root, env, encoding: "utf8", timeout: 15_000 });
  const defective = run();
  assert.equal(defective.status, 1, defective.stderr);
  assert.match(defective.stdout, /not ok|✖/);
  write(root, "worker.cjs", `
    exports.mapBounded = async (items, limit, worker, { signal } = {}) => {
      if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit");
      signal?.throwIfAborted();
      const results = new Array(items.length);
      let cursor = 0;
      let stopped = false;
      async function consume() {
        while (!stopped) {
          try {
            signal?.throwIfAborted();
            const index = cursor++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index, signal);
          } catch (error) {
            stopped = true;
            throw error;
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
      return results;
    };
  `);
  const control = run();
  assert.equal(control.status, 0, control.stdout + control.stderr);
  const source = fs.readFileSync(path.join(root, "worker.cjs"), "utf8");
  const mutations = [
    ["result order", source.replace("results[index] = await", "results[0] = await")],
    ["concurrency limit", source.replace("Math.min(limit, items.length)", "items.length")],
    ["global stop", source.replace("stopped = true;", "stopped = false;")],
    ["silent failures", source.replace("throw error;", "return;")],
    ["scheduler cancellation", source.replaceAll("signal?.throwIfAborted();", "")],
  ];
  for (const [name, mutation] of mutations) {
    assert.notEqual(mutation, source, `${name} mutation must alter the control`);
    write(root, "worker.cjs", mutation);
    assert.equal(run().status, 1, `${name} mutation must fail the unchanged oracle`);
  }
});
