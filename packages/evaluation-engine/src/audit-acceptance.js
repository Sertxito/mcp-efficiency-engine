"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readCatalog } = require("../../copilot-renderer/src/render");
const { readProjectFile } = require("./asset-evaluation");
const { readTrialEvents } = require("./specialist-acceptance");

const DIRECTORY = path.resolve(__dirname, "../../../templates/specialist-acceptance");
const VARIANTS = ["positive", "negative", "insufficient"];
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const strings = value => Array.isArray(value) && value.every(nonempty);

function loadAuditSuite() {
  const positiveBytes = fs.readFileSync(path.join(DIRECTORY, "audit-fixtures.json"));
  const controlBytes = fs.readFileSync(path.join(DIRECTORY, "audit-controls.json"));
  const positive = JSON.parse(positiveBytes);
  const controls = JSON.parse(controlBytes);
  const { catalog, digest } = readCatalog();
  if (positive.schema_version !== 1 || controls.schema_version !== 1 ||
      !Array.isArray(positive.cases) || !Array.isArray(controls.cases) ||
      positive.cases.length !== controls.cases.length ||
      new Set(positive.cases.map(item => item.id)).size !== positive.cases.length ||
      new Set(controls.cases.map(item => item.id)).size !== controls.cases.length) {
    throw new Error("Invalid audit fixture/control suite.");
  }
  const scenarios = positive.cases.map(item => {
    const control = controls.cases.find(control => control.id === item.id);
    if (!control || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) ||
        !/^[a-zA-Z0-9_-]+\.[a-z]+$/.test(item.file) ||
        !catalog.agents.some(agent => agent.id === item.agent) ||
        !catalog.technical_guidance.some(guide => guide.id === item.guide)) {
      throw new Error(`Invalid audit scenario '${item.id}'.`);
    }
    const variants = {
      positive: { context: item.context, source: item.source, expected: item.expected },
      negative: { ...control.negative, expected: [] },
      insufficient: { ...control.insufficient, expected: [] },
    };
    for (const variant of VARIANTS) {
      const sample = variants[variant];
      if (!nonempty(sample.context) || !nonempty(sample.source) ||
          Buffer.byteLength(sample.source) > 16384 || !Array.isArray(sample.expected) ||
          new Set(sample.expected.map(issue => issue.id)).size !== sample.expected.length) {
        throw new Error(`Invalid audit sample '${item.id}/${variant}'.`);
      }
      const lineCount = sample.source.trimEnd().split("\n").length;
      for (const issue of sample.expected) {
        if (!nonempty(issue.id) || !nonempty(issue.reason) || !Array.isArray(issue.lines) ||
            !issue.lines.length || issue.lines.some(line =>
              !Number.isInteger(line) || line < 1 || line > lineCount)) {
          throw new Error(`Invalid audit oracle '${item.id}/${variant}'.`);
        }
      }
      if (variant !== "positive" && (!strings(sample.do_not_report) || !sample.do_not_report.length)) {
        throw new Error(`Audit control needs counterevidence '${item.id}/${variant}'.`);
      }
      if (variant === "insufficient" && (!Array.isArray(sample.required_unknowns) ||
          !sample.required_unknowns.length || sample.required_unknowns.some(unknown =>
            !nonempty(unknown.id) || !nonempty(unknown.reason)) ||
          new Set(sample.required_unknowns.map(unknown => unknown.id)).size !== sample.required_unknowns.length)) {
        throw new Error(`Audit control needs explicit evidence gaps '${item.id}'.`);
      }
    }
    return { id: item.id, agent: item.agent, guide: item.guide, file: item.file, variants };
  });
  if (scenarios.length !== catalog.technical_guidance.length ||
      new Set(scenarios.map(item => item.guide)).size !== catalog.technical_guidance.length) {
    throw new Error("Audit controls must cover every technical guide exactly once.");
  }
  return {
    id: "specialist-audit", variants: VARIANTS, scenarios,
    suite_sha256: hash(Buffer.concat([positiveBytes, Buffer.from("\n"), controlBytes])),
    catalog_sha256: digest,
  };
}

