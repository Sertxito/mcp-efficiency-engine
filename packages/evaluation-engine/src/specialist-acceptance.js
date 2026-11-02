"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readCatalog } = require("../../copilot-renderer/src/render");
const { sourceEvidence } = require("../../memory-engine/src/memory");
const { readEvaluation } = require("./evaluate");
const { readProjectFile } = require("./asset-evaluation");
const { automaticSpecialistReview } = require("./automatic-specialist-review");

const SUITE_PATH = path.resolve(__dirname, "../../../catalog/specialist-acceptance.json");
const MAX_BYTES = 1024 * 1024;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readJson(root, relative, label) {
  const { contents } = readProjectFile(root, relative, MAX_BYTES, label);
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} must contain valid JSON: ${error.message}`);
  }
}

function readTrialEvents(root) {
  const { contents } = readProjectFile(root, ".mcpee/telemetry/events/copilot.jsonl",
    32 * 1024 * 1024, "Specialist execution telemetry");
  return contents.toString("utf8").split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid specialist telemetry at line ${index + 1}: ${error.message}`);
    }
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        typeof event.event_name !== "string") {
      throw new Error(`Invalid specialist telemetry event at line ${index + 1}.`);
    }
    return [event];
  });
}

function loadSpecialistSuite() {
  const bytes = fs.readFileSync(SUITE_PATH);
  const suite = JSON.parse(bytes.toString("utf8"));
  const { catalog, digest } = readCatalog();
  if (suite.schema_version !== 2 || suite.id !== "specialist-core" ||
      JSON.stringify(suite.variants) !== JSON.stringify(["normal", "failure", "boundary"]) ||
      !suite.review_criteria || Object.keys(suite.review_criteria).length !== 3 ||
      !Array.isArray(suite.scenarios) || !suite.scenarios.length) {
    throw new Error("Invalid specialist acceptance suite contract.");
  }
  const seen = new Set();
  for (const scenario of suite.scenarios) {
    if (!scenario || !ID.test(scenario.id) || seen.has(scenario.id) ||
        !catalog.agents.some(agent => agent.id === scenario.agent) ||
        ["setup", "task", "failure", "boundary", "check"].some(key =>
          typeof scenario[key] !== "string" || !scenario[key].trim()) ||
        !Array.isArray(scenario.outcomes) || scenario.outcomes.length < 3 ||
        scenario.outcomes.some(value => typeof value !== "string" || !value.trim())) {
      throw new Error(`Invalid specialist scenario: ${scenario?.id}`);
    }
    seen.add(scenario.id);
    const agent = catalog.agents.find(item => item.id === scenario.agent);
    for (const [key, collection] of [["guides", catalog.technical_guidance], ["skills", catalog.skills]]) {
      if (!Array.isArray(scenario[key]) ||
          new Set(scenario[key]).size !== scenario[key].length ||
          scenario[key].some(id => !collection.some(item => item.id === id)) ||
          (key === "skills" && (!scenario.skills.length ||
            scenario.skills.some(id => !agent.skills.includes(id))))) {
        throw new Error(`Invalid ${key} for specialist scenario: ${scenario.id}`);
      }
    }
  }
  for (const agent of catalog.agents) {
    if (!suite.scenarios.some(scenario => scenario.agent === agent.id)) {
      throw new Error(`Specialist suite has no scenario for agent: ${agent.id}`);
    }
  }
  for (const guide of catalog.technical_guidance) {
    if (!suite.scenarios.some(scenario => scenario.guides.includes(guide.id))) {
      throw new Error(`Specialist suite has no scenario for technical guide: ${guide.id}`);
    }
  }
  return {
    suite,
    suite_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    catalog_sha256: digest,
  };
}

function specialistTask(scenario, variant) {
  if (!["normal", "failure", "boundary"].includes(variant)) {
    throw new Error(`Unknown specialist variant: ${variant}`);
  }
  return [
    `Acceptance: ${scenario.id}/${variant}`,
    `Setup: ${scenario.setup}`,
    `Task: ${scenario.task}`,
    `Variant: ${variant === "normal" ? "Exercise the representative successful path." : scenario[variant]}`,
    `Required outcomes:\n${scenario.outcomes.map(item => `- ${item}`).join("\n")}`,
    `Validation: ${scenario.check}`,
    "Use the approved local fixture and its actual versions/conventions. Missing tools or evidence are blockers, not permission to simulate success. Do not access shared/live systems or transfer data without the required approval.",
  ].join("\n\n");
}

