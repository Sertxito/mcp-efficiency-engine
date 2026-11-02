"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readCatalog } = require("../../copilot-renderer/src/render");
const { readProjectFile } = require("./asset-evaluation");
const { readEvaluation } = require("./evaluate");
const { sourceEvidence } = require("../../memory-engine/src/memory");

const FIXTURES = path.resolve(__dirname, "../../../templates/specialist-acceptance");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const MARKER = "MCPEE_ORACLE_RESULT ";
const definitions = [
  {
    id: "node-bounded-operation",
    guides: ["node-engineering"],
    fixture: "node-bounded-operation",
    mutable: ["worker.cjs"],
    immutable: ["checks.cjs"],
    command: { tool: "node", args: ["--test", "--test-reporter=tap", "checks.cjs"], timeout_ms: 15000 },
    output: "node-tap",
    checks: [
      "normal: bounded parallelism and stable result ordering",
      "failure: rejected and synchronously thrown worker errors are propagated",
      "failure: no new work is scheduled after a worker failure",
      "failure: one runner failing stops other runners from taking more work",
      "failure: falsy thrown reasons are not mistaken for successful completion",
      "failure: cancellation stops scheduling and reaches the worker",
      "boundary: pre-aborted input never starts work",
      "failure: scheduler observes cancellation even when a worker returns normally",
      "boundary: invalid limits reject and empty input is valid",
      "boundary: abort listeners are removed after success, failure and cancellation",
    ],
    scope: "Native Node bounded scheduling, stable result ordering, errors, cancellation and abort-listener ownership.",
    limitations: ["Not server, stream, browser, TypeScript compiler or package-install acceptance."],
  },
  {
    id: "python-resource-lifetime",
    guides: ["python-engineering"],
    fixture: "python-resource-lifetime",
    mutable: ["worker.py"],
    immutable: ["checks.py"],
    command: { tool: "python", args: ["-B", "checks.py"], timeout_ms: 60000 },
    failure_output: "python-unittest",
    checks: [
      "test_cancellation_closes_resources_and_joins_workers",
      "test_failure_joins_siblings",
      "test_invalid_limit_does_not_open",
      "test_open_failure_is_not_partial_success",
      "test_order_and_capacity",
      "test_unicode_and_empty",
      "test_worker_failure_is_preserved_and_closed",
    ],
    scope: "Native asyncio ordering, bounded scheduling, cancellation and owned-resource cleanup with in-process I/O doubles.",
    limitations: ["Not built-package, type-checker, filesystem or multi-interpreter acceptance."],
  },
  {
    id: "sql-result-semantics",
    guides: ["sql-engineering"],
    fixture: "sql-result-semantics",
    mutable: ["eligible.sql", "totals.sql", "page.sql"],
    immutable: ["checks.py"],
    command: { tool: "python", args: ["-B", "checks.py"], timeout_ms: 60000 },
    failure_output: "python-unittest",
    checks: [
      "test_antijoin_empty_sets",
      "test_antijoin_normal",
      "test_antijoin_nullable_and_duplicate",
      "test_page_insert_does_not_shift_existing_cursor",
      "test_page_stable_ties_and_boundaries",
      "test_totals_preserve_duplicate_amounts_and_integrity",
      "test_totals_preserve_empty_and_unpaid_customers",
    ],
    scope: "Actual SQLite query results for nullable anti-joins, join multiplicity, paid-order totals and deterministic keyset pagination.",
    limitations: ["Not SQL Server, performance/plan, concurrent transaction, migration or restore acceptance."],
  },
  ...["angular", "react", "vue"].map(framework => ({
    id: `${framework}-runtime`,
    guides: [`${framework}-engineering`, "typescript-engineering"],
    fixture: `frontend-runtime/${framework}`,
    mutable: [`src/candidate.${framework === "react" ? "tsx" : "ts"}`],
    immutable: ["package.json", "package-lock.json", "tsconfig.json", "checks.cjs", "run-oracle.cjs"],
    command: { tool: "node", args: ["run-oracle.cjs"], timeout_ms: 120000 },
    failure_output: "check-list",
    checks: [
      "ts-typecheck", "input-immutability",
      ...(framework === "vue" ? ["reactive-render"] : []),
      "latest-request-wins",
      framework === "angular" ? "destroy-aborts-request" : "unmount-aborts-request",
      "server-render",
    ],
    scope: `Pinned native ${framework} framework APIs, DOM integration, request/lifecycle ownership, server rendering and TypeScript compilation.`,
    limitations: ["DOM harness is not a real browser, accessibility, hydration, performance, multi-version or deployed application acceptance."],
  })),
  {
    id: "terraform-local-lifecycle",
    guides: ["terraform-engineering"],
    fixture: "terraform-local-lifecycle",
    mutable: ["main.tf"],
    immutable: [
      "contract.tf", "cli.tfrc", "run-oracle.cjs",
      "tests/identity.tftest.hcl", "tests/invalid.tftest.hcl",
      "tests/normal.tftest.hcl", "tests/update.tftest.hcl",
    ],
    command: { tool: "node", args: ["run-oracle.cjs"], timeout_ms: 240000 },
    failure_output: "check-list",
    checks: [
      "tests/identity.tftest.hcl/seed", "tests/identity.tftest.hcl/reorder",
      "tests/invalid.tftest.hcl/environment", "tests/invalid.tftest.hcl/duplicate_names",
      "tests/invalid.tftest.hcl/empty_name",
      "tests/normal.tftest.hcl/nonempty", "tests/normal.tftest.hcl/empty",
      "tests/update.tftest.hcl/seed", "tests/update.tftest.hcl/update",
    ],
    scope: "Terraform 1.14.0 native init/validate/test with built-in terraform_data: stable identities, in-place updates, typed input validation and empty-set cleanup.",
    limitations: ["Local built-in provider only; not cloud deployment, remote state locking, drift/restore, external provider or production acceptance."],
  },
  {
    id: "pipeline-runtime",
    guides: ["yaml-pipelines-engineering"],
    fixture: "pipeline-runtime",
    mutable: ["workflow.yml"],
    immutable: [
      "actionlint.yaml", "toolchain.json", "native-tool.cjs", "checks.cjs",
      "run-oracle.cjs", "README.md",
    ],
    command: { tool: "node", args: ["run-oracle.cjs"], timeout_ms: 120000 },
    failure_output: "check-list",
    checks: [
      "native-workflow-schema-and-graph", "native-expression-contracts", "native-script-input-trust",
    ],
    scope: "Checksum-pinned actionlint 1.7.7 native static GitHub Actions schema, job graph, expression and known script-interpolation diagnostics.",
    limitations: ["Native static linter only; not expression evaluation, CI execution, artifact transfer, runtime failure propagation, approvals, releases or deployment acceptance."],
  },
  {
    id: "aws-sdk-runtime",
    guides: ["aws-engineering"],
    fixture: "aws-sdk-runtime",
    mutable: ["scanner.cjs"],
    immutable: [
      "package.json", "package-lock.json", "run-oracle.cjs", "checks.cjs", "transport.cjs", "README.md",
    ],
    command: { tool: "node", args: ["run-oracle.cjs"], timeout_ms: 60000 },
    failure_output: "check-list",
    checks: [
      "native-pagination", "stable-aggregation", "empty-results",
      "inflight-cancellation", "preaborted-cancellation", "service-failure-propagation",
      "owned-transport-cleanup", "borrowed-client-ownership",
    ],
    scope: "Pinned actual AWS SDK against controlled transport: pagination, stable aggregation, cancellation, errors and owned/borrowed client lifetime.",
    limitations: ["Controlled transport only; AWS service behavior, IAM, live endpoints, quotas, deployment and production acceptance remain unverified."],
  },
  {
    id: "azure-sdk-runtime",
    guides: ["azure-engineering"],
    fixture: "azure-bicep-runtime",
    mutable: ["azure-client.cjs"],
    immutable: [
      "README.md", "package.json", "package-lock.json", "checks.cjs",
      "run-oracle.cjs", "main.bicep",
    ],
    command: { tool: "node", args: ["run-oracle.cjs", "azure"], timeout_ms: 60000 },
    failure_output: "check-list",
    checks: [
      "azure-sdk-load", "azure-list-pagination", "azure-request-page-size",
      "azure-transient-retry", "azure-permanent-error-propagation", "azure-abort-propagation",
    ],
    scope: "Pinned Azure Storage SDK pipeline, pagination, XML responses, retry, error and cancellation semantics over controlled transport.",
    limitations: ["Controlled transport only; Azure service behavior, credentials, RBAC, network, deployment and operational acceptance remain unverified."],
  },
  {
    id: "bicep-output-contract",
    guides: ["bicep-engineering"],
    fixture: "azure-bicep-runtime",
    mutable: ["main.bicep"],
    immutable: [
      "README.md", "package.json", "package-lock.json", "checks.cjs",
      "run-oracle.cjs", "azure-client.cjs",
    ],
    command: { tool: "node", args: ["run-oracle.cjs", "bicep"], timeout_ms: 60000 },
    failure_output: "check-list",
    checks: [
      "bicep-compile", "storage-https-only", "storage-tls12", "storage-no-public-blobs",
      "storage-deny-network-default", "storage-output-resource-id", "storage-parameter-wiring",
    ],
    scope: "Pinned actual Bicep compiler emitted ARM assertions for storage security settings, resource IDs and parameter wiring.",
    limitations: ["Compiler/output contract only; Azure what-if, deployment, policy, permissions, service behavior and runtime acceptance remain unverified."],
  },
  {
    id: "cosmos-sdk-runtime",
    guides: ["cosmos-engineering"],
    fixture: "cosmos-sdk-runtime",
    mutable: ["solution.cjs"],
    immutable: [
      "README.md", "checks.cjs", "oracle.json", "package-lock.json", "package.json", "run-oracle.cjs",
    ],
    command: { tool: "node", args: ["run-oracle.cjs"], timeout_ms: 120000 },
    failure_output: "check-list",
    checks: [
      "write-partition-key-routing", "point-read-partition-key-routing", "continuation-pagination",
      "request-cancellation", "point-read-not-found-response", "query-error-propagation",
    ],
    scope: "Pinned actual Cosmos SDK over controlled loopback HTTP: request partition-key routing, continuation, cancellation and response/error propagation.",
    limitations: ["Controlled transport only; Cosmos service partitioning, RU charges, consistency, emulator/live service and operational acceptance remain unverified."],
  },
  {
    id: "dotnet-api-data-change",
    guides: ["dotnet-csharp"],
    fixture: "dotnet-api-data-change",
    mutable: ["Api/OrderQuery.cs"],
    immutable: ["global.json", "Api/Api.csproj", "Api/Program.cs", "Checks/Checks.csproj", "Checks/Program.cs"],
    command: { tool: "dotnet", args: ["run", "--project", path.join("Checks", "Checks.csproj")], timeout_ms: 240000 },
    failure_output: "assertion",
    checks: [
      "di-captive-scope-rejected", "unauthenticated-contract", "validation-error-contract",
      "response-contract-array-dto", "filtered-paged-results", "relational-sql-shape",
      "relational-parameters", "page-bounds", "tenant-isolation", "empty-page-contract",
      "authenticated-tenant-authority", "cancellation-forwarded", "read-only-no-tracking",
      "controlled-overlap-write", "failure-problem-contract", "recovery-after-failure",
      "committed-write-between-reads",
    ],
    scope: "Pinned .NET 10 ASP.NET HTTP/DI contracts, EF Core relational SQLite queries, controlled writes, failure recovery and cancellation.",
    limitations: ["SQLite is not SQL Server or a production database; controlled overlap is not multi-process load, deployment or broad .NET acceptance."],
  },
];

