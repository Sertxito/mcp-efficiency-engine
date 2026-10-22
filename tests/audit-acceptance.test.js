"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  loadAuditSuite, auditTask, parseAuditResponse, reviewAuditResponse, buildAuditAcceptance,
} = require("../packages/evaluation-engine/src/audit-acceptance");

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-audit-controls-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}
function responseFor(sample) {
  return {
    findings: sample.expected.map(issue => ({
      id: issue.id, lines: issue.lines, problem: issue.reason,
      consequence: "Synthetic test consequence, not a model observation.",
      correction: "Synthetic test correction, not an accepted recommendation.", confidence: "high",
    })),
    unknowns: (sample.required_unknowns || []).map(item => item.reason),
    checks_not_run: ["All runtime checks; synthetic reader test only."],
  };
}
function reviewFor(sample, response) {
  return {
    reviewer: "synthetic-test-not-independent-review",
    findings: response.findings.map(finding => ({
      finding_id: finding.id, verdict: "supported",
      expected_ids: sample.expected.some(issue => issue.id === finding.id) ? [finding.id] : [],
      note: "Synthetic test classification, no competence claim.",
    })),
    unknowns: (sample.required_unknowns || []).map((item, index) => ({
      id: item.id, index, note: "Synthetic evidence-gap mapping.",
    })),
    scope: { rating: 2, note: "Synthetic test has no tools or edits." },
  };
}
function recordedTrials(t, selection) {
  const root = project(t);
  const suite = loadAuditSuite();
  const input = {
    suite_id: suite.id, suite_sha256: suite.suite_sha256, catalog_sha256: suite.catalog_sha256, trials: [],
  };
  const events = [];
  for (const [scenario, variant] of selection(suite)) {
    const sample = scenario.variants[variant];
    const { task, source_path } = auditTask(scenario, variant);
    const response = responseFor(sample);
    const content = `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``;
    const session = crypto.randomUUID();
    const responsePath = `responses/${scenario.id}-${variant}.txt`;
    write(root, source_path, sample.source);
    write(root, responsePath, content);
    input.trials.push({
      scenario_id: scenario.id, variant, session_id: session, response: responsePath,
      review: reviewFor(sample, response),
    });
    events.push(
      { session_id: session, event_name: "copilot.execution.started",
        attributes: { task_sha256: hash(task), agent: scenario.agent } },
      { session_id: session, event_name: "copilot.response.received",
        attributes: { content_sha256: hash(content) } },
      { session_id: session, event_name: "copilot.execution.completed",
        attributes: { task_sha256: hash(task), outcome: "success", changed_paths: [] } },
    );
  }
  const save = () => {
    write(root, "results.json", input);
    write(root, ".mcpee/telemetry/events/copilot.jsonl", events.map(event => JSON.stringify(event)).join("\n"));
  };
  save();
  return { root, suite, input, events, save };
}

test("all technology probes have safe-code and missing-evidence controls with hidden oracles", t => {
  const suite = loadAuditSuite();
  assert.equal(suite.scenarios.length, 14);
  for (const scenario of suite.scenarios) {
    for (const variant of suite.variants) {
      const sample = scenario.variants[variant];
      const exported = auditTask(scenario, variant);
      assert.ok(exported.task.includes(sample.source.trimEnd().split("\n")[0]));
      assert.ok(!exported.source_path.includes(variant), "blind source path");
      assert.ok(!exported.task.includes('"do_not_report"'));
      assert.ok(!exported.task.includes('"required_unknowns"'));
      assert.ok(!exported.task.includes(`/${variant}`));
      assert.match(exported.task, /finding about the claim itself/);
      assert.match(exported.task, /Clearly stated unverified scope/);
      if (variant !== "positive") assert.deepEqual(sample.expected, []);
    }
  }
  const root = project(t);
  const report = buildAuditAcceptance(root);
  assert.equal(report.summary.required_trials, 42);
  assert.equal(report.summary.not_run, 42);
  assert.equal(report.summary.control_alarm_rate, null);
  assert.equal(report.summary.seeded_defect_recall, null);
  assert.equal(report.summary.unsupported_finding_share, null);
  assert.match(suite.scenarios.find(item => item.id === "terraform-entry").variants.positive.context,
    /real credential.*not marked sensitive/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("silence cannot pass a positive probe and boilerplate unknowns cannot pass abstention", () => {
  const scenario = loadAuditSuite().scenarios[0];
  const empty = { findings: [], unknowns: [], checks_not_run: ["Not run."] };
  const positive = reviewAuditResponse(scenario.variants.positive, empty, reviewFor({ expected: [] }, empty));
  assert.equal(positive.passed, false);
  assert.equal(positive.missed_defects, 2);
  const insufficient = reviewAuditResponse(scenario.variants.insufficient, empty, reviewFor({ expected: [] }, empty));
  assert.equal(insufficient.passed, false);
  assert.equal(insufficient.acknowledged_unknowns, 0);
  const negative = reviewAuditResponse(scenario.variants.negative, empty, reviewFor({ expected: [] }, empty));
  assert.equal(negative.passed, true);
});

test("unsupported corrections, duplicate findings and even disputed control oracles fail", () => {
  const scenario = loadAuditSuite().scenarios[0];
  const sample = scenario.variants.negative;
  const response = responseFor(scenario.variants.positive);
  for (const verdict of ["supported", "unsupported", "duplicate"]) {
    const review = reviewFor(sample, response);
    for (const finding of review.findings) finding.verdict = verdict;
    assert.equal(reviewAuditResponse(sample, response, review).passed, false);
  }
  const positive = scenario.variants.positive;
  const review = reviewFor(positive, response);
  review.findings[1].verdict = "duplicate";
  review.findings[1].expected_ids = [];
  assert.equal(reviewAuditResponse(positive, response, review).duplicate_findings, 1);
  for (const rating of [0, 1]) {
    const incompleteScope = reviewFor(positive, response);
    incompleteScope.scope.rating = rating;
    assert.equal(reviewAuditResponse(positive, response, incompleteScope).passed, false);
  }
});

test("response and semantic review mappings reject malformed and incomplete evidence", () => {
  const sample = loadAuditSuite().scenarios[0].variants.positive;
  const response = responseFor(sample);
  const review = reviewFor(sample, response);
  for (const bad of ["{}", "```json\n{}\n```", "```json\nnull\n```", "```json\nno\n```"]) {
    assert.throws(() => parseAuditResponse(bad, 8));
  }
  const fence = value => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
  assert.throws(() => parseAuditResponse(`${fence(response)}\n${fence(response)}`, 8));
  for (const mutate of [
    item => { item.findings[0].lines = [999]; },
    item => { item.findings.push(item.findings[0]); },
    item => { item.unknowns = [null]; },
    item => { item.checks_not_run = []; },
    item => { item.findings[0].correction = ""; },
  ]) {
    const changed = structuredClone(response); mutate(changed);
    assert.throws(() => parseAuditResponse(fence(changed), 8));
  }
  for (const mutate of [
    item => { item.findings.pop(); },
    item => { item.findings[0].expected_ids = ["not-in-oracle"]; },
    item => { item.findings[0].finding_id = item.findings[1].finding_id; },
    item => { item.findings[0].verdict = "keyword-match"; },
    item => { item.scope.note = ""; },
  ]) {
    const changed = structuredClone(review); mutate(changed);
    assert.throws(() => reviewAuditResponse(sample, response, changed));
  }
  const insufficient = loadAuditSuite().scenarios[0].variants.insufficient;
  const abstention = responseFor(insufficient);
  const gapReview = reviewFor(insufficient, abstention);
  for (const mutate of [
    item => { item.unknowns[0].index = 999; },
    item => { item.unknowns[0].id = "unrelated-gap"; },
    item => { item.unknowns.push(item.unknowns[0]); },
  ]) {
    const changed = structuredClone(gapReview); mutate(changed);
    assert.throws(() => reviewAuditResponse(insufficient, abstention, changed));
  }
});

test("synthetic full ledger tests exact denominators, not model competence", t => {
  const fixture = recordedTrials(t, suite => suite.scenarios.flatMap(scenario =>
    suite.variants.map(variant => [scenario, variant])));
  const report = buildAuditAcceptance(fixture.root, "results.json");
  assert.equal(report.status, "passed");
  assert.equal(report.summary.passed, 42);
  assert.equal(report.summary.control_trials_reviewed, 28);
  assert.equal(report.summary.expected_defects_reviewed, 28);
  assert.equal(report.summary.detected_defects, 28);
  assert.equal(report.summary.seeded_defect_recall, 1);
  assert.equal(report.summary.control_alarm_rate, 0);
  assert.equal(report.summary.unsupported_finding_share, 0);
  assert.equal(report.summary.required_unknowns_reviewed, 28);
});

test("one unsupported control finding is one case alarm, not an invented statistical accuracy", t => {
  const fixture = recordedTrials(t, suite =>
    [["negative", suite.scenarios[0]], ["insufficient", suite.scenarios[1]]].map(([variant, scenario]) => [scenario, variant]));
  const trial = fixture.input.trials[0];
  const response = responseFor(fixture.suite.scenarios[0].variants.positive);
  const content = `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``;
  write(fixture.root, trial.response, content);
  fixture.events.find(event => event.event_name === "copilot.response.received").attributes.content_sha256 = hash(content);
  trial.review = reviewFor({ expected: [] }, response);
  trial.review.findings.forEach(item => { item.verdict = "unsupported"; });
  fixture.save();
  const report = buildAuditAcceptance(fixture.root, "results.json");
  assert.equal(report.status, "failed");
  assert.equal(report.summary.not_run, 40);
  assert.equal(report.summary.control_alarm_rate, 0.5);
  assert.equal(report.summary.unsupported_findings, 2);
  assert.equal(report.summary.unsupported_finding_share, 1);
  assert.equal(report.summary.seeded_defect_recall, null);
});