function inspectTrial(root, trial, scenario, variant, criteria, events) {
  const { contents } = readProjectFile(root, trial.response, 256 * 1024, "Specialist response");
  if (!contents.toString("utf8").trim()) throw new Error("Specialist response must not be empty.");
  const responseHash = crypto.createHash("sha256").update(contents).digest("hex");
  const run = readJson(root, trial.run_report, "Specialist run report");
  const taskHash = crypto.createHash("sha256").update(specialistTask(scenario, variant)).digest("hex");
  if (!run || run.generated_by !== "mcpee" || run.schema_version !== 1 ||
      typeof run.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(run.id) ||
      run.agent_id !== scenario.agent || run.task_sha256 !== taskHash ||
      typeof run.session_id !== "string" || !run.session_id ||
      !Array.isArray(run.stages)) {
    throw new Error(`Specialist run does not match ${scenario.id}/${variant}.`);
  }
  const responseEvent = events.some(event => event.session_id === run.session_id &&
    event.event_name === "copilot.response.received" &&
    event.attributes?.content_sha256 === responseHash);
  const completionEvent = events.find(event => event.session_id === run.session_id &&
    event.event_name === "copilot.execution.completed" &&
    event.attributes?.task_sha256 === taskHash);
  if (!responseEvent || !completionEvent) {
    throw new Error("Specialist trial requires matching persisted execution and response-hash events.");
  }
  const evaluation = readEvaluation(root, trial.validation_id);
  if (evaluation.task !== specialistTask(scenario, variant) ||
      !evaluation.evidence.length || !evaluation.checks.length ||
      evaluation.evidence.some(item => !item || typeof item.path !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.sha256))) {
    throw new Error("Validation report must match the scenario task and contain hashed artifact evidence.");
  }
  const evidence = sourceEvidence(root, evaluation.evidence.map(item => item.path), evaluation.evidence);
  const evidencePaths = new Set(evidence.map(item => item.path));
  const responsePath = trial.response.replace(/\\/g, "/");
  if (!evidencePaths.has(responsePath) || evidencePaths.size < 2) {
    throw new Error("Validation must bind the response and at least one separate candidate/test/review artifact.");
  }
  const environment = trial.environment;
  if (!environment || ["model", "runtime", "fixture_revision"].some(key =>
    typeof environment[key] !== "string" || !environment[key].trim() || environment[key].length > 200)) {
    throw new Error("Trial environment requires model, runtime and fixture_revision (1-200 characters each).");
  }
  const review = trial.review;
  if (!review || trial.automatic_review) {
    if (trial.automatic_review) {
      const session = events.filter(event => event.session_id === run.session_id);
      const started = session.filter(event => event.event_name === "copilot.execution.started");
      const completed = session.filter(event => event.event_name === "copilot.execution.completed");
      if (started.length !== 1 || completed.length !== 1 ||
          started[0].attributes?.agent !== scenario.agent ||
          started[0].attributes.task_sha256 !== taskHash) {
        throw new Error("Automatic review requires unique matching execution start/completion telemetry.");
      }
      if (session.some(event => event.event_name === "copilot.tool.authorization" &&
          event.attributes?.decision === "deny" ||
          event.event_name === "copilot.permission.decision" &&
          !["policy-approved", "approved-once"].includes(event.attributes?.decision))) {
        return { scenario_id: scenario.id, variant, status: "failed", run_id: run.id,
          validation_id: evaluation.id, response_sha256: responseHash, reviewer: null, environment,
          verification: { status: "failed", reason: "Execution attempted an unauthorized action." } };
      }
    }
    const verification = automaticSpecialistReview(root, trial, scenario, evaluation, completionEvent);
    const executed = completionEvent.attributes.outcome === "success" &&
      run.stages.some(stage => stage.id === "execute" && stage.status === "completed") &&
      evaluation.status === "passed" &&
      evaluation.checks.every(check => check.status === "passed" && check.exit_code === 0);
    return {
      scenario_id: scenario.id, variant, status: executed ? verification.status : "failed",
      run_id: run.id, validation_id: evaluation.id, response_sha256: responseHash,
      reviewer: null, verification, environment,
    };
  }
  if (!review || typeof review.reviewer !== "string" || !review.reviewer.trim() ||
      review.reviewer.length > 80 || /[\r\n]/.test(review.reviewer) ||
      !Array.isArray(review.ratings) || review.ratings.length !== Object.keys(criteria).length ||
      !Array.isArray(review.outcome_ratings) ||
      review.outcome_ratings.length !== scenario.outcomes.length) {
    throw new Error("Each trial requires a named reviewer, every review criterion and every scenario outcome.");
  }
  const seen = new Set();
  for (const rating of review.ratings) {
    if (!rating || !Object.hasOwn(criteria, rating.criterion) || seen.has(rating.criterion) ||
        ![0, 1, 2].includes(rating.rating) ||
        typeof rating.note !== "string" || !rating.note.trim() || rating.note.length > 2000 ||
        !Array.isArray(rating.evidence) || !rating.evidence.length ||
        rating.evidence.some(file => typeof file !== "string" ||
          !evidencePaths.has(file.replace(/\\/g, "/")))) {
      throw new Error("Review ratings require unique known criteria, scores 0-2, rationale and validation-bound evidence paths.");
    }
    seen.add(rating.criterion);
  }
  const outcomeIndexes = new Set();
  for (const rating of review.outcome_ratings) {
    if (!rating || !Number.isInteger(rating.index) ||
        rating.index < 0 || rating.index >= scenario.outcomes.length ||
        outcomeIndexes.has(rating.index) || rating.outcome !== scenario.outcomes[rating.index] ||
        ![0, 1, 2].includes(rating.rating) ||
        typeof rating.note !== "string" || !rating.note.trim() || rating.note.length > 2000 ||
        !Array.isArray(rating.evidence) || !rating.evidence.length ||
        rating.evidence.some(file => typeof file !== "string" ||
          !evidencePaths.has(file.replace(/\\/g, "/")))) {
      throw new Error("Outcome ratings must cover each exact scenario outcome once with a score, rationale and validation-bound evidence.");
    }
    outcomeIndexes.add(rating.index);
  }
  const passed = completionEvent.attributes.outcome === "success" &&
    run.stages.some(stage => stage.id === "execute" && stage.status === "completed") &&
    evaluation.status === "passed" &&
    evaluation.checks.every(check => check.status === "passed" && check.exit_code === 0) &&
    review.ratings.every(rating => rating.rating === 2) &&
    review.outcome_ratings.every(rating => rating.rating === 2);
  return {
    scenario_id: scenario.id, variant, status: passed ? "passed" : "failed",
    run_id: run.id, validation_id: evaluation.id, response_sha256: responseHash,
    reviewer: review.reviewer, review_ratings: review.ratings,
    outcome_ratings: review.outcome_ratings, environment,
  };
}

