"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readProjectFile } = require("./asset-evaluation");
const { readEvaluation } = require("./evaluate");
const { sourceEvidence } = require("../../memory-engine/src/memory");

const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const FIXTURE = path.resolve(__dirname, "../../../templates/specialist-acceptance/node-bounded-operation");
const NODE_ARGS = ["--test", "--test-reporter=tap", "checks.cjs"];
const NODE_OUTCOME_TESTS = [
  ["normal: bounded parallelism and stable result ordering"],
  [
    "failure: rejected and synchronously thrown worker errors are propagated",
    "failure: no new work is scheduled after a worker failure",
    "failure: one runner failing stops other runners from taking more work",
    "failure: falsy thrown reasons are not mistaken for successful completion",
    "failure: cancellation stops scheduling and reaches the worker",
    "failure: scheduler observes cancellation even when a worker returns normally",
  ],
  [
    "failure: cancellation stops scheduling and reaches the worker",
    "failure: scheduler observes cancellation even when a worker returns normally",
    "boundary: pre-aborted input never starts work",
    "boundary: invalid limits reject and empty input is valid",
    "boundary: abort listeners are removed after success, failure and cancellation",
  ],
];

function nodeOracleRunSpecs(task) {
  const spec = directory => ({
    task,
    evidence: [`${directory}/worker.cjs`, `${directory}/checks.cjs`,
      ...(directory === "candidate" ? ["response.txt"] : [])],
    checks: [{ id: "bounded-behavior", label: "Complete packaged Node behavioral oracle",
      tool: "node", args: [...NODE_ARGS], cwd: directory, timeout_ms: 15000 }],
  });
  return { baseline: spec("baseline"), candidate: spec("candidate") };
}

function automaticSpecialistReview(root, trial, scenario, evaluation, completion) {
  const request = trial.automatic_review;
  if (!request) return { status: "awaiting-verification", reason: "No automatic oracle evidence or explicit technical review." };
  if (scenario.id !== "node-bounded-operation" || request.oracle !== "node-bounded-operation-v1") {
    throw new Error("Unsupported automatic specialist oracle; semantic review is required for this scenario.");
  }
  if (trial.review) throw new Error("Select automatic oracle evidence or explicit review, not both.");
  const baseline = readEvaluation(root, request.baseline_validation_id);
  if (baseline.id === evaluation.id || baseline.task !== evaluation.task ||
      !baseline.evidence.length) throw new Error("Automatic review requires a separate task-bound baseline evaluation.");
  sourceEvidence(root, baseline.evidence.map(item => item.path), baseline.evidence);
  const check = report => {
    if (report.schema_version !== 1) throw new Error("Automatic review requires versioned evaluation reports.");
    if (report.checks.length !== 1) throw new Error("Automatic Node oracle requires exactly one full oracle check.");
    const item = report.checks[0];
    if (item.tool !== "node" || JSON.stringify(item.args) !== JSON.stringify(NODE_ARGS) ||
        typeof item.cwd !== "string" || item.error ||
        !Number.isInteger(item.timeout_ms) || item.timeout_ms < 1000 ||
        !Number.isFinite(item.duration_ms) || item.duration_ms >= item.timeout_ms) {
      throw new Error("Automatic Node review requires the exact completed node --test --test-reporter=tap checks.cjs command, not a filtered, timed-out or substituted check.");
    }
    const count = name => {
      const match = String(item.stdout_tail || "").match(new RegExp(`(?:#|\\u2139)\\s+${name}\\s+(\\d+)(?:\\r?\\n|$)`));
      return match ? Number(match[1]) : null;
    };
    if (count("tests") !== 10 || count("skipped") !== 0 || count("cancelled") !== 0 ||
        count("pass") === null || count("fail") === null || count("pass") + count("fail") !== 10 ||
        (report === baseline ? !(count("fail") > 0) :
          report.status === "passed" && (count("pass") !== 10 || count("fail") !== 0))) {
      throw new Error("Automatic Node review requires all ten behavioral tests to complete, with no skipped or cancelled tests.");
    }
    const directory = item.cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const file = name => directory === "." ? name : `${directory}/${name}`;
    const paths = [file("worker.cjs"), file("checks.cjs")];
    for (const relative of paths) {
      if (!report.evidence.some(evidence => evidence.path === relative)) {
        throw new Error("Automatic Node review requires hashed worker and oracle evidence for each evaluation.");
      }
    }
    const worker = readProjectFile(root, paths[0], 256 * 1024, "Automatic Node candidate").contents;
    const oracle = readProjectFile(root, paths[1], 256 * 1024, "Automatic Node oracle").contents;
    if (!oracle.equals(fs.readFileSync(path.join(FIXTURE, "checks.cjs")))) {
      throw new Error("Automatic Node oracle differs from the packaged behavioral checks.");
    }
    const oracleText = oracle.toString("utf8");
    const verifiedOutcomes = scenario.outcomes.map((outcome, index) => {
      const tests = NODE_OUTCOME_TESTS[index];
      if (!tests || tests.some(name => !oracleText.includes(`test("${name}"`))) {
        throw new Error("Automatic Node oracle does not map every scenario outcome to an exact behavioral test.");
      }
      return { index, outcome, rating: 2, evidence: [paths[0], paths[1]], tests };
    });
    if (verifiedOutcomes.length !== NODE_OUTCOME_TESTS.length) {
      throw new Error("Automatic Node oracle outcome mapping does not match the scenario contract.");
    }
    return { item, worker, workerPath: paths[0], oracleHash: hash(oracle), verifiedOutcomes };
  };
  const before = check(baseline), after = check(evaluation);
  if (before.workerPath === after.workerPath ||
      !before.worker.equals(fs.readFileSync(path.join(FIXTURE, "worker.cjs"))) ||
      baseline.status !== "failed" || before.item.status !== "failed" || before.item.exit_code !== 1) {
    throw new Error("Automatic Node review requires the unchanged seeded baseline to fail in its separate retained directory.");
  }
  const changed = completion.attributes.changed_paths;
  if (!Array.isArray(changed) || changed.some(file => typeof file !== "string")) {
    return { status: "awaiting-verification", reason: "Automatic scope verification requires recorded changed_paths." };
  }
  const outOfScope = changed.some(file => {
    const normalized = path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
    return normalized !== after.workerPath;
  });
  return {
    status: outOfScope || evaluation.status !== "passed" || after.item.status !== "passed" ||
      after.item.exit_code !== 0 ? "failed" : "passed",
    method: "automatic-behavioral-oracle",
    oracle: request.oracle, oracle_sha256: after.oracleHash,
    baseline_validation_id: baseline.id, candidate_validation_id: evaluation.id,
    scope: "bounded-node-fixture-behavior-and-recorded-file-changes",
    verified_outcomes: after.verifiedOutcomes,
    ...(outOfScope ? { reason: "Execution changed files outside the candidate worker." } : {}),
  };
}

module.exports = { automaticSpecialistReview, nodeOracleRunSpecs };