function auditTask(scenario, variant) {
  if (!VARIANTS.includes(variant)) throw new Error(`Unknown audit variant '${variant}'.`);
  const sample = scenario.variants[variant];
  const sourcePath = `audit-samples/${hash(`${scenario.id}/${variant}`).slice(0, 16)}/${scenario.file}`;
  const task = [
    `Review only ${sourcePath}.`,
    `Context: ${sample.context}`,
    "Report concrete correctness, reliability or trust-boundary defects supported by the supplied evidence. Do not manufacture findings to fill a quota. An empty findings array is valid when no defect is established. Put missing evidence and conditional risks in unknowns, not in findings.",
    "An explicit claim of verified behavior contradicted by supplied evidence can be a finding about the claim itself, not proof that the underlying capability is absent. Clearly stated unverified scope is not such a claim.",
    "Do not edit files, execute commands, install dependencies, delegate, browse, access cloud accounts or inspect other sources. Do not claim unrun checks or measurements.",
    "Return exactly one fenced json object with findings (each: id, lines as a nonempty integer array, problem, consequence, correction, confidence), unknowns (string array) and checks_not_run (nonempty string array). Consolidate duplicate root causes.",
    `SOURCE ${sourcePath}\n${sample.source.trimEnd().split("\n").map((line, index) => `${index + 1}: ${line}`).join("\n")}`,
  ].join("\n\n");
  return { task, source_path: sourcePath, source: sample.source };
}

