"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const catalogRoot = path.join(packageRoot, "catalog");
const npmCli = process.env.npm_execpath;

if (!npmCli || !fs.existsSync(npmCli)) {
  throw new Error("Run pack:check through npm so npm_execpath is available.");
}

function runNpm(args, cwd = packageRoot) {
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 120_000,
  });
}

function packResult(output) {
  const result = JSON.parse(output);
  const candidates = Array.isArray(result) ? result : [result, ...Object.values(result ?? {})];
  const pack = candidates.find((candidate) => candidate && Array.isArray(candidate.files));
  assert.ok(pack, "npm pack did not return a file manifest");
  return pack;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-package-check-"));
try {
  const dryRun = packResult(runNpm(["pack", "--dry-run", "--json"]));
  const packagedFiles = new Set(dryRun.files.map(({ path: filePath }) =>
    filePath.replace(/\\/g, "/")));
  const catalog = JSON.parse(fs.readFileSync(path.join(catalogRoot, "catalog.json"), "utf8"));
  const references = [];

  function collectReferences(value, key = "") {
    if (Array.isArray(value)) {
      for (const entry of value) collectReferences(entry, key);
      return;
    }
    if (!value || typeof value !== "object") {
      if (typeof value === "string" && ["path", "source_path", "supporting_source_paths"].includes(key)) {
        references.push(value);
      }
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) {
      collectReferences(childValue, childKey);
    }
  }

  collectReferences(catalog);

  const missing = [...new Set(references)]
    .map((reference) => reference.replace(/^mcpee[\\/]/, "").replace(/\\/g, "/"))
    .filter((reference) => !packagedFiles.has(reference));
  assert.deepEqual(missing, [], `Catalog sources missing from npm package:\n${missing.join("\n")}`);

  const unexpected = [...packagedFiles].filter((filePath) =>
    filePath.startsWith("boost_") ||
    filePath.startsWith("mcp-efficiency-engine/") ||
    filePath.startsWith("node_modules/") ||
    filePath.startsWith(".mcpee/") ||
    filePath.startsWith(".github/") ||
    filePath.startsWith(".codegraph/") ||
    filePath.startsWith("knowledge/") ||
    filePath.startsWith("docs/generated/") ||
    /^templates\/specialist-acceptance\/.*\/(?:bin|obj)\//.test(filePath) ||
    /(?:^|\/)\.env(?:\.|$)/.test(filePath));
  assert.deepEqual(unexpected, [], `Unexpected files in npm package:\n${unexpected.join("\n")}`);
  const metadata = require(path.join(packageRoot, "package.json"));
  assert.equal(metadata.name, "mcp-efficiency-engine");
  assert.equal(dryRun.version, metadata.version);
  assert.equal(metadata.bin.mcpee, metadata.bin["mcp-efficiency-engine"]);
  assert.ok(packagedFiles.has("LICENSE"));
  for (const required of [
    "catalog/specialist-acceptance.json",
    "docs/SPECIALIST-ACCEPTANCE.md",
    "templates/specialist-acceptance/node-bounded-operation/worker.cjs",
    "templates/specialist-acceptance/node-bounded-operation/checks.cjs",
    "templates/specialist-acceptance/audit-fixtures.json",
    "templates/specialist-acceptance/audit-controls.json",
  ]) {
    assert.ok(packagedFiles.has(required), `Missing specialist acceptance asset: ${required}`);
  }

  const archiveRoot = path.join(tempRoot, "archive");
  const consumerRoot = path.join(tempRoot, "consumer");
  fs.mkdirSync(archiveRoot);
  fs.mkdirSync(consumerRoot);
  const actualPack = packResult(runNpm(["pack", "--json", "--pack-destination", archiveRoot]));
  const tarball = path.join(archiveRoot, actualPack.filename);
  const tarballReference = `file:../archive/${actualPack.filename}`;
  const consumer = { name: "mcpee-package-consumer", version: "1.0.0", private: true,
    dependencies: { [metadata.name]: tarballReference } };
  const consumerLock = JSON.parse(fs.readFileSync(path.join(packageRoot, "package-lock.json"), "utf8"));
  consumerLock.name = consumer.name;
  consumerLock.version = consumer.version;
  consumerLock.packages[""] = consumer;
  consumerLock.packages[`node_modules/${metadata.name}`] = {
    version: metadata.version,
    resolved: tarballReference,
    integrity: `sha512-${crypto.createHash("sha512").update(fs.readFileSync(tarball)).digest("base64")}`,
    dependencies: metadata.dependencies,
    bin: metadata.bin,
    license: metadata.license,
    engines: metadata.engines,
  };
  fs.writeFileSync(path.join(consumerRoot, "package.json"), JSON.stringify(consumer));
  fs.writeFileSync(path.join(consumerRoot, "package-lock.json"), JSON.stringify(consumerLock));
  runNpm([
    "ci",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix",
    consumerRoot,
  ]);

  const installedCli = path.join(
    consumerRoot,
    "node_modules",
    "mcp-efficiency-engine",
    "packages",
    "cli",
    "bin",
    "mcpee.js",
  );
  const acceptance = spawnSync(process.execPath, [
    installedCli, "evaluate", "--suite", "specialist-core", "--project", consumerRoot, "--json",
  ], { cwd: consumerRoot, encoding: "utf8", timeout: 30_000 });
  assert.equal(acceptance.status, 2, acceptance.stderr);
  const acceptanceReport = JSON.parse(acceptance.stdout);
  assert.equal(acceptanceReport.status, "incomplete");
  assert.equal(acceptanceReport.summary.passed, 0);
  assert.equal(new Set(acceptanceReport.scenarios.map(scenario => scenario.agent)).size, catalog.agents.length);
  for (const command of ["mcpee", "mcp-efficiency-engine"]) {
    assert.match(runNpm(["exec", "--offline", "--", command, "help"], consumerRoot), /MCPEE/);
  }
  const projectRoot = path.join(tempRoot, "consumer-project");
  fs.mkdirSync(projectRoot);
  const codeGraphRoot = path.join(
    projectRoot,
    ".mcpee",
    "tools",
    "npm",
    "node_modules",
  );
  const codeGraphPackage = path.join(codeGraphRoot, "@colbymchenry", "codegraph");
  const codeGraphPlatform = path.join(
    codeGraphRoot,
    `@colbymchenry/codegraph-${process.platform}-${process.arch}`,
  );
  fs.mkdirSync(codeGraphPackage, { recursive: true });
  fs.mkdirSync(codeGraphPlatform, { recursive: true });
  fs.writeFileSync(
    path.join(codeGraphPackage, "package.json"),
    JSON.stringify({ name: "@colbymchenry/codegraph", version: "1.6.2" }),
  );
  fs.writeFileSync(path.join(codeGraphPlatform, "package.json"), JSON.stringify({ version: "1.6.2" }));
  fs.writeFileSync(path.join(codeGraphPackage, "npm-shim.js"), [
    '"use strict";',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const action = process.argv[2];",
    "const graphDir = process.env.CODEGRAPH_DIR;",
    "const indexPath = path.join(graphDir, 'consumer-fixture.json');",
    "if (action === '--version') process.stdout.write('1.6.2');",
    "else if (action === 'status') process.stdout.write(JSON.stringify({ initialized: fs.existsSync(indexPath), version: '1.6.2', fileCount: 1, nodeCount: 1, edgeCount: 0 }));",
    "else if (action === 'init' || action === 'sync') { fs.mkdirSync(graphDir, { recursive: true }); fs.writeFileSync(indexPath, '{}'); }",
    "else if (action === 'query') process.stdout.write('[]');",
    "else process.exitCode = 2;",
  ].join("\n"));

  const coverageOutput = execFileSync(process.execPath, [
    installedCli,
    "coverage",
    "--json",
  ], {
    cwd: consumerRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 30_000,
  });
  assert.doesNotThrow(() => JSON.parse(coverageOutput));
  const auditInspection = spawnSync(process.execPath, [
    installedCli, "evaluate", "--suite", "specialist-audit", "--json",
  ], { cwd: consumerRoot, encoding: "utf8", timeout: 30_000 });
  assert.equal(auditInspection.status, 2, auditInspection.stderr);
  const auditReport = JSON.parse(auditInspection.stdout);
  assert.equal(auditReport.summary.required_trials, 42);
  assert.equal(auditReport.summary.not_run, 42);
  assert.equal(auditReport.summary.control_alarm_rate, null);
  const initOutput = execFileSync(process.execPath, [
    installedCli,
    "init",
    "--project",
    projectRoot,
    "--skip-tool-install",
    "--embeddings",
    "none",
  ], {
    cwd: consumerRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  assert.match(initOutput, /Project files configured/);
  assert.match(initOutput, /SETUP COMPLETE/);
  assert.match(initOutput, /CodeGraph not applicable/);
  assert.equal(fs.existsSync(path.join(projectRoot, ".git")), false);
  fs.writeFileSync(path.join(projectRoot, "app.js"), "module.exports = () => 'consumer application';\n");
  const codeInitOutput = execFileSync(process.execPath, [
    installedCli, "init", "--project", projectRoot,
    "--skip-tool-install", "--embeddings", "none",
  ], {
    cwd: consumerRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  assert.match(codeInitOutput, /CodeGraph init completed/);
  assert.ok(fs.existsSync(path.join(projectRoot, ".github", "copilot-instructions.md")));
  assert.ok(fs.existsSync(path.join(projectRoot, ".mcpee", "generated", "project-capabilities.json")));

  const userInstructions = path.join(projectRoot, ".github", "copilot-instructions.md");
  const customContent = "# Consumer-owned instructions\n\nPreserve this project's conventions.\n";
  fs.writeFileSync(userInstructions, customContent);
  const installedRoot = path.resolve(path.dirname(installedCli), "../../..");
  const { initializeProject } = require(path.join(installedRoot, "packages", "core", "src", "project.js"));
  initializeProject(projectRoot, { refreshRuntime: true, packageRoot: installedRoot });
  assert.equal(fs.readFileSync(userInstructions, "utf8"), customContent);
  assert.match(fs.readFileSync(path.join(projectRoot, ".github", "instructions", "mcpee-catalog.instructions.md"), "utf8"), /Git is optional/);
  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcpee", "state", "mcp-server.json"), "utf8"));
  assert.equal(state.package_root, installedRoot);

  execFileSync(process.execPath, [
    installedCli, "trace", "--project", projectRoot, "--otlp", "reports/package-trace.otlp.json", "--limit", "1",
  ], { cwd: consumerRoot, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  const otlp = JSON.parse(fs.readFileSync(path.join(projectRoot, "reports", "package-trace.otlp.json"), "utf8"));
  assert.ok(otlp.resourceSpans[0].scopeSpans[0].spans.length > 0);
  assert.equal(otlp.resourceSpans[0].resource.attributes[0].value.stringValue, "mcpee");

  process.stdout.write(`Verified ${references.length} catalog source references in ${dryRun.files.length} packaged files; installed CLI coverage, specialist acceptance inspection, init, refresh preserving user instructions, and real OpenTelemetry export passed. CodeGraph uses a local contract fixture, not a real indexing test.\n`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