function buildSpecialistAcceptance(projectRoot, resultsPath = null) {
  const root = path.resolve(projectRoot);
  const { suite, suite_sha256, catalog_sha256 } = loadSpecialistSuite();
  let trials = [];
  if (resultsPath) {
    const input = readJson(root, resultsPath, "Specialist results");
    if (!input || input.suite_id !== suite.id || input.suite_sha256 !== suite_sha256 ||
        input.catalog_sha256 !== catalog_sha256 || !Array.isArray(input.trials) ||
        input.trials.length > suite.scenarios.length * suite.variants.length) {
      throw new Error("Specialist results must match the current suite/catalog digests and contain bounded trials.");
    }
    trials = input.trials;
  }
  const byKey = new Map();
  const usedRuns = new Set();
  const usedValidations = new Set();
  const events = trials.length ? readTrialEvents(root) : [];
  for (const trial of trials) {
    const scenario = suite.scenarios.find(item => item.id === trial?.scenario_id);
    if (!scenario || !suite.variants.includes(trial.variant)) {
      throw new Error("Specialist results contain an unknown scenario or variant.");
    }
    const key = `${scenario.id}/${trial.variant}`;
    if (byKey.has(key) || usedRuns.has(trial.run_report) || usedValidations.has(trial.validation_id)) {
      throw new Error("Specialist trials cannot duplicate scenarios or reuse execution/validation reports.");
    }
    const observation = inspectTrial(root, trial, scenario, trial.variant, suite.review_criteria, events);
    if (usedRuns.has(observation.run_id)) throw new Error("Specialist trials cannot reuse an execution ID.");
    usedRuns.add(trial.run_report);
    usedRuns.add(observation.run_id);
    usedValidations.add(trial.validation_id);
    byKey.set(key, observation);
  }
  const scenarios = suite.scenarios.map(scenario => ({
    ...scenario,
    trials: suite.variants.map(variant => byKey.get(`${scenario.id}/${variant}`) || {
      scenario_id: scenario.id, variant, status: "not-run",
    }),
  }));
  const outcomes = scenarios.flatMap(scenario => scenario.trials);
  const requiredOutcomeChecks = suite.scenarios.reduce((total, scenario) =>
    total + scenario.outcomes.length * suite.variants.length, 0);
  const outcomeCounts = { verified: 0, partial: 0, not_demonstrated: 0, unverified: 0 };
  for (const scenario of scenarios) {
    for (const trial of scenario.trials) {
      const expected = scenario.outcomes.length;
      const ratings = trial.outcome_ratings ||
        (trial.verification?.status === "passed" ? trial.verification.verified_outcomes : null) || [];
      for (const rating of ratings) {
        if (rating.rating === 2 && trial.status === "passed") outcomeCounts.verified += 1;
        else if (rating.rating === 2) outcomeCounts.unverified += 1;
        else if (rating.rating === 1) outcomeCounts.partial += 1;
        else if (rating.rating === 0) outcomeCounts.not_demonstrated += 1;
      }
      outcomeCounts.unverified += expected - ratings.length;
    }
  }
  return {
    schema_version: 1, generated_by: "mcpee", suite_id: suite.id,
    suite_sha256, catalog_sha256,
    status: outcomes.some(item => item.status === "failed") ? "failed" :
      outcomes.every(item => item.status === "passed") ? "passed" : "incomplete",
    summary: {
      scenarios: scenarios.length,
      required_trials: outcomes.length,
      passed: outcomes.filter(item => item.status === "passed").length,
      failed: outcomes.filter(item => item.status === "failed").length,
      not_run: outcomes.filter(item => item.status === "not-run").length,
      awaiting_verification: outcomes.filter(item => item.status === "awaiting-verification").length,
      automatically_verified: outcomes.filter(item =>
        item.status === "passed" && item.verification?.method === "automatic-behavioral-oracle").length,
      required_outcome_checks: requiredOutcomeChecks,
      verified_outcomes: outcomeCounts.verified,
      partial_outcomes: outcomeCounts.partial,
      not_demonstrated_outcomes: outcomeCounts.not_demonstrated,
      unverified_outcomes: outcomeCounts.unverified,
    },
    review_criteria: suite.review_criteria,
    scenarios,
    limitations: [
      "No model or command is executed by this report. Missing trials remain not-run.",
      "Passing is bounded to these scenarios, fixtures, recorded environments and reviewed oracles, not general specialist certification or a statistical coverage percentage.",
      "Every manual review rates every exact scenario outcome and cites validation-bound artifacts; automated oracles report their verified outcome mapping.",
      "Command success alone is insufficient. Supported automatic oracles bind unchanged checks, a failing baseline, current artifacts and scope evidence; other scenarios need sufficient technical review.",
      "Missing semantic verification remains awaiting-verification, not a compulsory approval or a pass. Local reports and reviewer statements are not tamper-proof.",
      "Evidence must remain unchanged and execution telemetry must be retained. Changed suite/catalog content requires new results.",
    ],
  };
}

module.exports = { loadSpecialistSuite, specialistTask, buildSpecialistAcceptance, readTrialEvents };
