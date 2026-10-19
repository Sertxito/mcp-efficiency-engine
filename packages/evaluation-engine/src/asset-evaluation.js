"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { redact } = require("../../core/src/telemetry");

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RATING_BYTES = 32 * 1024;
const REPORT_DIRECTORY = ".mcpee/reports/asset-evaluations";

function readProjectFile(projectRoot, relative, maxBytes, label) {
  if (typeof relative !== "string" || !relative.trim()) {
    throw new Error(`${label} requires a project-relative file path.`);
  }
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, relative);
  const inside = path.relative(root, absolute);
  if (!inside || inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    throw new Error(`${label} path must remain inside the project.`);
  }
  let current = root;
  for (const part of inside.split(path.sep)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) throw new Error(`${label} file does not exist: ${relative}`);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} file cannot follow symbolic links: ${relative}`);
    }
  }
  if (!fs.statSync(absolute).isFile()) throw new Error(`${label} path must be a file.`);
  const contents = fs.readFileSync(absolute);
  if (contents.length > maxBytes) throw new Error(`${label} file exceeds the ${maxBytes}-byte limit.`);
  return { absolute, contents };
}

function checkLiterals(response, literals, kind, label) {
  if (literals === undefined) return [];
  if (!Array.isArray(literals) ||
      literals.some((literal) => typeof literal !== "string" || !literal.trim() || literal.length > 500)) {
    throw new Error(`${label} ${kind} assertions must be non-empty strings of at most 500 characters.`);
  }
  return literals.map((literal) => {
    const found = response.toLocaleLowerCase("en-US").includes(literal.toLocaleLowerCase("en-US"));
    const passed = kind === "required_literals" ? found : !found;
    return {
      assertion: kind === "required_literals" ? "contains" : "does-not-contain",
      expected_literal: redact(literal),
      status: passed ? "passed" : "failed",
    };
  });
}

function validateRatings(projectRoot, ratingsPath, scorecard, reviewer) {
  if (!ratingsPath) {
    if (reviewer) throw new Error("--reviewer requires --ratings.");
    return { status: "awaiting-review", reviewer: null, ratings: [] };
  }
  if (typeof reviewer !== "string" || !reviewer.trim() || reviewer.trim().length > 80 ||
      /[\r\n]/.test(reviewer)) {
    throw new Error("A single-line --reviewer name of 1-80 characters is required with --ratings.");
  }
  const { contents } = readProjectFile(projectRoot, ratingsPath, MAX_RATING_BYTES, "Scorecard rating");
  let input;
  try {
    input = JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`Scorecard ratings must be valid JSON: ${error.message}`);
  }
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Array.isArray(input.ratings) || input.ratings.length !== scorecard.criteria.length) {
    throw new Error(`Scorecard rating file must rate all ${scorecard.criteria.length} criteria.`);
  }
  const seen = new Set();
  const ratings = input.ratings.map((rating) => {
    if (!rating || typeof rating !== "object" || Array.isArray(rating) ||
        !Number.isInteger(rating.criterion) ||
        rating.criterion < 1 || rating.criterion > scorecard.criteria.length ||
        seen.has(rating.criterion) ||
        !Number.isInteger(rating.rating) || rating.rating < 0 || rating.rating > 2 ||
        typeof rating.evidence !== "string" || !rating.evidence.trim() ||
        rating.evidence.length > 1000) {
      throw new Error("Each scorecard rating must have a unique 1-based criterion, rating 0-2, and evidence (max 1000 characters).");
    }
    seen.add(rating.criterion);
    return {
      criterion: rating.criterion,
      description: scorecard.criteria[rating.criterion - 1],
      rating: rating.rating,
      evidence: redact(rating.evidence.trim()),
    };
  }).sort((left, right) => left.criterion - right.criterion);
  return { status: "reviewed", reviewer: redact(reviewer.trim()), ratings };
}

function writeReport(root, report) {
  const directory = path.join(root, REPORT_DIRECTORY);
  let current = root;
  for (const part of path.relative(root, directory).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to write asset evaluation through symbolic link: ${current}`);
    }
  }
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `${report.id}.json`);
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8", { flag: "wx" });
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
  return destination;
}

function evaluateAssetResponse(projectRoot, options) {
  const root = path.resolve(projectRoot);
  const { evaluationCase, scorecard, assetId, responsePath, ratingsPath, reviewer } = options;
  if (!evaluationCase || !scorecard || typeof assetId !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assetId)) {
    throw new Error("Evaluation requires a catalog case, its scorecard, and a valid asset ID.");
  }
  if (evaluationCase.scorecard !== scorecard.id) {
    throw new Error(`Evaluation case '${evaluationCase.id}' does not use scorecard '${scorecard.id}'.`);
  }
  if (evaluationCase.asset_ids &&
      !evaluationCase.asset_ids.includes("*") &&
      !evaluationCase.asset_ids.includes(assetId)) {
    throw new Error(`Evaluation case '${evaluationCase.id}' does not cover asset '${assetId}'.`);
  }
  const { contents } = readProjectFile(root, responsePath, MAX_RESPONSE_BYTES, "Response");
  const response = contents.toString("utf8");
  const automated = [
    ...checkLiterals(response, evaluationCase.automated_checks?.required_literals || [], "required_literals", "Case"),
    ...checkLiterals(response, evaluationCase.automated_checks?.forbidden_literals || [], "forbidden_literals", "Case"),
  ];
  const human = validateRatings(root, ratingsPath, scorecard, reviewer);
  const failedAssertions = automated.some((assertion) => assertion.status === "failed");
  const failedRatings = human.ratings.some((rating) => rating.rating < 1);
  const status = failedAssertions || failedRatings
    ? "failed"
    : human.status === "reviewed" ? "passed" : "awaiting-review";
  const report = {
    schema_version: 1,
    generated_by: "mcpee",
    evaluation_kind: "agent-asset-response",
    id: crypto.randomUUID(),
    asset_id: assetId,
    case_id: evaluationCase.id,
    scorecard_id: scorecard.id,
    status,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    response: {
      path: responsePath.replace(/\\/g, "/"),
      sha256: crypto.createHash("sha256").update(contents).digest("hex"),
      byte_length: contents.length,
      content_persisted: false,
    },
    automated_assertions: automated,
    human_review: human,
    scorecard_summary: human.status === "reviewed"
      ? {
        maximum: scorecard.criteria.length * 2,
        earned: human.ratings.reduce((total, rating) => total + rating.rating, 0),
        pass_threshold_per_criterion: 1,
      }
      : null,
    limitations: [
      "Literal assertions test only the declared strings and do not establish semantic correctness.",
      "Human rubric ratings record reviewer judgment and supplied evidence; MCPEE does not independently verify that judgment.",
      "The response content is not stored or sent to a model.",
    ],
  };
  const file = writeReport(root, report);
  return {
    ...report,
    file: path.relative(root, file).split(path.sep).join("/"),
  };
}

module.exports = {
  evaluateAssetResponse,
  MAX_RATING_BYTES,
  MAX_RESPONSE_BYTES,
  REPORT_DIRECTORY,
};