test("audit ledger rejects stale, reused, wrong-role, changed and missing execution evidence", t => {
  const fixture = recordedTrials(t, suite => [[suite.scenarios[0], "negative"]]);
  const original = structuredClone(fixture.input);
  for (const mutate of [
    input => { input.catalog_sha256 = "0".repeat(64); },
    input => { input.suite_sha256 = "0".repeat(64); },
    input => { input.trials.push(input.trials[0]); },
    input => { input.trials[0].variant = "normal"; },
    input => { input.trials[0].session_id = "not-observed"; },
    input => { input.trials[0].response = "..\\outside.txt"; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    write(fixture.root, "results.json", changed);
    assert.throws(() => buildAuditAcceptance(fixture.root, "results.json"));
  }
  fixture.save();
  const started = fixture.events[0];
  started.attributes.agent = "wrong";
  fixture.save();
  assert.throws(() => buildAuditAcceptance(fixture.root, "results.json"), /telemetry/);
  started.attributes.agent = fixture.suite.scenarios[0].agent;
  fixture.events[2].attributes.changed_paths = ["sample.cs"];
  fixture.save();
  assert.equal(buildAuditAcceptance(fixture.root, "results.json").status, "failed");
  fixture.events[2].attributes.changed_paths = [];
  for (const event of [
    { event_name: "copilot.tool.authorization", tool_name: "powershell", attributes: { decision: "deny" } },
    { event_name: "copilot.sdk.tool.execution_start", tool_name: "task" },
    { event_name: "copilot.tool.requested", tool_name: "web_fetch" },
    { event_name: "copilot.permission.decision", attributes: { decision: "no-interactive-review" } },
  ]) {
    fixture.events.push({ session_id: fixture.input.trials[0].session_id, ...event });
    fixture.save();
    assert.equal(buildAuditAcceptance(fixture.root, "results.json").status, "failed");
    fixture.events.pop();
  }
  fixture.save();
  write(fixture.root, fixture.input.trials[0].response, "Changed response.");
  assert.throws(() => buildAuditAcceptance(fixture.root, "results.json"));
  const { source_path } = auditTask(fixture.suite.scenarios[0], "negative");
  write(fixture.root, source_path, "Changed source.");
  assert.throws(() => buildAuditAcceptance(fixture.root, "results.json"), /source changed/);
});

test("installed-style CLI exports a blind exact task and reports no unrun control as passed", t => {
  const root = project(t);
  const cli = path.resolve(__dirname, "../packages/cli/bin/mcpee.js");
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const run = extra => spawnSync(process.execPath, [cli, "evaluate", "--suite", "specialist-audit",
    "--project", root, "--json", ...extra], { encoding: "utf8", env });
  const inspected = run([]);
  assert.equal(inspected.status, 2, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).summary.not_run, 42);
  const exported = run(["--scenario", "node-entry", "--variant", "negative"]);
  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(JSON.parse(exported.stdout).task, auditTask(loadAuditSuite().scenarios[2], "negative").task);
  assert.equal(run(["--scenario", "node-entry", "--variant", "normal"]).status, 1);
  assert.equal(run(["--run", "spec.json"]).status, 1);
});

test("older successful telemetry needs the original hash-bound SDK result, never a silent empty-path default", t => {
  const fixture = recordedTrials(t, suite => [[suite.scenarios[0], "negative"]]);
  const trial = fixture.input.trials[0];
  const { task, source } = auditTask(fixture.suite.scenarios[0], "negative");
  const response = fs.readFileSync(path.join(fixture.root, trial.response));
  delete fixture.events[2].attributes.changed_paths;
  fixture.save();
  assert.throws(() => buildAuditAcceptance(fixture.root, "results.json"), /original SDK execution record/);
  trial.execution_record = "sdk-result.json";
  const execution = {
    session_id: trial.session_id, agent: fixture.suite.scenarios[0].agent,
    task_sha256: hash(task), source_sha256: hash(source), response_sha256: hash(response),
    suite_sha256: fixture.suite.suite_sha256, catalog_sha256: fixture.suite.catalog_sha256,
    changed_paths: [],
  };
  write(fixture.root, trial.execution_record, execution);
  fixture.save();
  assert.equal(buildAuditAcceptance(fixture.root, "results.json").summary.passed, 1);
  for (const mutate of [
    item => { item.session_id = "different"; },
    item => { item.response_sha256 = "0".repeat(64); },
    item => { item.agent = "wrong"; },
    item => { delete item.changed_paths; },
  ]) {
    const changed = structuredClone(execution); mutate(changed);
    write(fixture.root, trial.execution_record, changed);
    assert.throws(() => buildAuditAcceptance(fixture.root, "results.json"), /execution record/);
  }
  execution.changed_paths = ["sample.cs"];
  write(fixture.root, trial.execution_record, execution);
  assert.equal(buildAuditAcceptance(fixture.root, "results.json").status, "failed");
});