function loadBehavioralOracles() {
  const { catalog, digest: catalog_sha256 } = readCatalog();
  const oracles = definitions.map(definition => {
    if (new Set(definition.checks).size !== definition.checks.length ||
        !definition.guides.every(id => catalog.technical_guidance.some(guide => guide.id === id))) {
      throw new Error(`Invalid behavioral oracle definition '${definition.id}'.`);
    }
    const files = [...definition.mutable, ...definition.immutable].map(file => {
      const { contents } = readProjectFile(FIXTURES, `${definition.fixture}/${file}`,
        1024 * 1024, "Packaged behavioral oracle");
      return { path: file, sha256: hash(contents) };
    });
    return { ...definition, files };
  });
  const suite_sha256 = hash(Buffer.concat([
    Buffer.from(JSON.stringify(oracles)),
    fs.readFileSync(__filename),
  ]));
  const technologies = catalog.technical_guidance.map(guide => ({
    guide: guide.id,
    native_oracles: oracles.filter(oracle => oracle.guides.includes(guide.id)).map(oracle => oracle.id),
    status: oracles.some(oracle => oracle.guides.includes(guide.id)) ? "fixture-available" : "missing-native-fixture",
  }));
  return { id: "technology-runtime", suite_sha256, catalog_sha256, oracles, technologies };
}