function parseAuditResponse(content, lineCount) {
  const blocks = [...content.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (blocks.length !== 1) throw new Error("Audit response requires exactly one fenced JSON object.");
  let response;
  try { response = JSON.parse(blocks[0][1]); }
  catch (error) { throw new Error(`Invalid audit response JSON: ${error.message}`); }
  if (!response || !Array.isArray(response.findings) || !strings(response.unknowns) ||
      !strings(response.checks_not_run) || !response.checks_not_run.length ||
      new Set(response.findings.map(finding => finding?.id)).size !== response.findings.length) {
    throw new Error("Audit response requires unique findings, unknowns and explicit unrun checks.");
  }
  for (const finding of response.findings) {
    if (!finding || ["id", "problem", "consequence", "correction"].some(key => !nonempty(finding[key])) ||
        !Array.isArray(finding.lines) || !finding.lines.length ||
        finding.lines.some(line => !Number.isInteger(line) || line < 1 || line > lineCount) ||
        !(nonempty(finding.confidence) || (typeof finding.confidence === "number" && Number.isFinite(finding.confidence)))) {
      throw new Error("Audit findings require source-bounded lines, consequence, correction and confidence.");
    }
  }
  return response;
}

function reviewAuditResponse(sample, response, review) {
  if (!review || !nonempty(review.reviewer) || review.reviewer.length > 80 ||
      /[\r\n]/.test(review.reviewer) || !Array.isArray(review.findings) ||
      review.findings.length !== response.findings.length ||
      !Array.isArray(review.unknowns) || ![0, 1, 2].includes(review.scope?.rating) ||
      !nonempty(review.scope.note)) {
    throw new Error("Audit review needs a named reviewer, every finding, evidence gaps and a scope rating.");
  }
  const seen = new Set();
  const detected = new Set();
  let unsupported = 0;
  let duplicates = 0;
  for (const rating of review.findings) {
    const finding = response.findings.find(item => item.id === rating?.finding_id);
    if (!finding || seen.has(finding.id) ||
        !["supported", "unsupported", "duplicate"].includes(rating.verdict) ||
        !nonempty(rating.note) || !Array.isArray(rating.expected_ids) ||
        new Set(rating.expected_ids).size !== rating.expected_ids.length ||
        rating.expected_ids.some(id => !sample.expected.some(issue => issue.id === id)) ||
        (rating.verdict !== "supported" && rating.expected_ids.length)) {
      throw new Error("Audit finding review must classify every unique finding against known oracle IDs.");
    }
    seen.add(finding.id);
    if (rating.verdict === "unsupported") unsupported += 1;
    if (rating.verdict === "duplicate") duplicates += 1;
    for (const id of rating.expected_ids) {
      const expected = sample.expected.find(issue => issue.id === id);
      if (detected.has(id) || !finding.lines.some(line => expected.lines.includes(line))) {
        throw new Error("Audit oracle mapping is duplicate or lacks source-line overlap.");
      }
      detected.add(id);
    }
  }
  const required = sample.required_unknowns || [];
  const gaps = new Set();
  for (const rating of review.unknowns) {
    if (!rating || !required.some(item => item.id === rating.id) || gaps.has(rating.id) ||
        !Number.isInteger(rating.index) || rating.index < 0 || rating.index >= response.unknowns.length ||
        !nonempty(rating.note)) {
      throw new Error("Audit unknown review must cite an actual response unknown and a known evidence gap.");
    }
    gaps.add(rating.id);
  }
  const expectedCount = sample.expected.length;
  return {
    passed: detected.size === expectedCount && unsupported === 0 && duplicates === 0 &&
      (expectedCount > 0 || response.findings.length === 0) &&
      gaps.size === required.length && review.scope.rating === 2,
    findings: response.findings.length, unsupported_findings: unsupported,
    duplicate_findings: duplicates, expected_defects: expectedCount,
    detected_defects: detected.size, missed_defects: expectedCount - detected.size,
    required_unknowns: required.length, acknowledged_unknowns: gaps.size,
  };
}

function buildAuditAcceptance(projectRoot, resultsPath = null) {
  const suite = loadAuditSuite();
  const root = path.resolve(projectRoot);
  const observations = new Map();
  const sessions = new Set();
  if (resultsPath) {
    const { contents } = readProjectFile(root, resultsPath, 1024 * 1024, "Audit results");
    const input = JSON.parse(contents);
    if (!input || input.suite_id !== suite.id || input.suite_sha256 !== suite.suite_sha256 ||
        input.catalog_sha256 !== suite.catalog_sha256 || !Array.isArray(input.trials) ||
        input.trials.length > suite.scenarios.length * VARIANTS.length) {
      throw new Error("Audit results must match current suite/catalog digests with bounded trials.");
    }
    const events = input.trials.length ? readTrialEvents(root) : [];
    for (const trial of input.trials) {
      const scenario = suite.scenarios.find(item => item.id === trial?.scenario_id);
      const key = `${trial?.scenario_id}/${trial?.variant}`;
      if (!scenario || !VARIANTS.includes(trial.variant) || observations.has(key) ||
          !nonempty(trial.session_id) || sessions.has(trial.session_id)) {
        throw new Error("Audit trials require unique known scenarios, variants and SDK sessions.");
      }
      const sample = scenario.variants[trial.variant];
      const { task, source_path } = auditTask(scenario, trial.variant);
      const source = readProjectFile(root, source_path, 16384, "Audit source").contents;
      if (!source.equals(Buffer.from(sample.source))) throw new Error("Audit source changed since its fixture definition.");
      const bytes = readProjectFile(root, trial.response, 256 * 1024, "Audit response").contents;
      const content = bytes.toString("utf8");
      const response = parseAuditResponse(content, sample.source.trimEnd().split("\n").length);
      const session = events.filter(event => event.session_id === trial.session_id);
      const started = session.filter(event => event.event_name === "copilot.execution.started");
      const completed = session.filter(event => event.event_name === "copilot.execution.completed");
      if (started.length !== 1 || started[0].attributes?.task_sha256 !== hash(task) ||
          started[0].attributes.agent !== scenario.agent || completed.length !== 1 ||
          completed[0].attributes?.task_sha256 !== hash(task) ||
          !session.some(event => event.event_name === "copilot.response.received" &&
            event.attributes?.content_sha256 === hash(bytes))) {
        throw new Error("Audit trial requires matching task, agent, response hash and SDK telemetry.");
      }
      const completion = completed[0].attributes;
      let changedPaths = completion.changed_paths;
      if (!Object.hasOwn(completion, "changed_paths")) {
        if (!nonempty(trial.execution_record)) {
          throw new Error("Audit completion without changed_paths requires its original SDK execution record.");
        }
        const executionBytes = readProjectFile(root, trial.execution_record, 256 * 1024, "Audit SDK execution record").contents;
        const execution = JSON.parse(executionBytes);
        if (!execution || execution.session_id !== trial.session_id || execution.agent !== scenario.agent ||
            execution.task_sha256 !== hash(task) || execution.response_sha256 !== hash(bytes) ||
            execution.source_sha256 !== hash(source) || execution.suite_sha256 !== suite.suite_sha256 ||
            execution.catalog_sha256 !== suite.catalog_sha256 || !Array.isArray(execution.changed_paths)) {
          throw new Error("Audit SDK execution record must match the session, task, agent, source and response.");
        }
        changedPaths = execution.changed_paths;
      }
      if (!Array.isArray(changedPaths) || changedPaths.some(file => typeof file !== "string")) {
        throw new Error("Audit execution requires valid changed-path evidence.");
      }
      const review = reviewAuditResponse(sample, response, trial.review);
      const scopeViolation = session.some(event =>
        (["copilot.tool.requested", "copilot.tool.authorization", "copilot.sdk.tool.execution_start"]
          .includes(event.event_name) && !["view", "glob", "grep", "rg"].includes(event.tool_name)) ||
        event.event_name === "copilot.permission.decision");
      observations.set(key, {
        scenario_id: scenario.id, variant: trial.variant, session_id: trial.session_id,
        status: review.passed && completion.outcome === "success" &&
          changedPaths.length === 0 && !scopeViolation ? "passed" : "failed",
        ...review, response_sha256: hash(bytes), task_sha256: hash(task),
        reviewer: trial.review.reviewer, scope_violation: scopeViolation,
        changed_paths: changedPaths, execution_outcome: completion.outcome,
      });
      sessions.add(trial.session_id);
    }
  }
  const scenarios = suite.scenarios.map(scenario => ({
    id: scenario.id, agent: scenario.agent, guide: scenario.guide,
    trials: VARIANTS.map(variant => observations.get(`${scenario.id}/${variant}`) || {
      scenario_id: scenario.id, variant, status: "not-run",
    }),
  }));
  const trials = scenarios.flatMap(scenario => scenario.trials);
  const reviewed = trials.filter(trial => trial.status !== "not-run");
  const sum = key => reviewed.reduce((total, trial) => total + trial[key], 0);
  const controls = reviewed.filter(trial => trial.variant !== "positive");
  const positives = reviewed.filter(trial => trial.variant === "positive");
  const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
  return {
    schema_version: 1, generated_by: "mcpee", suite_id: suite.id,
    suite_sha256: suite.suite_sha256, catalog_sha256: suite.catalog_sha256,
    status: trials.some(trial => trial.status === "failed") ? "failed" :
      trials.every(trial => trial.status === "passed") ? "passed" : "incomplete",
    summary: {
      required_trials: trials.length, reviewed_trials: reviewed.length,
      passed: trials.filter(trial => trial.status === "passed").length,
      failed: trials.filter(trial => trial.status === "failed").length,
      not_run: trials.filter(trial => trial.status === "not-run").length,
      positive_trials_reviewed: positives.length, control_trials_reviewed: controls.length,
      findings: sum("findings"), unsupported_findings: sum("unsupported_findings"),
      duplicate_findings: sum("duplicate_findings"),
      expected_defects_reviewed: sum("expected_defects"), detected_defects: sum("detected_defects"),
      missed_defects: sum("missed_defects"),
      required_unknowns_reviewed: sum("required_unknowns"), acknowledged_unknowns: sum("acknowledged_unknowns"),
      seeded_defect_recall: ratio(sum("detected_defects"), sum("expected_defects")),
      unsupported_finding_share: ratio(sum("unsupported_findings"), sum("findings")),
      control_alarm_rate: ratio(controls.filter(trial => trial.findings > 0).length, controls.length),
    },
    scenarios,
    limitations: [
      "Static synthetic audit acceptance is separate from implementation/runtime specialist-core acceptance.",
      "An empty response is not a pass: positive cases require mapped defects; insufficient cases require source-reviewed evidence gaps.",
      "Reviewer classifications are explicit local assertions, not an automated semantic grader or independent certification.",
      "Null rates mean no reviewed denominator. Control alarm rate counts cases, not findings; it is not a population false-positive estimate.",
      "Unexpected supported findings in a control fail the trial too: review the fixture before declaring a false positive.",
      "No model, tool or command runs during report inspection. Missing trials remain not-run.",
    ],
  };
}

module.exports = { loadAuditSuite, auditTask, parseAuditResponse, reviewAuditResponse, buildAuditAcceptance };