function behavioralOracleTask(oracle) {
  return [
    `Behavioral oracle: ${oracle.id}`,
    oracle.scope,
    `Repair only ${oracle.mutable.join(", ")} in the disposable candidate directory.`,
    "Keep the baseline and all oracle/support files unchanged. Do not edit checks, substitute commands, skip tests or fabricate output.",
    "Retain the failing baseline and passing candidate evaluations separately. These checks do not certify every specialist outcome or a production environment.",
  ].join("\n\n");
}

function behavioralRunSpecs(oracle) {
  const task = behavioralOracleTask(oracle);
  return Object.fromEntries(["baseline", "candidate"].map(directory => [directory, {
    task,
    evidence: oracle.files.map(file => `${directory}/${file.path}`),
    checks: [{
      id: oracle.id, label: oracle.scope, ...oracle.command, cwd: directory,
    }],
  }]));
}

function inspectBehavioralEvaluation(root, oracle, id, baseline) {
  const report = readEvaluation(root, id);
  if (report.schema_version !== 1 || report.task !== behavioralOracleTask(oracle) ||
      !Array.isArray(report.checks) || report.checks.length !== 1 ||
      !Array.isArray(report.evidence) || report.evidence.length < oracle.files.length ||
      report.evidence.some(item => !item || typeof item.path !== "string" ||
        typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) ||
      new Set(report.evidence.map(item => item.path.replace(/\\/g, "/"))).size !== report.evidence.length) {
    throw new Error("Behavioral evidence requires an exact task-bound, versioned evaluation with one complete check.");
  }
  sourceEvidence(root, report.evidence.map(item => item.path), report.evidence);
  const check = report.checks[0];
  if (check.tool !== oracle.command.tool ||
      JSON.stringify(check.args) !== JSON.stringify(oracle.command.args) ||
      typeof check.cwd !== "string" || !check.cwd.trim() ||
      check.error || !Number.isInteger(check.timeout_ms) || check.timeout_ms < 1000 ||
      check.timeout_ms > 900000 ||
      !Number.isFinite(check.duration_ms) || check.duration_ms < 0 ||
      check.duration_ms >= check.timeout_ms) {
    throw new Error("Behavioral evidence requires the exact native command completed without a timeout or execution error.");
  }
  const directory = check.cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const resolvedDirectory = path.relative(root, path.resolve(root, check.cwd)).split(path.sep).join("/");
  const fileAt = file => directory === "." ? file : `${directory}/${file}`;
  const evidence = new Map(report.evidence.map(item => [item.path, item.sha256]));
  for (const file of oracle.files) {
    const relative = fileAt(file.path);
    if (!evidence.has(relative)) throw new Error(`Missing behavioral evidence: ${relative}.`);
    if ((baseline || oracle.immutable.includes(file.path)) && evidence.get(relative) !== file.sha256) {
      throw new Error(`Packaged behavioral oracle or baseline changed: ${relative}.`);
    }
  }
  const output = String(check.stdout_tail || "");
  const markers = output.split(/\r?\n/).filter(line => line.startsWith(MARKER));
  if (/MCPEE_ORACLE_SETUP_ERROR/.test(`${output}\n${check.stderr_tail || ""}`) ||
      (!baseline && /^MCPEE_ORACLE_FAILURE /m.test(output))) {
    throw new Error("Native behavioral evidence cannot contain setup errors or conflicting failure results.");
  }
  if (oracle.output === "node-tap") {
    const count = key => {
      const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, "gm"))];
      return matches.length === 1 ? Number(matches[0][1]) : null;
    };
    if (count("tests") !== oracle.checks.length || count("cancelled") !== 0 ||
        count("skipped") !== 0 || count("todo") !== 0 ||
        count("pass") === null || count("fail") === null ||
        count("pass") + count("fail") !== oracle.checks.length ||
        (baseline ? count("fail") < 1 : count("fail") !== 0)) {
      throw new Error("Native Node evidence requires every behavioral test to finish without skipped, todo or cancelled tests.");
    }
  }
  if (baseline) {
    if (report.status !== "failed" || check.status !== "failed" || check.exit_code !== 1 ||
        markers.length !== 0 || !/(?:not ok|MCPEE_ORACLE_FAILURE)/.test(
          `${check.stdout_tail || ""}\n${check.stderr_tail || ""}`)) {
      throw new Error("Native baseline must fail behavioral assertions, not a missing tool, build or dependency.");
    }
    if (oracle.failure_output) {
      const failures = output.split(/\r?\n/).filter(line => line.startsWith("MCPEE_ORACLE_FAILURE "));
      if (failures.length !== 1) throw new Error("Native baseline requires exactly one structured behavioral failure result.");
      let result;
      try { result = JSON.parse(failures[0].slice("MCPEE_ORACLE_FAILURE ".length)); }
      catch (error) { throw new Error(`Malformed native failure result: ${error.message}`); }
      if (!result || result.schema_version !== 1 || result.id !== oracle.id) {
        throw new Error("Native failure result must identify the exact versioned oracle.");
      }
      if (oracle.failure_output === "python-unittest" &&
          (result.status !== "failed" || result.tests_run !== oracle.checks.length || !Number.isInteger(result.failures) ||
          !Number.isInteger(result.errors) || result.failures < 0 || result.errors < 0 ||
          result.failures + result.errors < 1)) {
        throw new Error("Native Python baseline must complete every unittest and record actual behavioral failures.");
      }
      if (oracle.failure_output === "check-list" &&
          (result.status !== "failed" || !Array.isArray(result.checks) || result.checks.length === 0 ||
           new Set(result.checks).size !== result.checks.length ||
           result.checks.some(id => !oracle.checks.includes(id) || id === "ts-typecheck"))) {
        throw new Error("Native baseline must complete setup and fail known behavioral checks.");
      }
      if (oracle.failure_output === "assertion" &&
          (!oracle.checks.includes(result.check) || typeof result.message !== "string" || !result.message.trim())) {
        throw new Error("Native .NET baseline must fail a known behavioral assertion, not setup or compilation.");
      }
    }
  } else {
    if (oracle.output !== "node-tap") {
      if (markers.length !== 1) throw new Error("Native candidate requires exactly one complete behavioral success marker.");
      let result;
      try { result = JSON.parse(markers[0].slice(MARKER.length)); }
      catch (error) { throw new Error(`Malformed native oracle result: ${error.message}`); }
      if (!result || result.schema_version !== 1 || result.id !== oracle.id || result.status !== "passed" ||
          !Array.isArray(result.checks) || result.checks.length !== oracle.checks.length ||
          new Set(result.checks).size !== oracle.checks.length ||
          result.checks.some(id => !oracle.checks.includes(id))) {
        throw new Error("Native candidate must demonstrate every exact packaged behavioral check without duplicates or omissions.");
      }
    }
    if (report.status !== "passed" || check.status !== "passed" || check.exit_code !== 0) {
      throw new Error("A behavioral success marker cannot override a failed evaluation or process.");
    }
  }
  return { directory: process.platform === "win32" ? resolvedDirectory.toLowerCase() : resolvedDirectory };
}

function buildBehavioralAcceptance(root, resultsPath = null) {
  const suite = loadBehavioralOracles();
  const observations = new Map();
  if (resultsPath) {
    const { contents } = readProjectFile(root, resultsPath, 1024 * 1024, "Native oracle results");
    const input = JSON.parse(contents.toString("utf8"));
    if (!input || input.suite_id !== suite.id || input.suite_sha256 !== suite.suite_sha256 ||
        input.catalog_sha256 !== suite.catalog_sha256 || !Array.isArray(input.trials) ||
        input.trials.length > suite.oracles.length) {
      throw new Error("Native oracle results must match the current suite/catalog and contain bounded unique trials.");
    }
    const used = new Set();
    for (const trial of input.trials) {
      const oracle = suite.oracles.find(item => item.id === trial?.oracle);
      if (!oracle || observations.has(oracle.id) ||
          used.has(trial.baseline_validation_id) || used.has(trial.candidate_validation_id) ||
          trial.baseline_validation_id === trial.candidate_validation_id) {
        throw new Error("Native trials require known unique oracles and separate unreused evaluation IDs.");
      }
      const before = inspectBehavioralEvaluation(root, oracle, trial.baseline_validation_id, true);
      const after = inspectBehavioralEvaluation(root, oracle, trial.candidate_validation_id, false);
      if (before.directory === after.directory) throw new Error("Native baseline and candidate must remain in separate directories.");
      used.add(trial.baseline_validation_id);
      used.add(trial.candidate_validation_id);
      observations.set(oracle.id, {
        oracle: oracle.id, status: "checked-fixture",
        baseline_validation_id: trial.baseline_validation_id,
        candidate_validation_id: trial.candidate_validation_id,
        verified_checks: [...oracle.checks],
      });
    }
  }
  const oracles = suite.oracles.map(oracle => ({
    ...oracle,
    observation: observations.get(oracle.id) || { oracle: oracle.id, status: "not-run" },
  }));
  return {
    schema_version: 1, generated_by: "mcpee", suite_id: suite.id,
    suite_sha256: suite.suite_sha256, catalog_sha256: suite.catalog_sha256,
    status: "incomplete",
    summary: {
      technologies: suite.technologies.length,
      technologies_with_native_fixtures: suite.technologies.filter(item => item.native_oracles.length > 0).length,
      missing_native_fixtures: suite.technologies.filter(item => !item.native_oracles.length).length,
      native_oracles: oracles.length,
      checked_fixtures: observations.size, not_run: oracles.length - observations.size,
      specialist_trials_certified: 0,
    },
    technologies: suite.technologies, oracles,
    limitations: [
      "This suite inventories and verifies bounded native checker fixtures, not model or specialist acceptance.",
      "Static source-pattern probes do not count as native behavioral fixtures.",
      "Current evaluation hashes and exact native commands are required. Local evidence is not tamper-proof.",
      "No model, native command, package install, cloud operation or approval is executed during inspection.",
      "Missing native fixtures and unrun checks remain gaps. Inspection always returns exit 2, not product certification.",
    ],
  };
}

module.exports = {
  loadBehavioralOracles, behavioralOracleTask, behavioralRunSpecs, buildBehavioralAcceptance,
};
