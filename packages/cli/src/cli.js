"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const readline = require("node:readline/promises");
const { reportEmbeddingProgress } = require("./activity");
const { addMemory, listMemory, searchMemory } = require("../../memory-engine/src/memory");
const { initializeProject, PROJECT_DIRECTORIES, approvalHookInstalled } = require("../../core/src/project");
const {
  readEvents,
  recordEvent,
  TELEMETRY_FILE,
  TELEMETRY_RETENTION_DAYS,
  evaluateTelemetryIntegrity,
  writeLocalTelemetryExport,
  writeLocalReport,
  writeLocalTelemetryEventsExport,
  withTelemetryContext,
  redact,
} = require("../../core/src/telemetry");
const { searchKnowledge, searchKnowledgeVector, syncProject } = require("../../source-engine/src/sync");
const {
  BGE_MODEL,
  BGE_PACKAGES,
  MODEL: EMBEDDING_MODEL,
  STATE_PATH: EMBEDDING_STATE_PATH,
  buildEmbeddingIndex,
  downloadBgeModel,
  localBgeEmbeddingStatus,
  localEmbeddingStatus,
  projectEmbeddingProfile,
  searchGroundedContext,
  writeGeneratedJson,
} = require("../../source-engine/src/embeddings");
const {
  readCodeGraphState,
  searchCodeGraph,
  updateCodeGraph,
} = require("../../knowledge-engine/src/codegraph");
const { readGraphifyState, searchGraphify } = require("../../knowledge-engine/src/graphify");
const {
  analyzeImpact,
  getDocumentContradictions,
  getDocumentDrift,
  searchUnifiedGraph,
  GRAPH_PATH,
} = require("../../knowledge-engine/src/unified");
const {
  discoverTools,
  installCatalogTools,
  installPythonEnvironment,
  saveToolReport,
  validateTools,
} = require("../../tool-manager/src/tools");
const { evaluateExecution, MAX_CHECKS } = require("../../evaluation-engine/src/evaluate");
const { evaluateAssetResponse } = require("../../evaluation-engine/src/asset-evaluation");
const {
  buildSpecialistAcceptance, loadSpecialistSuite, specialistTask,
} = require("../../evaluation-engine/src/specialist-acceptance");
const { loadAuditSuite, auditTask, buildAuditAcceptance } = require("../../evaluation-engine/src/audit-acceptance");
const { runWorkflow } = require("../../workflow-engine/src/workflow");
const { auditHarness } = require("../../asset-audit/src/audit");
const { buildSkillHealth } = require("../../asset-audit/src/skill-health");
const { createPlan, listPlans } = require("../../planning-engine/src/planning");
const {
  checkSpecDrift,
  discoverBrownfieldSpec,
  listBrownfieldSpecs,
  ratifyBrownfieldSpec,
  prepareApprovedSpecContext,
} = require("../../spec-engine/src/brownfield");
const { generateProjectDocumentation } = require("../../documentation-engine/src/generate");
const { decideLearning, listLearning, proposeLearning } = require("../../learning-engine/src/learning");
const { routeTask } = require("../../routing-engine/src/route");
const { packRelevantContext, runCopilotTask } = require("../../execution-engine/src/copilot");
const { writeRunReport } = require("../../execution-engine/src/run-report");
const {
  capabilityRegistry,
  manageCapability,
  readCatalog,
  renderCatalog,
} = require("../../copilot-renderer/src/render");
const {
  detectProjectCapabilities,
} = require("../../copilot-renderer/src/project-capabilities");
const {
  buildCatalogCoverageReport,
  buildQualityGateReport,
} = require("../../validation-engine/src/quality-gates");
const {
  completeTask,
  decideTask,
  listTasks,
  startTask,
} = require("../../core/src/tasks");
const { formatApprovalArguments } = require("../../core/src/approval");
const { summarizeInventory } = require("../../cloud-engine/src/cli-evidence");
const { renderObservationHtml } = require("./observation-html");

const INITIAL_APPROVAL_BROKER = {
  url: process.env.MCPEE_APPROVAL_BROKER_URL || "",
  token: process.env.MCPEE_APPROVAL_BROKER_TOKEN || "",
};
const CHAT_RESULT_MARKER = process.env.MCPEE_CHAT_RESULT_MARKER || "";
const MAX_VALIDATION_SCAN_DIRECTORIES = 10_000;
const VALIDATION_SCAN_IGNORES = new Set([
  ".git", ".mcpee", ".venv", "venv", "__pycache__", "node_modules",
  "vendor", "dist", "build", "coverage", "target", "bin", "obj",
]);
const PROJECT_VALIDATION_SCRIPTS = [
  ["test:ci", "test-ci"],
  ["test:unit:ci", "test-unit-ci"],
  ["test", "test"],
  ["lint", "lint"],
  ["typecheck", "typecheck"],
  ["check", "check"],
  ["build", "build"],
];
const TELEMETRY_COMMANDS = new Set([
  "evaluate", "workflow", "sync", "rebuild", "update", "learn", "tasks", "memory", "specs",
]);

function optionValue(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] || fallback);
}

function hasPytestConfiguration(filename, contents) {
  if (filename === "pytest.ini") return true;
  if (filename === "pyproject.toml") return /^\s*\[tool\.pytest(?:\.|\s*\])/m.test(contents);
  if (filename === "setup.cfg") return /^\s*\[tool:pytest\]\s*$/m.test(contents);
  if (filename !== "tox.ini") return false;
  let inTestEnvironment = false;
  for (const line of contents.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      inTestEnvironment = /^testenv(?:$|:)/i.test(section[1]);
    } else if (inTestEnvironment && /\bpytest\b/i.test(line)) {
      return true;
    }
  }
  return false;
}

function scanValidationFiles(root) {
  const files = [];
  const directories = [""];
  let scannedDirectories = 0;
  while (directories.length) {
    const relativeDirectory = directories.pop();
    const absoluteDirectory = path.join(root, relativeDirectory);
    scannedDirectories += 1;
    if (scannedDirectories > MAX_VALIDATION_SCAN_DIRECTORIES) {
      throw new Error(`Validation discovery exceeded ${MAX_VALIDATION_SCAN_DIRECTORIES} project directories.`);
    }
    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!VALIDATION_SCAN_IGNORES.has(entry.name.toLowerCase())) {
          directories.push(relativePath);
        }
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function validationStepId(parts) {
  return parts.join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function findDotnetTargets(root, projectFiles) {
  const solutions = projectFiles.filter((file) => /\.(?:sln|slnx)$/i.test(file));
  const dotnetProjects = projectFiles.filter((file) => /\.(?:csproj|fsproj|vbproj)$/i.test(file));
  if (!solutions.length) return dotnetProjects;

  const referencedProjects = new Set();
  for (const solution of solutions) {
    const contents = fs.readFileSync(path.join(root, solution), "utf8");
    const references = /\.slnx$/i.test(solution)
      ? [...contents.matchAll(/<Project\b[^>]*\bPath\s*=\s*["']([^"']+\.(?:csproj|fsproj|vbproj))["']/gi)]
        .map((match) => match[1])
      : [...contents.matchAll(/Project\([^)]*\)\s*=\s*"[^"]*"\s*,\s*"([^"]+\.(?:csproj|fsproj|vbproj))"/gi)]
        .map((match) => match[1]);
    for (const reference of references) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(solution), reference.replace(/\\/g, "/"))).toLowerCase();
      referencedProjects.add(resolved);
    }
  }
  const standaloneProjects = dotnetProjects.filter((project) =>
    !referencedProjects.has(project.toLowerCase()));
  return [...solutions, ...standaloneProjects];
}

function provisionWorkflowSpecs(root, toolReport, knownCapabilities = null) {
  const availableTools = new Set(
    toolReport.tools
      .filter((tool) => tool.available && tool.invokable !== false)
      .map((tool) => tool.id),
  );
  const checks = [];
  const evidence = [];
  const capabilities = knownCapabilities || detectProjectCapabilities(root, readCatalog().catalog);
  const technologyIdsByEvidence = new Map();
  for (const technology of capabilities.detected_technologies || []) {
    for (const evidencePath of technology.evidence || []) {
      const ids = technologyIdsByEvidence.get(evidencePath) || [];
      ids.push(technology.id);
      technologyIdsByEvidence.set(evidencePath, ids);
    }
  }
  let projectFiles;
  try {
    projectFiles = scanValidationFiles(root);
  } catch (error) {
    return { status: "failed", reason: `Cannot discover project validation files: ${error.message}` };
  }

  const addCheck = (idParts, label, tool, args, cwd, evidencePath) => {
    const baseId = validationStepId(idParts);
    const id = checks.some((check) => check.id === baseId)
      ? `${baseId}-${crypto.createHash("sha256").update(idParts.join("/")).digest("hex").slice(0, 8)}`
      : baseId;
    if (!id || checks.some((check) => check.id === id)) {
      throw new Error(`Validation checks produce a duplicate or invalid step id: ${id || idParts.join("/")}`);
    }
    checks.push({
      id,
      label,
      tool,
      args,
      cwd,
      evidence: [evidencePath],
      covers_technologies: [...new Set(technologyIdsByEvidence.get(evidencePath) || [])].sort(),
      requires_approval: true,
    });
    evidence.push(evidencePath);
  };

  if (availableTools.has("npm")) {
    for (const manifestPath of projectFiles.filter((file) => path.posix.basename(file) === "package.json")) {
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), "utf8"));
      } catch (error) {
        return { status: "failed", reason: `Cannot read ${manifestPath} validation scripts: ${error.message}` };
      }
      const scripts = manifest?.scripts;
      if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) continue;
      const declaredScripts = PROJECT_VALIDATION_SCRIPTS
        .filter(([scriptName]) => typeof scripts[scriptName] === "string" && scripts[scriptName].trim());
      const selectedScripts = declaredScripts
        .filter(([scriptName]) => scriptName !== "test" ||
          !declaredScripts.some(([declaredName]) =>
            declaredName === "test:ci" || declaredName === "test:unit:ci"));
      const cwd = path.posix.dirname(manifestPath) === "." ? "." : path.posix.dirname(manifestPath);
      for (const [scriptName, scriptId] of selectedScripts) {
        addCheck(
          [cwd === "." ? "" : cwd, "npm", scriptId].filter(Boolean),
          `npm run ${scriptName}${cwd === "." ? "" : ` (${cwd})`}`,
          "npm",
          ["run", scriptName],
          cwd,
          manifestPath,
        );
      }
    }
  }

  if (availableTools.has("python")) {
    const pythonConfigs = projectFiles.filter((file) =>
      ["pytest.ini", "pyproject.toml", "tox.ini", "setup.cfg"].includes(path.posix.basename(file)));
    for (const configPath of pythonConfigs) {
      let config;
      try {
        config = fs.readFileSync(path.join(root, configPath), "utf8");
      } catch (error) {
        return { status: "failed", reason: `Cannot read ${configPath} pytest configuration: ${error.message}` };
      }
      if (!hasPytestConfiguration(path.posix.basename(configPath), config)) continue;
      const cwd = path.posix.dirname(configPath) === "." ? "." : path.posix.dirname(configPath);
      addCheck(
        [cwd === "." ? "" : cwd, "python", "pytest"].filter(Boolean),
        `Python pytest suite${cwd === "." ? "" : ` (${cwd})`}`,
        "python",
        ["-m", "pytest"],
        cwd,
        configPath,
      );
    }
  }

  if (availableTools.has("dotnet")) {
    let dotnetTargets;
    try {
      dotnetTargets = findDotnetTargets(root, projectFiles);
    } catch (error) {
      return { status: "failed", reason: `Cannot inspect .NET validation targets: ${error.message}` };
    }
    for (const targetPath of dotnetTargets) {
      const cwd = path.posix.dirname(targetPath) === "." ? "." : path.posix.dirname(targetPath);
      const targetName = path.posix.basename(targetPath);
      addCheck(
        [cwd === "." ? "" : cwd, "dotnet", "test"].filter(Boolean),
        `dotnet test ${targetName}`,
        "dotnet",
        ["test", targetName],
        cwd,
        targetPath,
      );
    }
  }

  if (!checks.length) {
    return {
      status: "not-configured",
      reason: "No supported checks were detected in available npm package scripts, pytest configuration, or .NET solutions/projects.",
    };
  }
  if (checks.length > MAX_CHECKS) {
    return {
      status: "not-configured",
      reason: `Detected ${checks.length} checks, exceeding MCPEE's ${MAX_CHECKS}-step workflow limit. Configure workflow specs explicitly to select an appropriate subset.`,
    };
  }

  const uniqueEvidence = [...new Set(evidence)].sort((left, right) => left.localeCompare(right));
  const workflows = readCatalog().catalog.workflows;
  const workflowDirectory = path.join(root, ".mcpee", "workflows");
  for (const directory of [path.join(root, ".mcpee"), workflowDirectory]) {
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
      throw new Error(`Refusing to provision workflow specs through symbolic link: ${directory}`);
    }
  }

  let created = 0;
  let preserved = 0;
  for (const workflow of workflows) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workflow.id)) {
      throw new Error(`Catalog workflow id is invalid: ${workflow.id}`);
    }
    const relativePath = `.mcpee/workflows/${workflow.id}.json`;
    const destination = path.join(root, relativePath);
    if (fs.existsSync(destination)) {
      if (fs.lstatSync(destination).isSymbolicLink() || !fs.statSync(destination).isFile()) {
        throw new Error(`Refusing to overwrite non-file workflow spec: ${relativePath}`);
      }
      preserved += 1;
      continue;
    }
    const spec = {
      workflow_id: workflow.id,
      task: `Run detected local project validation checks for ${workflow.id}: ${workflow.description}`,
      evidence: uniqueEvidence,
      steps: checks,
    };
    try {
      fs.writeFileSync(destination, `${JSON.stringify(spec, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      created += 1;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      preserved += 1;
    }
  }
  return {
    status: "ready",
    created,
    preserved,
    checkCount: checks.length,
    checks: checks.map(({ id, tool, cwd, covers_technologies }) => ({
      id, tool, cwd, covers_technologies,
    })),
  };
}

async function requestApprovalFromHost(kind, details, environment = null) {
  const brokerUrl = environment
    ? environment.MCPEE_APPROVAL_BROKER_URL
    : INITIAL_APPROVAL_BROKER.url;
  const token = environment
    ? environment.MCPEE_APPROVAL_BROKER_TOKEN
    : INITIAL_APPROVAL_BROKER.token;
  if (!brokerUrl && !token) return null;
  if (!brokerUrl || !token) throw new Error("The VS Code approval broker is incompletely configured.");

  let url;
  try {
    url = new URL(brokerUrl);
  } catch {
    throw new Error("The VS Code approval broker URL is invalid.");
  }
  if (url.protocol !== "http:" ||
      !new Set(["127.0.0.1", "::1", "[::1]"]).has(url.hostname) ||
      url.username || url.password || url.pathname !== "/approve" || url.search || url.hash) {
    throw new Error("The VS Code approval broker must use its authenticated loopback endpoint.");
  }

  // Human approval may take longer than fetch's independent headers timeout.
  const response = await new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: "POST",
      agent: false,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    }, incoming => {
      const chunks = [];
      let bytes = 0;
      incoming.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) {
          request.destroy(new Error("The VS Code approval broker response exceeds 65536 bytes."));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("end", () => resolve({
        ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
        status: incoming.statusCode,
        json: () => JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    request.on("error", reject);
    request.end(JSON.stringify({ kind, details }));
  });
  if (!response.ok) throw new Error(`The VS Code approval broker returned HTTP ${response.status}.`);
  const result = await response.json();
  if (!result || typeof result.approved !== "boolean") {
    throw new Error("The VS Code approval broker returned an invalid decision.");
  }
  return result.approved;
}

function projectRoot(args) {
  return path.resolve(optionValue(args, "--project", process.cwd()));
}

function runContextMode(args) {
  const packContext = args.includes("--pack-context");
  const groundRequested = args.includes("--ground-context");
  const groundDisabled = args.includes("--no-ground-context");
  if (groundRequested && groundDisabled) {
    throw new Error("Choose either --ground-context or --no-ground-context, not both.");
  }
  const groundContext = groundRequested || (!groundDisabled && !packContext);
  if (packContext && groundContext) {
    throw new Error("Choose either --pack-context or grounded context, not both.");
  }
  return { packContext, groundContext };
}

function readChatContext(args) {
  const raw = optionValue(args, "--chat-context");
  if (!raw) return [];
  if (Buffer.byteLength(raw, "utf8") > 16_000) {
    throw new Error("--chat-context must not exceed 16000 bytes.");
  }
  let context;
  try {
    context = JSON.parse(raw);
  } catch {
    throw new Error("--chat-context must be valid JSON.");
  }
  if (!Array.isArray(context) || context.length > 12 ||
      context.some((turn) =>
        !turn || !["user", "assistant"].includes(turn.role) ||
        typeof turn.content !== "string" || turn.content.length > 4000)) {
    throw new Error("--chat-context must contain at most 12 user/assistant turns of up to 4000 characters each.");
  }
  return context;
}

function printHelp() {
  process.stdout.write([
    "MCPEE - local-first Copilot engineering harness",
    "",
    "Usage: mcpee <command> [options]",
    "",
    "Commands:",
    "  init       Initialize MCPEE, sync local sources, and discover tools",
    "  status     Show local installation, source, and telemetry state",
    "  doctor     Validate required local artifacts and indexes",
    "  trace      Inspect actual Copilot hook events",
    "  memory     Add or list explicit project memories",
    "  observe    Summarize locally recorded telemetry",
    "  view       Generate the local human-readable evidence library",
    "  telemetry  Validate the schema and redaction of locally recorded events",
    "  sync       Incrementally ingest, normalize, and index project knowledge",
    "  knowledge  Search local project sources and CodeGraph symbol knowledge",
    "  impact     Show source-code dependents and linked documents",
    "  drift      Review unresolved local documentation links",
    "  tools      Discover or validate local tools without installing them",
    "  cloud      Query scoped, read-only Azure/AWS inventory through local CLIs",
    "  capabilities List, install, update, or remove catalog assets in this project",
    "  assets     Audit local agent, skill, hook, and tool configuration (read-only)",
    "  coverage   Report the mapped catalog baseline for supported technologies",
    "  quality    Report configured and observed validation gates for this project",
    "  skills     Report observed workflow evaluation outcomes for catalog skills",
    "  plan       Create or list durable project specifications and delivery plans",
    "  specs      Discover, review, ratify, and check drift in brownfield specifications",
    "  evaluate   Execute local checks or evaluate an agent-asset response",
    "  workflow   Run a declared, project-local sequence of allowlisted checks",
    "  learn      Propose, inspect, and explicitly approve evaluated learning",
    "  tasks      Review automatically generated follow-up tasks",
    "  route      Create a deterministic local execution plan for a task",
    "  run        Execute a routed task with GitHub Copilot and approval hooks",
    "  explain    Explain the installed catalog, local tools, and knowledge state",
    "  rebuild    Reprocess local sources and regenerate derived knowledge",
    "  update     Refresh project integration from the installed MCPEE package",
    "  clean      Remove the MCPEE-managed local cache",
    "  help       Show this help",
    "",
    "Options:",
    "  --project <path>  Project root (default: current directory)",
    "  --session <id>    Filter traces by Copilot session",
    "  --event <name>    Filter traces by hook event",
    "  --show <id>       Print one complete sanitized event",
    "  --json            Print trace events as JSON",
    "  --limit <n>       Maximum events to show (1-1000; default 50)",
    "  memory add --kind <kind> --text <text> [--source <path>]",
    "  memory list [--kind <kind>]",
    "  memory search --query <text> [--limit <n>]",
    "  knowledge search|graph --query <text> [--mode lexical|vector] [--limit <n>] [--json]",
    "  knowledge context --query <text> [--max-tokens <n>] [--json]",
    "  knowledge embeddings status|setup|index [--profile light|bge-m3]",
    "  impact --path <project-relative-path> [--json]",
    "  specs discover | list [--all] | drift [--json]",
    "  specs ratify --slug <id> --reviewer <name> --confirm-sha256 <digest>",
    "  drift [--json]",
    "  tools list | tools validate [--tool <id> ...]",
    "  cloud inventory --provider azure|aws [--json]",
    "  capabilities list [--type <type>] [--json]",
    "  capabilities install|update|remove <id> [--type <type>]",
    "  capabilities update [--type <type>]  Refresh all installed catalog assets",
    "  evaluate --run <project-relative-json> | --case <id> --asset <id> --response <file> [--ratings <json> --reviewer <name>]",
    "  evaluate --suite specialist-core [--scenario <id> --variant normal|failure|boundary | --results <project-relative-json>] [--json]",
    "  evaluate --suite specialist-audit [--scenario <id> --variant positive|negative|insufficient | --results <project-relative-json>] [--json]",
    "  workflow run --spec <project-relative-json>",
    "  learn propose --evaluation <id> --kind <pattern|insight> --text <text>",
    "  learn approve|reject <proposal-id> | learn list",
    "  tasks list | approve|reject|start <task-id> | complete <task-id> --evaluation <id>",
    "  route --task <request> [--json]",
    "  run --task <request> [--model <id>] [--pack-context | --no-ground-context] [--context-tokens <128..32000>]",
    "  init [--agents <id,...|all|none>] [--skip-tool-install] [--embeddings none|light|bge-m3]",
    "  observe [--json] [--export <project-relative-json>] [--html <project-relative-html>]",
    "  view --html <project-relative-html> [--report <project-relative-json>]",
    "  trace [--trace-id <id> | --session <id>] [--event <name>] [--export <project-relative-json>]",
    "  trace [--trace-id <id>] --otlp <project-relative-json>  Materialize local OpenTelemetry spans (no content/network)",
    "  telemetry validate [--json]",
  ].join("\n") + "\n");
}

async function runTrace(root, args) {
  const events = readEvents(root);
  const showId = optionValue(args, "--show");
  if (showId) {
    const event = events.find((item) => item.event_id === showId || item.source_event_id === showId);
    if (!event) {
      process.stderr.write(`[mcpee] Trace event not found: ${showId}\n`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify(event, null, 2)}\n`);
    return 0;
  }

  const session = optionValue(args, "--session");
  const traceId = optionValue(args, "--trace-id");
  const eventName = optionValue(args, "--event");
  const limit = Number.parseInt(optionValue(args, "--limit", "50"), 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    process.stderr.write("[mcpee] --limit must be an integer between 1 and 1000\n");
    return 1;
  }
  const matching = events.filter((event) =>
    (!session || event.session_id === session) &&
    (!traceId || event.trace_id === traceId) &&
    (!eventName || event.event_name === eventName));
  if (args.includes("--otlp")) {
    const exportPath = optionValue(args, "--otlp");
    if (!exportPath) throw new Error("--otlp requires a project-relative JSON path.");
    const { writeLocalOtlpExport } = require("../../core/src/otel");
    const destination = await writeLocalOtlpExport(root, exportPath, matching);
    process.stderr.write(`[mcpee] Exported local OpenTelemetry OTLP traces to ${destination}; prompt, response and source content excluded.\n`);
  }
  if (args.includes("--export")) {
    const exportPath = optionValue(args, "--export");
    if (!exportPath) throw new Error("--export requires a project-relative JSON path.");
    const destination = writeLocalTelemetryEventsExport(root, exportPath, matching);
    process.stderr.write(`[mcpee] Exported ${matching.length} detailed local telemetry event(s) to ${path.relative(root, destination).replace(/\\/g, "/")} (retention=${TELEMETRY_RETENTION_DAYS} days).\n`);
  }
  const selected = matching.slice(-limit).reverse();
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`Telemetry events: ${selected.length} shown / ${matching.length} matching / ${events.length} total\n`);
  if (events.length === 0) {
    process.stdout.write(`No local events captured yet.\nFile: ${TELEMETRY_FILE}\n`);
    return 0;
  }
  for (const event of selected) {
    const sessionLabel = event.session_id || "(session unavailable)";
    const tool = event.tool_name ? ` tool=${event.tool_name}` : "";
    const trace = event.trace_id ? ` trace=${event.trace_id}` : "";
    process.stdout.write(`${event.timestamp}  ${sessionLabel}${trace}  ${event.event_name}${tool}  id=${event.event_id}\n`);
  }
  return 0;
}

function runStatus(root) {
  const statePath = path.join(root, ".mcpee", "state", "project.json");
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null;
  const events = readEvents(root);
  const tasks = listTasks(root);
  process.stdout.write(`Project: ${root}\n`);
  process.stdout.write(`Initialized: ${state ? "yes" : "no"}\n`);
  process.stdout.write(`Captured Copilot events: ${events.length}\n`);
  process.stdout.write(`Follow-up tasks: ${tasks.filter((task) => task.status === "pending").length} pending / ${tasks.length} total\n`);
  if (state?.last_sync) process.stdout.write(`Last source inventory: ${state.last_sync}\n`);
  if (state?.inventory) {
    process.stdout.write(`Knowledge sources: ${state.inventory.discovered_files}; processed: ${state.inventory.processed_files}; status: ${state.inventory.status}\n`);
  }
  const codeGraph = readCodeGraphState(root);
  if (codeGraph) {
    process.stdout.write(`CodeGraph: ${codeGraph.status}${codeGraph.summary?.node_count !== null && codeGraph.summary?.node_count !== undefined ? `; nodes=${codeGraph.summary.node_count}; edges=${codeGraph.summary.edge_count}` : ""}${codeGraph.error ? `; error=${codeGraph.error}` : ""}\n`);
  }
  return state ? 0 : 1;
}

function runCapabilities(root, args) {
  const action = args[0] || "list";
  if (!["list", "install", "update", "remove"].includes(action)) {
    process.stderr.write(`[mcpee] Unknown capabilities action: ${action}\n`);
    return 2;
  }
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const rawType = optionValue(args, "--type").toLowerCase().replaceAll("_", "-");
  const typeAliases = {
    agents: "agent",
    skills: "skill",
    workflows: "workflow",
    patterns: "pattern",
    templates: "template",
    playbooks: "playbook",
    "technical-guidance": "technical-guidance",
    scorecards: "scorecard",
    "eval-cases": "eval-case",
    "prompt-examples": "prompt-example",
    policies: "policy",
    "tool-capabilities": "tool-capability",
  };
  const type = typeAliases[rawType] || rawType;
  const registry = capabilityRegistry(root);
  if (action === "list") {
    if (type && !registry.items.some((item) => item.type === type)) {
      process.stderr.write(`[mcpee] Unknown capability type '${rawType}'.\n`);
      return 2;
    }
    const items = registry.items.filter((item) => !type || item.type === type);
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify({
        schema_version: 1,
        catalog_sha256: registry.catalog_sha256,
        detected_technologies: registry.detected_technologies,
        scan: registry.scan,
        installed: items.filter((item) =>
          item.status === "installed" || item.status === "detected-installed").length,
        available: items.filter((item) => item.status === "available").length,
        core: items.filter((item) => item.status === "core").length,
        items,
      }, null, 2)}\n`);
    } else {
      process.stdout.write(`MCPEE catalog capabilities (${registry.detected_technologies.map(({ id }) => id).join(", ") || "no detected stack"})\n`);
      for (const item of items) {
        process.stdout.write(`  ${item.status.padEnd(18)} ${item.type}/${item.id}${item.dependencies.length ? ` -> ${item.dependencies.join(", ")}` : ""}\n`);
      }
      process.stdout.write(`${items.filter((item) =>
        item.status === "installed" || item.status === "detected-installed").length} installed; ${
        items.filter((item) => item.status === "available").length} available; ${
        items.filter((item) => item.status === "core").length} core.\n`);
    }
    return 0;
  }

  const positional = args.slice(1).filter((argument, index, all) =>
    !argument.startsWith("--") && (index === 0 || !all[index - 1].startsWith("--")));
  const id = positional[0];
  if (action === "update" && !id) {
    const installed = registry.items.filter((item) =>
      item.status !== "available" && item.status !== "core" && (!type || item.type === type));
    if (!installed.length) {
      process.stderr.write("[mcpee] No installed catalog capabilities match this update.\n");
      return 1;
    }
    const result = renderCatalog(root);
    process.stdout.write(`[mcpee] Updated ${installed.length} installed capability entries; generated files created=${result.counts.created}, updated=${result.counts.updated}, removed=${result.counts.removed}.\n`);
    return 0;
  }
  if (!id) {
    process.stderr.write(`[mcpee] Usage: mcpee capabilities ${action} <id> [--type <type>]\n`);
    return 2;
  }
  const matches = registry.items.filter((item) => item.id === id && (!type || item.type === type));
  if (matches.length !== 1) {
    if (!matches.length) {
      process.stderr.write(`[mcpee] No matching catalog capability '${id}'${type ? ` of type '${type}'` : ""}. Use 'mcpee capabilities list' to inspect available IDs.\n`);
      return 2;
    }
    process.stderr.write(`[mcpee] Capability ID '${id}' is ambiguous; specify --type (${matches.map((item) => item.type).join(", ")}).\n`);
    return 2;
  }
  try {
    const result = manageCapability(root, action, matches[0].type, id);
    process.stdout.write(`[mcpee] Capability ${result.type}/${result.id}: ${result.status}; files created=${result.changes.created}, updated=${result.changes.updated}, removed=${result.changes.removed}.\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`[mcpee] Capability ${action} failed: ${error.message}\n`);
    return 1;
  }
}

function runDoctor(root) {
  const missing = PROJECT_DIRECTORIES
    .map((relative) => path.join(root, relative))
    .filter((absolute) => !fs.existsSync(absolute));
  const requiredFiles = [
    "mcpee.config.yml",
    ".github/copilot-instructions.md",
    ".github/instructions/mcpee-catalog.instructions.md",
    ".github/instructions/mcpee-policies.instructions.md",
    ".mcpee/generated/catalog-patterns.md",
    ".mcpee/generated/catalog-templates.md",
    ".mcpee/generated/catalog-technical-guidance.md",
    ".mcpee/generated/catalog-quality.md",
    ".mcpee/generated/catalog-playbooks.md",
    ".mcpee/generated/project-capabilities.md",
    ".mcpee/generated/project-capabilities.json",
    ".github/agents/mcpee-orchestrator.agent.md",
    ".github/skills/mcpee-knowledge/SKILL.md",
    ".github/hooks/mcpee-observability.json",
    ".mcpee/runtime/copilot-hook.cjs",
    ".mcpee/runtime/approval-policy.cjs",
    ".mcpee/state/project.json",
    ".mcpee/catalog-lock.json",
    ".mcpee/generated/catalog-manifest.json",
  ];
  const statePath = path.join(root, ".mcpee/state/project.json");
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (state.last_sync) {
      requiredFiles.push(
        ".mcpee/indexes/source-inventory.json",
        ".mcpee/indexes/knowledge-index.json",
        "knowledge/traceability/source-manifest.json",
        "docs/generated/project-overview.md",
        "docs/generated/source-catalog.md",
        "docs/generated/quality-and-operations.md",
        "docs/generated/architecture-map.md",
      );
    }
    const codeGraph = readCodeGraphState(root);
    if (codeGraph?.status === "ready") {
      requiredFiles.push(
        codeGraph.graph_directory,
        ".mcp.json",
      );
    } else {
      missing.push(`Required CodeGraph index healthy (${codeGraph?.error || "not initialized; run mcpee init" })`);
    }
  }
  for (const relative of requiredFiles) {
    if (!fs.existsSync(path.join(root, relative))) missing.push(path.join(root, relative));
  }
  const catalogManifestPath = path.join(root, ".mcpee/generated/catalog-manifest.json");
  if (fs.existsSync(catalogManifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(catalogManifestPath, "utf8"));
      if (manifest.generated_by !== "mcpee" || !Array.isArray(manifest.files) ||
          manifest.files.some((relative) => typeof relative !== "string")) {
        throw new Error("invalid schema");
      }
      for (const relative of manifest.files) {
        const absolute = path.resolve(root, relative);
        const local = path.relative(root, absolute);
        if (path.isAbsolute(local) || local === ".." || local.startsWith(`..${path.sep}`)) {
          throw new Error(`manifest path escapes the project: ${relative}`);
        }
        if (!fs.existsSync(absolute)) missing.push(absolute);
      }
    } catch (error) {
      missing.push(`Valid MCPEE catalog manifest (${error.message})`);
    }
  }
  const hookPath = path.join(root, ".mcpee/runtime/copilot-hook.cjs");
  if (fs.existsSync(hookPath) &&
      !fs.readFileSync(hookPath, "utf8").includes("assessCopilotToolCall")) {
    missing.push("Current MCPEE preToolUse approval enforcement in .mcpee/runtime/copilot-hook.cjs");
  }
  try {
    if (!approvalHookInstalled(root)) {
      missing.push("MCPEE preToolUse approval hook registration in .github/hooks/mcpee-observability.json");
    }
  } catch (error) {
    missing.push(`Valid MCPEE Copilot hook configuration (${error.message})`);
  }
  if (missing.length) {
    process.stderr.write(`[mcpee] Installation incomplete; missing ${missing.length} path(s):\n${missing.map((item) => `- ${item}`).join("\n")}\n`);
    return 1;
  }
  process.stdout.write("[mcpee] Project layout, Copilot integration, and available indexes are present.\n");
  return 0;
}

async function refreshConfiguredEmbeddings(root) {
  const profile = projectEmbeddingProfile(root);
  if (!profile) return null;
  const status = profile === "bge-m3"
    ? localBgeEmbeddingStatus(root)
    : await localEmbeddingStatus();
  if (!status.model_available) {
    const profileName = profile === "bge-m3" ? BGE_MODEL : EMBEDDING_MODEL;
    return { warning: `${profileName} is missing; run "mcpee knowledge embeddings setup --profile ${profile}".` };
  }
  if (profile === "bge-m3" && !status.available) {
    return { warning: status.environment_error || "The local BGE-M3 Python environment is unavailable." };
  }
  return buildEmbeddingIndex(root, { profile, onProgress: reportEmbeddingProgress });
}

async function runSync(root) {
  const statePath = path.join(root, ".mcpee", "state", "project.json");
  if (!fs.existsSync(statePath)) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const result = syncProject(root);
  const specDrift = checkSpecDrift(root);
  let embeddingResult;
  try {
    embeddingResult = await refreshConfiguredEmbeddings(root);
  } catch (error) {
    embeddingResult = { warning: error.message };
  }
  const codeGraph = updateCodeGraph(root, {
    available: discoverTools(root).tools.some((tool) => tool.id === "codegraph" && tool.available),
    required: true,
  });
  process.stdout.write(`[mcpee] Knowledge sync completed: ${result.discoveredFiles} source(s) found.\n`);
  process.stdout.write(`  processed=${result.counts.processed} unchanged=${result.counts.unchanged} requires-tool=${result.counts["requires-tool"]} skipped=${result.counts.skipped} failed=${result.counts.failed}\n`);
  process.stdout.write(`  Copilot catalog created=${result.catalog.counts.created} updated=${result.catalog.counts.updated} preserved=${result.catalog.counts.preserved}\n`);
  process.stdout.write(`  generated documentation written=${result.documentation.counts.written} preserved=${result.documentation.counts.preserved}\n`);
  process.stdout.write(`  unified evidence graph nodes=${result.unifiedGraph.node_count} edges=${result.unifiedGraph.edge_count}\n`);
  if (result.specifications.status !== "empty") {
    process.stdout.write(`  specification proposals ${result.specifications.status}: ${result.specifications.indexPath}; approved contracts and previous drafts preserved\n`);
  }
  if (specDrift.specifications.length) {
    process.stdout.write(`  specification drift: current=${specDrift.current} drifted=${specDrift.drifted}; run mcpee specs drift for details\n`);
  }
  if (embeddingResult?.chunkCount !== undefined) {
    process.stdout.write(`  local embedding index refreshed: chunks=${embeddingResult.chunkCount} model=${embeddingResult.model}\n`);
  } else if (embeddingResult?.warning) {
    process.stderr.write(`[mcpee] Local embedding index was not refreshed: ${embeddingResult.warning}\n`);
  }
  if (result.removed.length) process.stdout.write(`  removed derived files=${result.removed.length}\n`);
  if (result.graphify.status === "ready") {
    process.stdout.write(`  Graphify ${result.graphify.operation}: nodes=${result.graphify.node_count} edges=${result.graphify.edge_count}\n`);
  } else if (result.graphify.status === "failed") {
    process.stderr.write(`[mcpee] Graphify sync failed: ${result.graphify.error}\n`);
  } else {
    process.stdout.write(`  Graphify unavailable: ${result.graphify.reason}\n`);
  }
  if (codeGraph.status === "ready") {
    process.stdout.write(`[mcpee] CodeGraph ${codeGraph.operation} completed: files=${codeGraph.summary.file_count ?? "unknown"} nodes=${codeGraph.summary.node_count ?? "unknown"} edges=${codeGraph.summary.edge_count ?? "unknown"}; MCP ${codeGraph.mcp.status}.\n`);
  } else if (codeGraph.status === "unavailable") {
    process.stderr.write("[mcpee] CodeGraph is required but the project-local tool is not installed; run mcpee init after approving its installation.\n");
  } else {
    process.stderr.write(`[mcpee] CodeGraph sync failed: ${codeGraph.error}\n`);
  }
  return result.counts.failed > 0 || codeGraph.status !== "ready" || result.graphify.status === "failed" ? 1 : 0;
}

function runSpecs(root, args) {
  const [action = "list"] = args;
  const json = args.includes("--json");
  let result;
  if (action === "discover") {
    result = discoverBrownfieldSpec(root);
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.status === "empty") {
      process.stdout.write("[mcpee] No eligible source evidence was found; no proposal was created.\n");
    } else {
      process.stdout.write(`[mcpee] Brownfield proposals ${result.status}: ${result.domainCount} candidate domains; ${result.proposals.length} documents; ${result.sourceCount} sources.\n`);
      process.stdout.write(`  Start reading: ${result.indexPath}\n`);
      process.stdout.write("  This is evidence for review, not an approved functional specification.\n");
    }
    return 0;
  }
  if (action === "list") {
    result = listBrownfieldSpecs(root, { includeArchived: args.includes("--all") });
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (!result.length) process.stdout.write("[mcpee] No brownfield specification proposals or approvals found.\n");
    else for (const spec of result) {
      process.stdout.write(`  ${spec.status}: ${spec.slug} — ${spec.path} — SHA-256 ${spec.sha256}\n`);
    }
    return 0;
  }
  if (action === "drift") {
    result = checkSpecDrift(root);
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (!result.specifications.length) process.stdout.write("[mcpee] No managed specifications to check for drift.\n");
    else {
      process.stdout.write(`[mcpee] Specification drift: current=${result.current}; drifted=${result.drifted}.\n`);
      for (const spec of result.specifications) {
        process.stdout.write(`  ${spec.drift_status}: ${spec.specification_status} ${spec.slug}; changed=${spec.changed.length}; missing=${spec.missing.length}\n`);
        for (const source of [...spec.changed, ...spec.missing]) process.stdout.write(`    ${source}\n`);
      }
    }
    return result.drifted ? 1 : 0;
  }
  if (action === "ratify") {
    result = ratifyBrownfieldSpec(root, {
      slug: optionValue(args, "--slug"),
      reviewer: optionValue(args, "--reviewer"),
      confirmSha256: optionValue(args, "--confirm-sha256"),
    });
    process.stdout.write(`[mcpee] Specification ratified by ${result.reviewer}: ${result.specPath}\n`);
    process.stdout.write(`  reviewed proposal SHA-256=${result.proposalSha256}\n`);
    return 0;
  }
  throw new Error("Use mcpee specs discover|list|drift, or specs ratify --slug <id> --reviewer <name> --confirm-sha256 <digest>.");
}

async function approveMaintenance(action, description) {
  const hostDecision = await requestApprovalFromHost("maintenance", { action, description });
  if (hostDecision !== null) return hostDecision;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(`[mcpee] ${action} changes local project state; non-interactive approval is denied.\n`);
    return false;
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  return terminal.question(
    `[mcpee] ${description}\nType "${action}" to authorize this operation [deny]: `,
  ).then((answer) => answer.trim().toLowerCase() === action).finally(() => terminal.close());
}

function runExplain(root, args) {
  const planTask = optionValue(args, "--task");
  if (planTask) {
    const plan = routeTask(root, planTask);
    if (args.includes("--json")) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    else {
      process.stdout.write(`Workflow: ${plan.workflow.id}\nAgent: ${plan.agent.id}\n`);
      process.stdout.write(`Skills: ${plan.skills.map((skill) => skill.id).join(", ") || "none"}\n`);
      process.stdout.write(`Patterns: ${plan.patterns.map((pattern) => pattern.id).join(", ") || "none"}\n`);
      process.stdout.write(`Playbooks: ${plan.playbooks.map((playbook) => playbook.id).join(", ") || "none"}\n`);
      process.stdout.write(`Technical guidance: ${plan.technical_guidance.map((item) => item.id).join(", ") || "none"}\n`);
      process.stdout.write(`Scorecards: ${plan.scorecards.map((item) => item.id).join(", ") || "none"}\n`);
      process.stdout.write(`Evaluation cases: ${plan.eval_cases.map((item) => item.id).join(", ") || "none"}\n`);
      process.stdout.write(`Prompt examples: ${plan.prompt_examples.map((item) => item.id).join(", ") || "none"}\n`);
      process.stdout.write(`Policy controls: ${plan.policy_controls.map((policy) => `${policy.id}=${policy.enforcement}`).join(", ") || "none"}\n`);
      process.stdout.write(`Agent tools: ${plan.agent_tools.map((tool) => `${tool.id} (${tool.available ? "available" : "unavailable"})`).join(", ") || "none"}\n`);
      process.stdout.write(`Memory evidence: ${plan.memory.length}; knowledge sources: ${plan.knowledge.length}; graph matches: ${plan.knowledge_graph.length}\n`);
      process.stdout.write(`Graph readiness: unified=${plan.knowledge_graph_status.unified}, CodeGraph=${plan.knowledge_graph_status.codegraph}, Graphify=${plan.knowledge_graph_status.graphify}\n`);
      process.stdout.write(`Fallback: ${plan.fallback || "none"}\nExecution: ${plan.execution}\n`);
    }
    return 0;
  }

  const { catalog } = readCatalog();
  const tools = discoverTools(root).tools;
  const graphify = readGraphifyState(root);
  const statePath = path.join(root, ".mcpee/state/project.json");
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null;
  const capabilitiesPath = path.join(root, ".mcpee/generated/project-capabilities.json");
  const projectCapabilities = fs.existsSync(capabilitiesPath)
    ? JSON.parse(fs.readFileSync(capabilitiesPath, "utf8"))
    : { status: "not-detected", detected_technologies: [], assets: {} };
  const explanation = {
    project: root,
    initialized: Boolean(state),
    project_capabilities: projectCapabilities,
    catalog: {
      agents: catalog.agents.map(({ id, description }) => ({ id, description })),
      skills: catalog.skills.map(({ id, description }) => ({ id, description })),
      workflows: catalog.workflows.map(({ id, description }) => ({ id, description })),
      policies: catalog.policies.map(({ id, description, enforcement, evidence }) => ({
        id,
        description,
        enforcement,
        evidence,
      })),
      tool_capabilities: catalog.tool_capabilities.map(({ id, description }) => ({ id, description })),
      patterns: catalog.patterns.map(({ id, description }) => ({ id, description })),
      playbooks: catalog.playbooks.map(({ id, description, path: sourcePath, technology_keywords, workflows }) => ({
        id,
        description,
        path: sourcePath,
        technology_keywords,
        workflows,
      })),
      technical_guidance: catalog.technical_guidance.map(({ id, description, source_path, technology_keywords }) => ({
        id,
        description,
        source_path,
        technology_keywords,
      })),
      scorecards: catalog.scorecards.map(({ id, description, technology_keywords, criteria }) => ({
        id,
        description,
        technology_keywords,
        criteria,
      })),
      eval_cases: catalog.eval_cases.map(({ id, description, scorecard, technology_keywords, asset_ids }) => ({
        id,
        description,
        scorecard,
        ...(asset_ids ? { asset_ids } : {}),
        technology_keywords,
      })),
      prompt_examples: catalog.prompt_examples.map(({ id, description, path: sourcePath, technology_keywords }) => ({
        id,
        description,
        path: sourcePath,
        technology_keywords,
      })),
      templates: catalog.templates.map(({ id, description, path: sourcePath }) => ({
        id,
        description,
        path: sourcePath,
      })),
    },
    tools: tools.map(({ id, available, installation }) => ({
      id,
      available,
      installation: installation?.status || null,
    })),
    knowledge: state?.inventory || { status: "not-synchronized" },
    graphify: graphify || { status: "not-synchronized" },
    execution: {
      route: "deterministic plan only",
      run: "Copilot SDK agent runtime; local grounded context is the default and all transfers/actions require explicit approval",
      chat_integration: "project-scoped mcpee_run MCP tool; no special participant required",
      approval_hook: approvalHookInstalled(root)
        ? "installed; gates supported Copilot tool calls, not code style or project checks"
        : "not installed; rendered guidance is not a substitute for active host permission controls",
      flow: [
        "route selects a workflow, specialist, applicable skills, patterns, playbooks, technical guidance, scorecards, eval cases, and prompt examples",
        "run prepares local evidence and impact preflight",
        "Copilot executes relevant workflow stages; the approval hook gates supported tool calls",
        "declared project checks validate changes before documentation and close-loop reporting",
      ],
      enforcement_limits: [
        "Hook enforcement covers supported tool-call approval decisions; it does not enforce naming, formatting, analyzers, or test outcomes.",
        "Style and quality checks are enforced only when the project configures and runs them.",
        "Rendered policy instructions guide the agent but are not deterministic enforcement by themselves.",
      ],
    },
    known_limits: [
      "The unified graph contains traceable source, category, heading, normalized-artifact, and symbol relationships; semantic cross-source edges are not implemented. Embedding retrieval is optional and uses the local Ollama service only after explicit setup.",
      "Graphify runs only when its project-local installation is available; extraction uses code-only mode and does not install or invoke a remote model.",
      "Repomix context packaging is available only with --pack-context and uses selected routing evidence.",
      "Learning proposals require human authorship and explicit approval.",
    ],
  };
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(explanation, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`Project: ${explanation.project}\nInitialized: ${explanation.initialized ? "yes" : "no"}\n`);
  process.stdout.write(`Detected stack: ${projectCapabilities.detected_technologies.map(({ id }) => id).join(", ") || "no stack signals"}\n`);
  process.stdout.write(`Selected capabilities: ${projectCapabilities.assets.agents?.length || 0} agents, ${projectCapabilities.assets.skills?.length || 0} skills, ${projectCapabilities.assets.technical_guidance?.length || 0} technical guides\n`);
  process.stdout.write(`Catalog: ${catalog.agents.length} agents, ${catalog.skills.length} skills, ${catalog.workflows.length} workflows, ${catalog.policies.length} policies, ${catalog.tool_capabilities.length} tool capabilities, ${catalog.patterns.length} patterns, ${catalog.playbooks.length} playbooks, ${catalog.templates.length} templates, ${catalog.technical_guidance.length} technical guides, ${catalog.scorecards.length} scorecards, ${catalog.eval_cases.length} eval cases, ${catalog.prompt_examples.length} prompt examples\n`);
  process.stdout.write(`Tools available: ${tools.filter((tool) => tool.available).length}/${tools.length}\n`);
  process.stdout.write(`Knowledge: ${explanation.knowledge.status || "not synchronized"}\n`);
  process.stdout.write(`Graphify: ${explanation.graphify.status}${explanation.graphify.reason ? ` — ${explanation.graphify.reason}` : ""}\n`);
  process.stdout.write("Execution: route creates a plan; run uses grounded local context by default and invokes the Copilot agent runtime after approval. Ordinary VS Code Copilot Chat can invoke the project-scoped mcpee_run MCP tool.\n");
  process.stdout.write(`Approval hook: ${explanation.execution.approval_hook}\n`);
  process.stdout.write("Flow: route -> grounded context and impact preflight -> per-action hook approval -> project checks -> documentation -> telemetry/learning report.\n");
  process.stdout.write("Limits: hooks gate tool actions, not naming/style/analyzers; those require configured project checks. Guidance in generated policy instructions is not enforcement by itself.\n");
  process.stdout.write("Limits: semantic embeddings require explicit local model setup and refresh after source changes; no semantic cross-source graph edges. Grounded context packs contain selected source excerpts, not model-written summaries. Graphify contributes code-only AST evidence when installed locally; learning requires a human-authored proposal.\n");
  return 0;
}

async function runRebuild(root) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  if (!await approveMaintenance("rebuild", "Reprocess every supported local source and regenerate derived indexes, catalog files, documentation, and local CodeGraph/Graphify indexes when available. Source files and persistent memory are not deleted.")) return 1;
  const result = syncProject(root, { force: true });
  const specDrift = checkSpecDrift(root);
  let embeddingResult;
  try {
    embeddingResult = await refreshConfiguredEmbeddings(root);
  } catch (error) {
    embeddingResult = { warning: error.message };
  }
  const codeGraph = updateCodeGraph(root, {
    available: discoverTools(root).tools.some((tool) => tool.id === "codegraph" && tool.available),
    required: true,
  });
  process.stdout.write(`[mcpee] Rebuild completed: sources=${result.discoveredFiles}; processed=${result.counts.processed}; failed=${result.counts.failed}; docs written=${result.documentation.counts.written}.\n`);
  if (specDrift.specifications.length) {
    process.stdout.write(`[mcpee] Specification drift: current=${specDrift.current}; drifted=${specDrift.drifted}. Use mcpee specs discover to create a new proposal from the updated snapshot.\n`);
  }
  if (embeddingResult?.chunkCount !== undefined) {
    process.stdout.write(`[mcpee] Local embedding index refreshed: ${embeddingResult.chunkCount} chunk(s).\n`);
  } else if (embeddingResult?.warning) {
    process.stderr.write(`[mcpee] Local embedding index was not refreshed: ${embeddingResult.warning}\n`);
  }
  if (result.graphify.status === "ready") {
    process.stdout.write(`[mcpee] Graphify ${result.graphify.operation}: nodes=${result.graphify.node_count}, edges=${result.graphify.edge_count}.\n`);
  } else if (result.graphify.status === "failed") {
    process.stderr.write(`[mcpee] Graphify rebuild failed: ${result.graphify.error}\n`);
  } else {
    process.stdout.write(`[mcpee] Graphify unavailable: ${result.graphify.reason}\n`);
  }
  if (codeGraph.status === "ready") {
    process.stdout.write(`[mcpee] CodeGraph ${codeGraph.operation}: files=${codeGraph.summary.file_count ?? "unknown"}, nodes=${codeGraph.summary.node_count ?? "unknown"}, edges=${codeGraph.summary.edge_count ?? "unknown"}.\n`);
  } else if (codeGraph.status === "unavailable") {
    process.stderr.write("[mcpee] CodeGraph is required but its project-local tool is unavailable.\n");
  } else {
    process.stderr.write(`[mcpee] CodeGraph rebuild failed: ${codeGraph.error}\n`);
  }
  return result.counts.failed > 0 || codeGraph.status !== "ready" || result.graphify.status === "failed" ? 1 : 0;
}

async function runUpdate(root) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const hookPath = path.join(root, ".mcpee/runtime/copilot-hook.cjs");
  const hookConfigPath = path.join(root, ".github/hooks/mcpee-observability.json");
  const refreshRuntime = fs.existsSync(hookPath) &&
    !fs.readFileSync(hookPath, "utf8").includes("assessCopilotToolCall");
  const refreshApprovalHook = fs.existsSync(hookConfigPath) && !approvalHookInstalled(root);
  if (!await approveMaintenance(
    "update",
    "Refresh MCPEE-managed project files and the rendered catalog from the currently installed MCPEE package. User-owned files are preserved. This does not update the MCPEE npm package or install external tools.",
  )) return 1;
  const result = initializeProject(root, { refreshRuntime, refreshApprovalHook });
  process.stdout.write(`[mcpee] Project integration refreshed from MCPEE ${require("../../../package.json").version}: created=${result.created.length}, updated=${result.updated.length}, preserved=${result.preserved.length}.\n`);
  process.stdout.write("[mcpee] To update the MCPEE CLI package itself, use the package manager that installed it.\n");
  return 0;
}

async function runClean(root) {
  const stateDirectory = path.join(root, ".mcpee");
  const cacheDirectory = path.join(stateDirectory, "cache");
  if (!fs.existsSync(cacheDirectory)) {
    process.stdout.write("[mcpee] No MCPEE cache to clean.\n");
    return 0;
  }
  for (const directory of [stateDirectory, cacheDirectory]) {
    if (fs.lstatSync(directory).isSymbolicLink()) {
      throw new Error(`Refusing to clean through symbolic link: ${directory}`);
    }
  }
  const entries = fs.readdirSync(cacheDirectory);
  if (!await approveMaintenance(
    "clean",
    `Delete only ${path.relative(root, cacheDirectory)} (${entries.length} top-level item(s)). Knowledge sources, indexes, graphs, reports, memory, tasks, logs, and installed tools are retained.`,
  )) return 1;
  fs.rmSync(cacheDirectory, { recursive: true });
  process.stdout.write(`[mcpee] Removed MCPEE cache (${entries.length} top-level item(s)); persistent data was retained.\n`);
  return 0;
}

function findExecutable(name) {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

function projectEmbeddingsEnabled(root) {
  return projectEmbeddingProfile(root) !== null;
}

function writeEmbeddingProfile(root, profile) {
  const bge = profile === "bge-m3";
  writeGeneratedJson(root, EMBEDDING_STATE_PATH, {
    schema_version: 1,
    generated_by: "mcpee",
    enabled: true,
    profile,
    provider: bge ? "bge-m3-local" : "ollama-local",
    model: bge ? BGE_MODEL : EMBEDDING_MODEL,
    updated_at: new Date().toISOString(),
  });
}

async function runEmbeddingCommand(root, options) {
  const [action = "status"] = options;
  const profile = optionValue(options, "--profile", projectEmbeddingProfile(root) || "light");
  if (!["status", "setup", "index"].includes(action)) {
    process.stderr.write(`[mcpee] Unknown embeddings action: ${action}\n`);
    return 2;
  }
  if (!["light", "bge-m3"].includes(profile)) {
    process.stderr.write(`[mcpee] Unknown embeddings profile: ${profile}. Use light or bge-m3.\n`);
    return 2;
  }
  if (action === "status") {
    try {
      if (profile === "bge-m3") {
        const status = localBgeEmbeddingStatus(root);
        const enabled = projectEmbeddingProfile(root) === "bge-m3";
        process.stdout.write(`[mcpee] BGE-M3 local CPU: environment ${status.available ? "available" : "missing"}; model ${status.model_available ? "available" : "not downloaded"}; project embeddings: ${enabled ? "enabled" : "not enabled"}.\n`);
        if (!status.available && status.environment_error) process.stderr.write(`[mcpee] ${status.environment_error}\n`);
        return status.available ? 0 : 1;
      }
      const status = await localEmbeddingStatus();
      const enabled = projectEmbeddingProfile(root) === "light";
      process.stdout.write(`[mcpee] Ollama: online; model ${EMBEDDING_MODEL}: ${status.model_available ? "available" : "not downloaded"}; project embeddings: ${enabled ? "enabled" : "not enabled"}.\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`[mcpee] Embeddings unavailable: ${error.message}\n`);
      return 1;
    }
  }
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  if (action === "index") {
    try {
      require("./activity").reportActivity(`Embeddings ${profile}: loading model and building local index`);
      const result = await buildEmbeddingIndex(root, {
        profile,
        onProgress: options.includes("--json") || options.includes("--chat-json") ? undefined : reportEmbeddingProgress,
      });
      writeEmbeddingProfile(root, profile);
      process.stdout.write(`[mcpee] Local embedding index updated: ${result.chunkCount} grounded chunk(s), model=${result.model}.\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`[mcpee] Embedding index failed: ${error.message}\n`);
      return 1;
    }
  }

  if (profile === "bge-m3") {
    if (!await approveMaintenance(
      "download",
      `Install a project-isolated Python 3.12 CPU environment (${BGE_PACKAGES.join(", ")}) and download ${BGE_MODEL} into .mcpee/models/bge-m3. This downloads packages/model weights only; project source stays local and indexing/search run offline.`,
    )) return 1;
    try {
      require("./activity").reportActivity("BGE-M3: preparing isolated Python dependencies");
      installPythonEnvironment(root, "bge_embeddings", "3.12", BGE_PACKAGES);
      require("./activity").reportActivity("BGE-M3: downloading or checking local model");
      downloadBgeModel(root);
      require("./activity").reportActivity("BGE-M3: loading model, tokenizing and indexing on CPU");
      const result = await buildEmbeddingIndex(root, {
        profile,
        onProgress: options.includes("--json") || options.includes("--chat-json") ? undefined : reportEmbeddingProgress,
      });
      writeEmbeddingProfile(root, profile);
      process.stdout.write(`[mcpee] BGE-M3 local CPU embeddings enabled: ${result.chunkCount} grounded chunk(s) indexed with FAISS, BM25, and RRF.\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`[mcpee] BGE-M3 setup failed: ${error.message}\n`);
      return 1;
    }
  }

  const executable = findExecutable("ollama");
  if (!executable) {
    process.stderr.write("[mcpee] Ollama was not found on PATH. Install Ollama locally, start its service, and retry. MCPEE did not download or install Ollama.\n");
    return 1;
  }
  let status;
  try {
    status = await localEmbeddingStatus();
  } catch (error) {
    process.stderr.write(`[mcpee] Cannot reach local Ollama: ${error.message}\nStart the Ollama service and retry.\n`);
    return 1;
  }
  if (!status.model_available) {
    if (!await approveMaintenance(
      "download",
      `Download ${EMBEDDING_MODEL} through local Ollama (approximately 0.6 GB; model files are stored in Ollama's user cache, not in the project). Project source text is sent only to the loopback Ollama service.`,
    )) return 1;
    const result = spawnSync(executable, ["pull", EMBEDDING_MODEL], {
      cwd: root,
      stdio: "inherit",
      timeout: 30 * 60 * 1000,
      windowsHide: true,
    });
    if (result.error) {
      process.stderr.write(`[mcpee] Ollama model download failed: ${result.error.message}\n`);
      return 1;
    }
    if (result.status !== 0) {
      process.stderr.write(`[mcpee] Ollama model download failed with exit code ${result.status}.\n`);
      return 1;
    }
  }
  try {
    status = await localEmbeddingStatus();
    if (!status.model_available) throw new Error(`Ollama did not report ${EMBEDDING_MODEL} after setup`);
    writeEmbeddingProfile(root, "light");
    const result = await buildEmbeddingIndex(root);
    process.stdout.write(`[mcpee] Local embeddings enabled: ${result.chunkCount} grounded chunk(s) indexed with ${result.model}.\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`[mcpee] Local embedding setup failed: ${error.message}\n`);
    return 1;
  }
}

async function runKnowledge(root, args) {
  const [action = "search", ...options] = args;
  if (action === "embeddings") return runEmbeddingCommand(root, options);
  if (action === "context") {
    const query = optionValue(options, "--query");
    const maxTokens = Number.parseInt(optionValue(options, "--max-tokens", "4000"), 10);
    if (!query || options.includes("--max-tokens") && !Number.isInteger(maxTokens)) {
      process.stderr.write("[mcpee] Usage: mcpee knowledge context --query <text> [--max-tokens <128..32000>] [--json]\n");
      return 2;
    }
    try {
      const result = await searchGroundedContext(root, query, {
        maxTokens,
        allowLexicalFallback: true,
      });
      if (options.includes("--json")) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(result.context);
      }
      if (result.retrieval.includes("lexical-fallback")) {
        const reason = result.fallback_reason?.replace(/[.!?]+$/, "");
        process.stderr.write(`[mcpee] Grounding used lexical fallback${reason ? `: ${reason}` : " for sources without current vectors"}. Run \`mcpee knowledge embeddings setup\` to enable semantic retrieval and \`mcpee knowledge embeddings index\` after source changes to refresh vectors.\n`);
      }
      return 0;
    } catch (error) {
      process.stderr.write(`[mcpee] Grounded context retrieval failed: ${error.message}\n`);
      return 1;
    }
  }
  if (action !== "search" && action !== "graph") {
    process.stderr.write(`[mcpee] Unknown knowledge action: ${action}\n`);
    return 2;
  }
  const query = optionValue(options, "--query");
  const mode = optionValue(options, "--mode", "lexical");
  if (!query) {
    process.stderr.write("[mcpee] Usage: mcpee knowledge search|graph --query <text> [--mode lexical|vector] [--limit <n>] [--json]\n");
    return 2;
  }
  if (action === "graph" && options.includes("--mode") ||
      action === "search" && !["lexical", "vector"].includes(mode)) {
    process.stderr.write("[mcpee] --mode is supported only for knowledge search and accepts lexical or vector.\n");
    return 2;
  }
  const limit = Number.parseInt(optionValue(options, "--limit", "10"), 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    process.stderr.write("[mcpee] --limit must be an integer between 1 and 100\n");
    return 2;
  }
  if (action === "graph") {
    const results = [];
    const unifiedPath = path.join(root, GRAPH_PATH);
    if (fs.existsSync(unifiedPath)) {
      results.push(...searchUnifiedGraph(root, query, limit).map((result) => ({ ...result, graph: "unified" })));
    }
    if (readCodeGraphState(root)?.status === "ready") {
      results.push(...searchCodeGraph(root, query, limit).map((result) => ({ ...result, graph: "codegraph" })));
    }
    if (readGraphifyState(root)?.status === "ready") {
      results.push(...searchGraphify(root, query, limit).map((result) => ({ ...result, graph: "graphify" })));
    }
    results.sort((left, right) => (right.score || 0) - (left.score || 0) ||
      left.source_path.localeCompare(right.source_path) || left.symbol.localeCompare(right.symbol));
    const limitedResults = results.slice(0, limit);
    if (options.includes("--json")) {
      process.stdout.write(`${JSON.stringify(limitedResults, null, 2)}\n`);
      return 0;
    }
    if (limitedResults.length === 0) {
      process.stdout.write("No graph evidence matches this query.\n");
      return 0;
    }
    for (const result of limitedResults) {
      process.stdout.write(`${result.graph || "graph"} ${result.source_path}:${result.start_line ?? "?"} ${result.symbol_kind || "symbol"} ${result.symbol}\n`);
    }
    return 0;
  }
  const results = mode === "vector"
    ? searchKnowledgeVector(root, query, limit)
    : searchKnowledge(root, query, limit);
  if (options.includes("--json")) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  }
  if (results.length === 0) {
    process.stdout.write("No local knowledge matches this query.\n");
    return 0;
  }
  for (const result of results) {
    process.stdout.write(`${result.source_path} (score ${result.score})\n  ${result.normalized_path}\n`);
  }
  return 0;
}

function runImpact(root, args) {
  const relativePath = optionValue(args, "--path");
  if (!relativePath) {
    process.stderr.write("[mcpee] Usage: mcpee impact --path <project-relative-path> [--json]\n");
    return 2;
  }
  const impact = analyzeImpact(root, relativePath);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(impact, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`Impact for ${impact.target}\n`);
  if (impact.affected_sources.length === 0) {
    process.stdout.write("No indexed source-code dependents found.\n");
  } else {
    process.stdout.write("Source-code dependents:\n");
    for (const dependent of impact.affected_sources) {
      process.stdout.write(`  ${dependent.source_path} (depth ${dependent.depth})\n`);
      for (const [index, evidence] of dependent.evidence.entries()) {
        process.stdout.write(`    ${evidence.source_path}:${evidence.line ?? "?"} imports ${dependent.chain[index]}\n`);
      }
    }
  }
  if (impact.referencing_sources.length === 0) {
    process.stdout.write("No indexed Markdown references found.\n");
  } else {
    process.stdout.write("Linked documents:\n");
    for (const reference of impact.referencing_sources) {
      process.stdout.write(`  ${reference.source_path}:${reference.evidence.line ?? "?"}\n`);
    }
  }
  return 0;
}

function runDrift(root, args) {
  const findings = {
    missing_local_references: getDocumentDrift(root),
    conflicting_claims: getDocumentContradictions(root),
  };
  const findingCount = findings.missing_local_references.length + findings.conflicting_claims.length;
  recordEvent(root, {
    event_name: "knowledge.document_drift.reviewed",
    attributes: {
      finding_count: findingCount,
      missing_local_references: findings.missing_local_references.length,
      conflicting_claims: findings.conflicting_claims.length,
    },
  });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
    return 0;
  }
  if (findingCount === 0) {
    process.stdout.write("No missing in-project Markdown targets or explicit conflicting claims were found.\n");
    return 0;
  }
  if (findings.missing_local_references.length) {
    process.stdout.write(`Unresolved in-project Markdown targets (${findings.missing_local_references.length}; review before treating as drift):\n`);
  }
  for (const finding of findings.missing_local_references) {
    process.stdout.write(`  ${finding.source_path}:${finding.line} -> ${finding.target_path}\n`);
  }
  if (findings.conflicting_claims.length) {
    process.stdout.write(`Conflicting documented claims (${findings.conflicting_claims.length}; heuristic candidates requiring review):\n`);
  }
  for (const finding of findings.conflicting_claims) {
    const [first, second] = finding.claims;
    process.stdout.write(`  ${finding.anchor} (${finding.topic}): ${first.source_path}:${first.line} says ${first.value}; ${second.source_path}:${second.line} says ${second.value}\n`);
  }
  return 0;
}

function printImpactPreflight(preflight) {
  process.stdout.write(`[mcpee] Impact preflight: ${preflight.status}.\n`);
  if (preflight.reason) process.stdout.write(`[mcpee] ${preflight.reason}\n`);
  for (const target of preflight.targets) {
    process.stdout.write(`  Target: ${target.target}\n`);
    for (const dependent of target.affected_sources) {
      const evidence = dependent.evidence.map((item) =>
        `${item.source_path}:${item.line ?? "?"}`).join(", ");
      process.stdout.write(`    Affected: ${dependent.source_path} (depth ${dependent.depth}; ${evidence})\n`);
    }
    for (const reference of target.referencing_sources) {
      process.stdout.write(`    Linked document: ${reference.source_path}:${reference.evidence.line ?? "?"}\n`);
    }
  }
  for (const sourcePath of preflight.unindexed) {
    process.stdout.write(`  Not indexed: ${sourcePath}\n`);
  }
}

function runTools(root, args) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const [action = "list", ...options] = args;
  if (action !== "list" && action !== "validate") {
    process.stderr.write(`[mcpee] Unknown tools action: ${action}\n`);
    return 2;
  }
  const toolIds = [];
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] === "--project") {
      index += 1;
      continue;
    }
    if (options[index] !== "--tool" || !options[index + 1] || options[index + 1].startsWith("--")) {
      process.stderr.write(`[mcpee] Invalid tools option: ${options[index]}\n`);
      return 2;
    }
    toolIds.push(options[index + 1]);
    index += 1;
  }
  const report = action === "validate"
    ? validateTools(root, toolIds)
    : discoverTools(root);
  if (action === "list") saveToolReport(root, report);
  for (const tool of report.tools) {
    const version = tool.version ? ` (${tool.version})` : "";
    const reason = tool.reason ? ` — ${tool.reason}` : "";
    process.stdout.write(`${tool.id}: ${tool.validation || "not-validated"}${version}${reason}${tool.error ? ` — ${tool.error}` : ""}\n`);
  }
  const requiredMissing = report.tools.some((tool) =>
    tool.available === false && tool.optional === false);
  const failedValidation = report.tools.some((tool) => tool.validation === "failed");
  return requiredMissing || failedValidation ? 1 : 0;
}

function runMemory(root, args) {
  const [action = "list", ...options] = args;
  if (action === "add") {
    const kind = optionValue(options, "--kind");
    const text = optionValue(options, "--text");
    if (!kind || !text) {
      process.stderr.write("[mcpee] Usage: mcpee memory add --kind <kind> --text <text> [--source <path>]\n");
      return 2;
    }
    const entry = addMemory(root, {
      kind,
      text,
      sources: options.includes("--source") ? [optionValue(options, "--source")] : [],
    });
    process.stdout.write(`[mcpee] Memory entry saved locally: ${entry.id}\n`);
    return 0;
  }
  if (action === "search") {
    const query = optionValue(options, "--query");
    if (!query) {
      process.stderr.write("[mcpee] Usage: mcpee memory search --query <text> [--limit <n>]\n");
      return 2;
    }
    const limit = Number.parseInt(optionValue(options, "--limit", "10"), 10);
    const results = searchMemory(root, query, limit);
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  }
  if (action !== "list") {
    process.stderr.write(`[mcpee] Unknown memory action: ${action}\n`);
    return 2;
  }
  const kind = optionValue(options, "--kind");
  const entries = listMemory(root, kind);
  process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
  return 0;
}

async function approveStep(check) {
  const hostDecision = await requestApprovalFromHost("workflow-step", {
    action: check.action,
    label: check.label,
    tool: check.tool,
    args: formatApprovalArguments(check.args),
    reason: check.reason,
  });
  if (hostDecision !== null) return hostDecision;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(`[mcpee] Approval required for ${check.tool} ${formatApprovalArguments(check.args).join(" ")}; non-interactive execution is denied.\n`);
    return false;
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(
      `[mcpee] Approve ${check.action} "${check.label}"? Tool: ${check.tool} ${formatApprovalArguments(check.args).join(" ")}. Reason: ${check.reason}\nType "approve" to authorize this invocation only [deny]: `,
    );
    return answer.trim().toLowerCase() === "approve";
  } finally {
    terminal.close();
  }
}

async function approveInstall(install) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(`[mcpee] Approval required to install ${install.package || install.id}@${install.version || "latest"} into ${install.target}; non-interactive installation is denied.\n`);
    return false;
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(
      `[mcpee] Approve downloading/installing ${install.package || install.id}@${install.version || "latest"} (${install.installer}) into ${install.target}${install.runtimeTarget ? ` and preparing ${install.runtimeTarget}` : ""}? This may contact package registries. Type "approve" [deny]: `,
    );
    return answer.trim().toLowerCase() === "approve";
  } finally {
    terminal.close();
  }
}

async function chooseInitEmbeddingProfile(args) {
  const requested = optionValue(args, "--embeddings");
  if (args.includes("--embeddings")) {
    if (["none", "light", "bge-m3"].includes(requested)) return requested;
    throw new Error("--embeddings must be one of: none, light, bge-m3.");
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) return "none";

  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await terminal.question(
        "[mcpee] Optional local semantic embeddings: bge-m3 (recommended, CPU), light (local Ollama), or none [none]: ",
      )).trim().toLowerCase();
      if (!answer) return "none";
      if (["none", "light", "bge-m3"].includes(answer)) return answer;
      process.stderr.write("Choose none, light, or bge-m3.\n");
    }
  } finally {
    terminal.close();
  }
}

async function chooseInitAgents(root, args) {
  const requested = optionValue(args, "--agents");
  if (args.includes("--agents")) {
    if (!requested) throw new Error("--agents requires a comma-separated ID list, 'all', or 'none'.");
    if (requested === "all") return readCatalog().catalog.agents.map((agent) => agent.id);
    if (requested === "none" || requested === "") return [];
    const selected = requested.split(",").map((id) => id.trim()).filter(Boolean);
    const available = new Set(readCatalog().catalog.agents.map((agent) => agent.id));
    const unknown = [...new Set(selected)].filter((id) => !available.has(id));
    if (unknown.length) throw new Error(`Unknown agent ID(s): ${unknown.join(", ")}`);
    if (new Set(selected).size !== selected.length) throw new Error("--agents cannot contain duplicate IDs.");
    return selected;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY ||
      fs.existsSync(path.join(root, ".mcpee/state/catalog-capabilities.json"))) {
    return null;
  }
  const capabilities = detectProjectCapabilities(root, readCatalog().catalog);
  if (capabilities.has_code_signals) return null;
  const catalogAgents = readCatalog().catalog.agents;
  const defaults = new Set(capabilities.assets.agents);
  process.stdout.write("[mcpee] No source-code or stack signals found. Select initial agents; their skills, workflows, and patterns are included automatically.\n");
  process.stdout.write(`Available agents: ${catalogAgents.map((agent) => agent.id).join(", ")}\n`);
  process.stdout.write(`Default: ${[...defaults].join(", ")}\n`);
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await terminal.question(
        "[mcpee] Agent IDs (comma-separated), 'all', or 'none' [default]: ",
      )).trim().toLowerCase();
      if (!answer) return [...defaults];
      if (answer === "all") return catalogAgents.map((agent) => agent.id);
      if (answer === "none") return [];
      const selected = answer.split(",").map((id) => id.trim()).filter(Boolean);
      const available = new Set(catalogAgents.map((agent) => agent.id));
      const unknown = [...new Set(selected)].filter((id) => !available.has(id));
      if (unknown.length) {
        process.stderr.write(`Unknown agent ID(s): ${unknown.join(", ")}. Choose from the listed agents.\n`);
        continue;
      }
      if (new Set(selected).size !== selected.length) {
        process.stderr.write("Agent IDs must not be repeated.\n");
        continue;
      }
      return selected;
    }
  } finally {
    terminal.close();
  }
}

function requiredToolInstallationFailures(results, tools) {
  const requiredToolIds = new Set(tools
    .filter((tool) => !tool.optional)
    .map((tool) => tool.id));
  return results.filter((item) =>
    requiredToolIds.has(item.id) && ["failed", "blocked"].includes(item.status));
}

async function approveRuntimeRefresh({ refreshRuntime, refreshApprovalHook }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("[mcpee] The installed Copilot hook is outdated and does not enforce tool approval; non-interactive runtime replacement is denied.\n");
    return false;
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(
      `[mcpee] Authorize ${[
        ...(refreshRuntime ? [".mcpee/runtime/copilot-hook.cjs and approval-policy.cjs replacement"] : []),
        ...(refreshApprovalHook ? ["adding the MCPEE preToolUse hook to .github/hooks/mcpee-observability.json (existing hooks are preserved)"] : []),
      ].join(" and ")}? Back up any local runtime customizations first. Type "replace" [deny]: `,
    );
    return answer.trim().toLowerCase() === "replace";
  } finally {
    terminal.close();
  }
}

async function runEvaluation(root, args) {
  const suiteId = optionValue(args, "--suite");
  if (suiteId) {
    if (!["specialist-core", "specialist-audit"].includes(suiteId) || args.includes("--run") || args.includes("--case")) {
      throw new Error("Use --suite specialist-core or specialist-audit separately from --run and --case.");
    }
    const scenarioId = optionValue(args, "--scenario");
    const variant = optionValue(args, "--variant");
    const results = optionValue(args, "--results");
    if (scenarioId || variant) {
      if (!scenarioId || !variant || results) {
        throw new Error("Task export requires --scenario and --variant, without --results.");
      }
      const suite = suiteId === "specialist-audit" ? loadAuditSuite() : loadSpecialistSuite().suite;
      const scenario = suite.scenarios.find(item => item.id === scenarioId);
      if (!scenario) throw new Error(`Unknown specialist scenario '${scenarioId}'.`);
      const task = suiteId === "specialist-audit" ? auditTask(scenario, variant).task : specialistTask(scenario, variant);
      process.stdout.write(args.includes("--json")
        ? `${JSON.stringify({ scenario_id: scenarioId, variant, agent: scenario.agent, task }, null, 2)}\n`
        : `${task}\n`);
      return 0;
    }
    const report = suiteId === "specialist-audit"
      ? buildAuditAcceptance(root, results) : buildSpecialistAcceptance(root, results);
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`[mcpee] Specialist acceptance: ${report.status}; ${report.summary.passed}/${report.summary.required_trials} trials passed; ${report.summary.failed} failed; ${report.summary.not_run} not run.\n`);
      for (const scenario of report.scenarios) {
        process.stdout.write(`  ${scenario.id} (${scenario.agent}): ${scenario.trials.map(item => `${item.variant}=${item.status}`).join(", ")}\n`);
      }
      if (suiteId === "specialist-audit") {
        const summary = report.summary;
        process.stdout.write(`  Seeded defects: ${summary.detected_defects}/${summary.expected_defects_reviewed} detected in reviewed positive trials; ${summary.missed_defects} missed.\n`);
        process.stdout.write(`  Unsupported findings: ${summary.unsupported_findings}/${summary.findings}; duplicates: ${summary.duplicate_findings}.\n`);
        process.stdout.write(`  Reviewed controls: ${summary.control_trials_reviewed}; alarm rate: ${summary.control_alarm_rate === null ? "not measured" : summary.control_alarm_rate}; evidence gaps: ${summary.acknowledged_unknowns}/${summary.required_unknowns_reviewed} acknowledged.\n`);
      }
      process.stdout.write("This is evidence for declared scenarios, not general specialist certification. No model or check was executed by this command.\n");
    }
    return report.status === "passed" ? 0 : report.status === "failed" ? 1 : 2;
  }
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const caseId = optionValue(args, "--case");
  if (caseId) {
    const catalog = readCatalog().catalog;
    const evaluationCase = catalog.eval_cases.find((entry) => entry.id === caseId);
    if (!evaluationCase) {
      process.stderr.write(`[mcpee] Unknown evaluation case '${caseId}'.\n`);
      return 2;
    }
    const assetId = optionValue(args, "--asset");
    const assetExists = [...catalog.agents, ...catalog.skills, ...catalog.workflows]
      .some((entry) => entry.id === assetId);
    if (!assetId || !assetExists) {
      process.stderr.write("[mcpee] --asset must identify a catalogued agent, skill, or workflow.\n");
      return 2;
    }
    const response = optionValue(args, "--response");
    const ratings = optionValue(args, "--ratings");
    const reviewer = optionValue(args, "--reviewer");
    if (!response) {
      process.stderr.write("[mcpee] Usage: mcpee evaluate --case <id> --asset <id> --response <project-relative-file> [--ratings <json> --reviewer <name>] [--json]\n");
      return 2;
    }
    const scorecard = catalog.scorecards.find((entry) => entry.id === evaluationCase.scorecard);
    const result = evaluateAssetResponse(root, {
      evaluationCase,
      scorecard,
      assetId,
      responsePath: response,
      ratingsPath: ratings,
      reviewer,
    });
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`[mcpee] Asset evaluation ${result.id}: ${result.status}; case=${result.case_id}; asset=${result.asset_id}\n`);
      for (const assertion of result.automated_assertions) {
        process.stdout.write(`  ${assertion.status}: response ${assertion.assertion} ${JSON.stringify(assertion.expected_literal)}\n`);
      }
      if (result.human_review.status === "reviewed") {
        process.stdout.write(`  human review: ${result.human_review.ratings.reduce((sum, rating) => sum + rating.rating, 0)}/${result.scorecard_summary.maximum}; reviewer=${result.human_review.reviewer}\n`);
      } else {
        process.stdout.write("  human scorecard review is required before a passing result can be recorded.\n");
      }
      process.stdout.write(`  response content stored: no; report: ${result.file}\n`);
    }
    return result.status === "passed" ? 0 : result.status === "awaiting-review" ? 2 : 1;
  }
  const runSpec = optionValue(args, "--run");
  if (!runSpec) {
    process.stderr.write("[mcpee] Usage: mcpee evaluate --run <project-relative-json>\n");
    return 2;
  }
  const result = await evaluateExecution(root, runSpec, { approveStep });
  process.stdout.write(`[mcpee] Evaluation ${result.id}: ${result.status}\n`);
  for (const check of result.checks) {
    process.stdout.write(`  ${check.status}: ${check.label} (${check.tool}, exit ${check.exit_code ?? "not started"})\n`);
  }
  process.stdout.write(`  evidence: ${result.evidence.length}; report: ${result.file}\n`);
  if (result.task_proposals.length) {
    process.stdout.write(`  follow-up tasks proposed: ${result.task_proposals.length}; review with mcpee tasks list\n`);
  }
  if (result.learning_proposals.length) {
    process.stdout.write(`  recurring workflow pattern proposed: ${result.learning_proposals.length}; review with mcpee learn list (approval required before memory)\n`);
  }
  return result.status === "passed" ? 0 : 1;
}

async function runWorkflowCommand(root, args) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const [action = "run", ...options] = args;
  if (action !== "run") {
    process.stderr.write(`[mcpee] Unknown workflow action: ${action}\n`);
    return 2;
  }
  const specPath = optionValue(options, "--spec");
  if (!specPath) {
    process.stderr.write("[mcpee] Usage: mcpee workflow run --spec <project-relative-json>\n");
    return 2;
  }
  const result = await runWorkflow(root, specPath, {
    approveStep,
    beforeRun: printImpactPreflight,
  });
  process.stdout.write(`[mcpee] Workflow ${result.workflow_id}: ${result.status} (${result.id})\n`);
  for (const step of result.checks) {
    process.stdout.write(`  ${step.status}: ${step.label} (${step.tool}, exit ${step.exit_code ?? "not started"})\n`);
  }
  process.stdout.write(`  evidence: ${result.evidence.length}; report: ${result.file}\n`);
  if (result.learning_proposals.length) {
    process.stdout.write(`  recurring workflow pattern proposed: ${result.learning_proposals.length}; review with mcpee learn list (approval required before memory)\n`);
  }
  return result.status === "passed" ? 0 : 1;
}

function runAssetAudit(root, args) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  if (args[0] !== "audit") {
    process.stderr.write("[mcpee] Usage: mcpee assets audit [--json]\n");
    return 2;
  }
  const report = auditHarness(root);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Harness asset audit: ${report.findings.length} finding(s) across ${report.scanned_files} file(s); read-only heuristic.\n`);
    for (const item of report.findings) {
      process.stdout.write(`  ${item.severity.toUpperCase()} ${item.file}:${item.line} ${item.rule} — ${item.title}\n`);
    }
    for (const pathSkipped of report.skipped_paths) {
      process.stdout.write(`  SKIPPED ${pathSkipped} (symlink or unsupported path)\n`);
    }
    if (report.skipped_oversized_files) {
      process.stdout.write(`  SKIPPED ${report.skipped_oversized_files} oversized file(s)\n`);
    }
    if (report.truncated) process.stdout.write("  Coverage truncated at the configured file limit.\n");
    process.stdout.write("  No findings is not proof that the harness is safe; review coverage and heuristic limits.\n");
  }
  return report.summary.critical || report.summary.high ? 1 : 0;
}

function runCatalogCoverage(args) {
  const report = buildCatalogCoverageReport();
  if (args.some((argument) => !["--json"].includes(argument))) {
    process.stderr.write("[mcpee] Usage: mcpee coverage [--json]\n");
    return 2;
  }
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Catalog coverage: ${report.status}; ${report.technology_count} technology profiles map all ${report.required_asset_categories.length} required asset categories.\n`);
    for (const technology of report.technologies) {
      process.stdout.write(`  ${technology.status.padEnd(8)} ${technology.id} (${technology.name}): validation basis=${technology.validation_basis}\n`);
    }
    process.stdout.write(`${report.status_semantics.mapped}\n`);
  }
  return 0;
}

function runQualityGates(root, args) {
  const commandArgs = args.filter((argument, index) =>
    argument !== "--project" && args[index - 1] !== "--project");
  if (commandArgs.some((argument) => !["--json", "--strict"].includes(argument))) {
    process.stderr.write("[mcpee] Usage: mcpee quality [--strict] [--json]\n");
    return 2;
  }
  const report = buildQualityGateReport(root);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Project quality gates: ${report.status}; detected technologies=${report.detected_technology_count}.\n`);
    for (const technology of report.technologies) {
      process.stdout.write(`  ${technology.status.padEnd(19)} ${technology.id}: ${technology.configured_check_count} declared check(s), validation basis=${technology.validation_basis || "not mapped"}\n`);
      for (const check of technology.checks) {
        process.stdout.write(`    ${check.workflow_spec} :: ${check.id} (${check.tool})\n`);
      }
    }
    for (const limitation of report.limitations) process.stdout.write(`  NOTE ${limitation}\n`);
  }
  if (!args.includes("--strict")) return 0;
  return report.status === "passed" ? 0 : report.status === "failed" ? 1 : 2;
}

function runSkillHealth(root, args) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  if (args[0] !== "health") {
    process.stderr.write("[mcpee] Usage: mcpee skills health [--json]\n");
    return 2;
  }
  const report = buildSkillHealth(root, readCatalog().catalog);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Skill evidence: ${report.reports_considered} recorded workflow evaluation(s); metric=${report.metric}.\n`);
    for (const skill of report.skills) {
      process.stdout.write(`  ${skill.status.padEnd(19)} ${skill.id}: direct n=${skill.sample_size}, passed=${skill.passed}, failed=${skill.failed}, pass rate=${skill.observed_pass_rate ?? "not available"}; workflow proxy n=${skill.workflow_outcome_proxy.sample_size}, pass rate=${skill.workflow_outcome_proxy.pass_rate ?? "not available"}\n`);
    }
    process.stdout.write(`${report.interpretation}\n`);
  }
  return 0;
}

function runPlan(root, args) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const [action = "list", ...options] = args;
  if (action === "list") {
    const plans = listPlans(root);
    if (options.includes("--json")) {
      process.stdout.write(`${JSON.stringify(plans, null, 2)}\n`);
    } else if (!plans.length) {
      process.stdout.write("No planning artifacts found. Create one with mcpee plan init.\n");
    } else {
      for (const plan of plans) {
        process.stdout.write(`${plan.id}: specification=${plan.specification ? "present" : "missing"}, delivery-plan=${plan.delivery_plan ? "present" : "missing"}\n`);
      }
    }
    return 0;
  }
  if (action !== "init") {
    process.stderr.write(`[mcpee] Unknown plan action: ${action}\n`);
    return 2;
  }
  const slug = optionValue(options, "--slug");
  const title = optionValue(options, "--title");
  if (!slug || !title) {
    process.stderr.write("[mcpee] Usage: mcpee plan init --slug <id> --title <title>\n");
    return 2;
  }
  const plan = createPlan(root, { slug, title });
  process.stdout.write(`[mcpee] Created planning artifacts for ${plan.id}:\n${plan.files.map((file) => `  ${file}`).join("\n")}\n`);
  return 0;
}

function runTasks(root, args) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const [action = "list", ...options] = args;
  if (action === "list") {
    process.stdout.write(`${JSON.stringify(listTasks(root), null, 2)}\n`);
    return 0;
  }
  const taskId = options.find((item) => !item.startsWith("--"));
  if (!taskId) {
    process.stderr.write(`[mcpee] Usage: mcpee tasks ${action} <task-id>${action === "complete" ? " --evaluation <id>" : ""}\n`);
    return 2;
  }
  let task;
  if (action === "approve" || action === "reject") {
    task = decideTask(root, taskId, action === "approve" ? "approved" : "rejected");
  } else if (action === "start") {
    task = startTask(root, taskId);
  } else if (action === "complete") {
    const evaluationId = optionValue(options, "--evaluation");
    if (!evaluationId) {
      process.stderr.write("[mcpee] Usage: mcpee tasks complete <task-id> --evaluation <id>\n");
      return 2;
    }
    task = completeTask(root, taskId, evaluationId);
  } else {
    process.stderr.write(`[mcpee] Unknown tasks action: ${action}\n`);
    return 2;
  }
  process.stdout.write(`[mcpee] Task ${task.task_id}: ${task.status}\n`);
  return 0;
}

function runLearning(root, args) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const [action = "list", ...options] = args;
  if (action === "propose") {
    const evaluationId = optionValue(options, "--evaluation");
    const kind = optionValue(options, "--kind");
    const text = optionValue(options, "--text");
    if (!evaluationId || !kind || !text) {
      process.stderr.write("[mcpee] Usage: mcpee learn propose --evaluation <id> --kind <pattern|insight> --text <text>\n");
      return 2;
    }
    const proposal = proposeLearning(root, { evaluationId, kind, text });
    process.stdout.write(`[mcpee] Learning proposal ${proposal.proposal_id} is pending human approval.\n`);
    return 0;
  }
  if (action === "approve" || action === "reject") {
    const proposalId = options.find((item) => !item.startsWith("--"));
    if (!proposalId) {
      process.stderr.write(`[mcpee] Usage: mcpee learn ${action} <proposal-id>\n`);
      return 2;
    }
    const decision = decideLearning(root, proposalId, action === "approve" ? "approved" : "rejected");
    process.stdout.write(`[mcpee] Learning proposal ${decision.proposal_id}: ${decision.status}${decision.memory_id ? `; memory=${decision.memory_id}` : ""}\n`);
    return 0;
  }
  if (action === "list") {
    process.stdout.write(`${JSON.stringify(listLearning(root), null, 2)}\n`);
    return 0;
  }
  process.stderr.write(`[mcpee] Unknown learning action: ${action}\n`);
  return 2;
}

function runRoute(root, args) {
  const task = optionValue(args, "--task");
  if (!task || !fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    return runRouteInternal(root, args);
  }
  const traceId = process.env.MCPEE_TRACE_ID || crypto.randomUUID();
  const inheritedParentId = process.env.MCPEE_PARENT_EVENT_ID || null;
  const startedAt = Date.now();
  const started = withTelemetryContext(
    { trace_id: traceId, parent_id: inheritedParentId },
    () => recordEvent(root, {
      source: "mcpee-cli",
      event_name: "mcpee.cli.route.started",
      payload: { task },
    }),
  );
  return withTelemetryContext({ trace_id: traceId, parent_id: started.event_id }, () => {
    try {
      const exitCode = runRouteInternal(root, args);
      recordEvent(root, {
        source: "mcpee-cli",
        event_name: "mcpee.cli.route.completed",
        attributes: {
          outcome: exitCode === 0 ? "success" : "failure",
          exit_code: exitCode,
          duration_ms: Math.max(0, Date.now() - startedAt),
        },
      });
      return exitCode;
    } catch (error) {
      recordEvent(root, {
        source: "mcpee-cli",
        event_name: "mcpee.cli.route.completed",
        attributes: {
          outcome: "failure",
          duration_ms: Math.max(0, Date.now() - startedAt),
          error: error.message,
        },
      });
      throw error;
    }
  });
}

function runRouteInternal(root, args) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const task = optionValue(args, "--task");
  if (!task) {
    process.stderr.write("[mcpee] Usage: mcpee route --task <request> [--json]\n");
    return 2;
  }
  const plan = routeTask(root, task);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`Workflow: ${plan.workflow.id}\nAgent: ${plan.agent.id} — ${plan.agent.description}\n`);
  process.stdout.write(`Skills: ${plan.skills.map((skill) => skill.id).join(", ")}\n`);
  if (plan.fallback) process.stdout.write(`Fallback: ${plan.fallback}\n`);
  process.stdout.write(`Memory evidence: ${plan.memory.length}; knowledge sources: ${plan.knowledge.length}\n`);
  process.stdout.write(`CodeGraph symbol evidence: ${plan.knowledge_graph.length}\n`);
  process.stdout.write(`Local tools available: ${plan.local_tools.join(", ") || "none"}\n`);
  process.stdout.write(`${plan.execution}\n`);
  return 0;
}

async function approveCopilotDataTransfer(projectRoot, plan, contextPackage = null, conversationContext = []) {
  const startedAt = Date.now();
  const recordDecision = (decision, error = null) => recordEvent(projectRoot, {
    event_name: "copilot.data_transfer.approval",
    attributes: {
      decision,
      workflow: plan.workflow.id,
      agent: plan.agent.id,
      memory_count: plan.memory.length,
      knowledge_source_count: plan.knowledge.length,
      codegraph_match_count: plan.knowledge_graph.length,
      context_kind: contextPackage?.kind || "routing-summary",
      context_retrieval: contextPackage?.retrieval || null,
      context_bytes: contextPackage?.byteLength || 0,
      estimated_tokens: contextPackage?.estimatedTokens || null,
      selected_source_count: contextPackage?.files?.length || 0,
      recent_chat_turn_count: conversationContext.length,
      duration_ms: Math.max(0, Date.now() - startedAt),
      ...(error ? { error: error.message } : {}),
    },
  });
  try {
    const hostDecision = await requestApprovalFromHost("project-data-transfer", {
      workflow: plan.workflow.id,
      agent: plan.agent.id,
      memory_count: plan.memory.length,
      knowledge_source_count: plan.knowledge.length,
      codegraph_match_count: plan.knowledge_graph.length,
      context_kind: contextPackage?.kind || "routing-summary",
      context_retrieval: contextPackage?.retrieval || null,
      context_bytes: contextPackage?.byteLength || 0,
      estimated_tokens: contextPackage?.estimatedTokens || null,
      selected_sources: contextPackage?.files || [],
      recent_chat_turn_count: conversationContext.length,
    });
    if (hostDecision !== null) {
      recordDecision(hostDecision ? "approved" : "denied");
      return hostDecision;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      process.stderr.write("[mcpee] Copilot execution sends the task and selected routing context to GitHub Copilot; non-interactive approval is denied.\n");
      recordDecision("denied");
      return false;
    }
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const contextLabel = contextPackage?.kind === "specifications"
        ? "Approved specifications"
        : "Repomix package";
      const answer = await terminal.question(
        `[mcpee] Send the task, ${conversationContext.length} recent chat turn(s), and selected local context to GitHub Copilot? It may read project files through approved tools. Workflow=${plan.workflow.id}; agent=${plan.agent.id}; memories=${plan.memory.length}; knowledge sources=${plan.knowledge.length}; CodeGraph matches=${plan.knowledge_graph.length}.${contextPackage ? ` ${contextPackage.kind === "grounded" ? `Grounded ${contextPackage.retrieval} context=${contextPackage.byteLength} bytes; estimated tokens=${contextPackage.estimatedTokens};` : `${contextLabel}=${contextPackage.byteLength} bytes;`} selected files (${contextPackage.files.length}):\n${contextPackage.files.map((file) => `  - ${file}`).join("\n")}.` : ""} Type "send" to continue [deny]: `,
      );
      const approved = answer.trim().toLowerCase() === "send";
      recordDecision(approved ? "approved" : "denied");
      return approved;
    } finally {
      terminal.close();
    }
  } catch (error) {
    recordDecision("error", error);
    throw error;
  }
}

async function approveCopilotPermission(request, description) {
  const hostDecision = await requestApprovalFromHost("copilot-permission", {
    permission_kind: request.kind,
    description: redact(description),
  });
  if (hostDecision !== null) return hostDecision;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const preview = description.length > 4000
    ? `${description.slice(0, 4000)}\n[preview truncated; deny if the full action is not clear]`
    : description;
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(
      `[mcpee] Copilot requests runtime permission (${request.kind}):\n${preview}\nType "approve" to authorize this action once [deny]: `,
    );
    return answer.trim().toLowerCase() === "approve";
  } finally {
    terminal.close();
  }
}

async function approveCopilotTool(input, reason, impactPreflight = { targets: [] }) {
  const safeArguments = JSON.stringify(redact(
    input.toolArgs ?? input.tool_args ?? input.tool_input ?? input.arguments,
  ), null, 2);
  const hostDecision = await requestApprovalFromHost("copilot-tool", {
    tool: input.toolName,
    arguments: safeArguments.length > 4000
      ? `${safeArguments.slice(0, 4000)}\n[preview truncated; deny if the full action is not clear]`
      : safeArguments,
    impact: impactPreflight.targets.flatMap((target) => [
      `Target: ${target.target}`,
      ...target.affected_sources.map((dependent) =>
        `Affected: ${dependent.source_path} (depth ${dependent.depth})`),
      ...target.referencing_sources.map((reference) =>
        `Linked document: ${reference.source_path}:${reference.evidence.line ?? "?"}`),
    ]),
    reason,
  });
  if (hostDecision !== null) return hostDecision;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const preview = safeArguments.length > 4000
    ? `${safeArguments.slice(0, 4000)}\n[preview truncated; deny if the full action is not clear]`
    : safeArguments;
  const impactSummary = impactPreflight.targets.flatMap((target) => [
    `  Target: ${target.target}`,
    ...target.affected_sources.map((dependent) =>
      `    Affected: ${dependent.source_path} (depth ${dependent.depth})`),
    ...target.referencing_sources.map((reference) =>
      `    Linked document: ${reference.source_path}:${reference.evidence.line ?? "?"}`),
  ]).join("\n") || "  No indexed impact evidence.";
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(
      `[mcpee] Copilot requests tool "${input.toolName}".\nArguments:\n${preview}\nImpact preflight:\n${impactSummary}\nReason: ${reason}\nType "approve" to authorize this exact call once [deny]: `,
    );
    return answer.trim().toLowerCase() === "approve";
  } finally {
    terminal.close();
  }
}

async function synchronizeAfterCopilotChanges(root, changedPaths, workflowId, options = {}) {
  const onValidation = options.onValidation || (() => {});
  const description = [
    "Copilot successfully changed project files. Refresh MCPEE's local indexes, evidence graph, and required CodeGraph before running the selected validation workflow. Generated documentation is refreshed only if that workflow passes.",
    ...changedPaths.map((sourcePath) => `  - ${sourcePath}`),
  ].join("\n");
  const approved = await (options.approveSync || approveMaintenance)("sync", description);
  recordEvent(root, {
    event_name: "copilot.post_change_sync.decision",
    attributes: { decision: approved ? "approved" : "denied", changed_path_count: changedPaths.length },
  });
  if (!approved) {
    process.stderr.write("[mcpee] Post-change sync was not approved; generated knowledge and documentation may be stale. Run mcpee sync after reviewing the changed files.\n");
    onValidation({ status: "blocked", reason: "Human approval for evidence and graph refresh was not granted." });
    return 1;
  }
  const result = (options.syncProject || syncProject)(root, { generateDocumentation: false });
  const specDrift = checkSpecDrift(root);
  if (specDrift.drifted) {
    process.stderr.write(`[mcpee] Approved/proposed specifications have source drift: ${specDrift.drifted} item(s). Review with mcpee specs drift; no specification was rewritten.\n`);
  }
  try {
    const embeddings = await refreshConfiguredEmbeddings(root);
    if (embeddings?.chunkCount !== undefined) {
      process.stdout.write(`[mcpee] Local embedding index refreshed after approved source sync: ${embeddings.chunkCount} chunk(s).\n`);
    } else if (embeddings?.warning) {
      process.stderr.write(`[mcpee] Local embedding index was not refreshed: ${embeddings.warning}\n`);
    }
  } catch (error) {
    process.stderr.write(`[mcpee] Local embedding index was not refreshed: ${error.message}\n`);
  }
  const tools = (options.discoverTools || discoverTools)(root);
  const codeGraph = (options.updateCodeGraph || updateCodeGraph)(root, {
    available: tools.tools.some((tool) => tool.id === "codegraph" && tool.available),
    required: true,
  });
  if (codeGraph.status !== "ready" || result.counts.failed > 0 || result.graphify?.status === "failed") {
    process.stderr.write(`[mcpee] Post-change sync incomplete: source failures=${result.counts.failed}; CodeGraph=${codeGraph.status}${codeGraph.error ? ` (${codeGraph.error})` : ""}; Graphify=${result.graphify?.status || "not-run"}${result.graphify?.error ? ` (${result.graphify.error})` : ""}. Run mcpee doctor for details.\n`);
    onValidation({ status: "blocked", reason: "Post-change source, Graphify, or required CodeGraph synchronization failed." });
    return 1;
  }
  const workflowSpec = `.mcpee/workflows/${workflowId}.json`;
  if (!fs.existsSync(path.join(root, workflowSpec))) {
    recordEvent(root, {
      event_name: "copilot.post_change_validation.required",
      attributes: { workflow_id: workflowId, status: "workflow-spec-missing", changed_path_count: changedPaths.length },
    });
    process.stderr.write(`[mcpee] Validation was not run: create ${workflowSpec} and run "mcpee workflow run --spec ${workflowSpec}". Generated documentation was not refreshed; run mcpee sync after validation passes.\n`);
    onValidation({ status: "blocked", reason: `Routed workflow specification is missing: ${workflowSpec}` });
    return 1;
  }
  const validation = await (options.runWorkflow || runWorkflow)(root, workflowSpec, {
    approveStep: options.approveStep || approveStep,
    beforeRun: options.beforeRun || printImpactPreflight,
    expectedWorkflowId: workflowId,
  });
  if (validation.status !== "passed") {
    recordEvent(root, {
      event_name: "copilot.post_change_validation.completed",
      attributes: {
        workflow_id: workflowId,
        evaluation_id: validation.id,
        status: validation.status,
        changed_path_count: changedPaths.length,
        documentation_refreshed: false,
      },
    });
    process.stderr.write(`[mcpee] Post-change validation ${validation.status}; generated documentation was not refreshed. Review ${validation.file} and rerun the workflow after resolving failures.\n`);
    onValidation({
      status: "failed",
      evaluation_id: validation.id,
      report: validation.file,
      reason: `Routed workflow validation ended with status '${validation.status}'.`,
    });
    return 1;
  }
  let documentation;
  try {
    documentation = (options.generateProjectDocumentation || generateProjectDocumentation)(root);
  } catch (error) {
    onValidation({
      status: "passed",
      evaluation_id: validation.id,
      report: validation.file,
      learning: { proposal_ids: (validation.learning_proposals || []).map((proposal) => proposal.proposal_id) },
      documentation: { refreshed: false, error: error.message },
    });
    recordEvent(root, {
      event_name: "copilot.post_change_documentation.failed",
      attributes: { workflow_id: workflowId, evaluation_id: validation.id, error: error.message },
    });
    process.stderr.write(`[mcpee] Validation passed, but generated documentation refresh failed: ${error.message}\n`);
    return 1;
  }
  const postChangeResult = {
    status: "passed",
    evaluation_id: validation.id,
    report: validation.file,
    learning: { proposal_ids: (validation.learning_proposals || []).map((proposal) => proposal.proposal_id) },
    documentation: { refreshed: true, files: documentation.files },
  };
  onValidation(postChangeResult);
  recordEvent(root, {
    event_name: "copilot.post_change_validation.completed",
    attributes: {
      workflow_id: workflowId,
      evaluation_id: validation.id,
      status: "passed",
      changed_path_count: changedPaths.length,
      documentation_written: documentation.counts.written,
      documentation_preserved: documentation.counts.preserved,
      documentation_refreshed: true,
    },
  });
  recordEvent(root, {
    event_name: "copilot.post_change_sync.completed",
    attributes: {
      changed_path_count: changedPaths.length,
      discovered_sources: result.discoveredFiles,
      source_failures: result.counts.failed,
      documentation_written: documentation.counts.written,
      documentation_preserved: documentation.counts.preserved,
      codegraph_status: codeGraph.status,
    },
  });
  process.stdout.write(`[mcpee] Post-change validation passed (${validation.id}); generated documentation written=${documentation.counts.written}, preserved=${documentation.counts.preserved}; CodeGraph=${codeGraph.operation}.\n`);
  return 0;
}

async function runCopilotCommand(root, args) {
  const task = optionValue(args, "--task");
  if (!task || !fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    return runCopilotCommandInternal(root, args);
  }
  const traceId = process.env.MCPEE_TRACE_ID || crypto.randomUUID();
  const inheritedParentId = process.env.MCPEE_PARENT_EVENT_ID || null;
  return withTelemetryContext({ trace_id: traceId, parent_id: inheritedParentId }, async () => {
    const startedAt = Date.now();
    const started = recordEvent(root, {
      source: "mcpee-cli",
      event_name: "mcpee.cli.run.started",
      attributes: {
        model_requested: optionValue(args, "--model", "auto"),
        context_mode: args.includes("--ground-context") ? "grounded-local-evidence"
          : args.includes("--pack-context") ? "repomix-selected-sources" : "routing-summary",
      },
      payload: { task },
    });
    return withTelemetryContext({ trace_id: traceId, parent_id: started.event_id }, async () => {
      try {
        const exitCode = await runCopilotCommandInternal(root, args);
        recordEvent(root, {
          source: "mcpee-cli",
          event_name: "mcpee.cli.run.completed",
          attributes: {
            outcome: exitCode === 0 ? "success" : "failure",
            exit_code: exitCode,
            duration_ms: Math.max(0, Date.now() - startedAt),
          },
        });
        return exitCode;
      } catch (error) {
        recordEvent(root, {
          source: "mcpee-cli",
          event_name: "mcpee.cli.run.completed",
          attributes: {
            outcome: "failure",
            duration_ms: Math.max(0, Date.now() - startedAt),
            error: error.message,
          },
        });
        throw error;
      }
    });
  });
}

async function runCopilotCommandInternal(root, args) {
  if (!fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    process.stderr.write("[mcpee] Project is not initialized. Run mcpee init first.\n");
    return 1;
  }
  const task = optionValue(args, "--task");
  if (!task) {
    process.stderr.write("[mcpee] Usage: mcpee run --task <request> [--model <id>] [--pack-context | --ground-context] [--context-tokens <128..32000>]\n");
    return 2;
  }
  const model = optionValue(args, "--model", "auto");
  let contextMode;
  let conversationContext;
  try {
    contextMode = runContextMode(args);
    conversationContext = readChatContext(args);
  } catch (error) {
    process.stderr.write(`[mcpee] ${error.message}\n`);
    return 2;
  }
  const { packContext, groundContext } = contextMode;
  const plan = routeTask(root, task);
  printImpactPreflight(plan.impact_preflight);
  let contextPackage = null;
  if (groundContext) {
    const maxTokens = Number.parseInt(optionValue(args, "--context-tokens", "4000"), 10);
    if (!Number.isInteger(maxTokens) || maxTokens < 128 || maxTokens > 32_000) {
      process.stderr.write("[mcpee] --context-tokens must be an integer between 128 and 32000.\n");
      return 2;
    }
    try {
      const grounded = await searchGroundedContext(root, task, {
        maxTokens,
        allowLexicalFallback: true,
      });
      contextPackage = {
        kind: "grounded",
        content: grounded.context,
        files: [...new Set(grounded.evidence.map((item) => item.source_path))],
        byteLength: Buffer.byteLength(grounded.context, "utf8"),
        estimatedTokens: grounded.estimated_tokens,
        retrieval: grounded.retrieval,
        fallbackReason: grounded.fallback_reason || null,
      };
      if (contextPackage.retrieval.includes("lexical-fallback")) {
        const reason = contextPackage.fallbackReason?.replace(/[.!?]+$/, "");
        process.stderr.write(`[mcpee] Grounded context uses local lexical fallback${reason ? `: ${reason}` : " because some sources have no current vectors"}. Run \`mcpee knowledge embeddings setup\` to enable local semantic retrieval.\n`);
      }
    } catch (error) {
      process.stderr.write(`[mcpee] Could not prepare grounded context: ${error.message}\n`);
      return 1;
    }
  } else if (packContext) {
    recordEvent(root, { event_name: "context.layer.completed",
      attributes: { layer: "knowledge.grounding", consulted: false, outcome: "skipped", reason: "Repomix packaging selected instead of grounded retrieval." } });
    try {
      contextPackage = packRelevantContext(root, plan);
    } catch (error) {
      process.stderr.write(`[mcpee] Could not prepare Repomix context: ${error.message}\n`);
      return 1;
    }
    if (contextPackage?.kind === "grounded" &&
        contextPackage.retrieval.includes("lexical-fallback")) {
      const reason = contextPackage.fallbackReason?.replace(/[.!?]+$/, "");
      process.stderr.write(`[mcpee] Grounded context includes lexical fallback${reason ? `: ${reason}` : " for sources without current vectors"}. Run \`mcpee knowledge embeddings setup\` for semantic retrieval when appropriate.\n`);
    }
  } else {
    recordEvent(root, { event_name: "context.layer.completed",
      attributes: { layer: "knowledge.grounding", consulted: false, outcome: "skipped", reason: "Additional grounded retrieval disabled for this execution; routing evidence remains in the prompt." } });
  }
  try {
    contextPackage = prepareApprovedSpecContext(root, plan, contextPackage);
  } catch (error) {
    process.stderr.write(`[mcpee] Could not prepare approved specification context: ${error.message}\n`);
    return 1;
  }
  if (!await approveCopilotDataTransfer(root, plan, contextPackage, conversationContext)) {
    process.stderr.write("[mcpee] Copilot data transfer was not approved.\n");
    return 1;
  }

  process.stdout.write(`[mcpee] Starting Copilot session (${model}) with workflow=${plan.workflow.id}, agent=${plan.agent.id}.\n`);
  let result;
  const cancellation = new AbortController();
  const onHostMessage = (message) => {
    if (message?.type === "mcpee.cancel") {
      cancellation.abort(new Error("MCPEE execution was cancelled by the host."));
    }
  };
  if (process.connected) process.on("message", onHostMessage);
  try {
    delete process.env.MCPEE_APPROVAL_BROKER_URL;
    delete process.env.MCPEE_APPROVAL_BROKER_TOKEN;
    delete process.env.MCPEE_CHAT_RESULT_MARKER;
    result = await runCopilotTask(root, task, plan, {
      approved: true,
      signal: cancellation.signal,
      contextPackage,
      impactPreflight: plan.impact_preflight,
      model,
      interactive: (process.stdin.isTTY && process.stdout.isTTY) ||
        Boolean(INITIAL_APPROVAL_BROKER.url && INITIAL_APPROVAL_BROKER.token),
      conversationContext,
      approvePermission: approveCopilotPermission,
      approveTool: (input, reason) => approveCopilotTool(input, reason, plan.impact_preflight),
    });
  } catch (error) {
    const events = readEvents(root);
    const taskHash = crypto.createHash("sha256").update(task).digest("hex");
    const executionEvent = events.findLast((event) =>
      event.event_name === "copilot.execution.completed" &&
      event.attributes?.task_sha256 === taskHash);
    const failedExecution = {
      sessionId: typeof executionEvent?.session_id === "string" ? executionEvent.session_id : null,
      changedPaths: Array.isArray(executionEvent?.attributes?.changed_paths)
        ? executionEvent.attributes.changed_paths
        : [],
      outcome: "failure",
    };
    let postChange = null;
    if (failedExecution.changedPaths.length) {
      process.stderr.write(`[mcpee] Copilot failed after changing ${failedExecution.changedPaths.length} project file(s); attempting approved post-change synchronization.\n`);
      try {
        await synchronizeAfterCopilotChanges(root, failedExecution.changedPaths, plan.workflow.id, {
          onValidation: (validation) => {
            postChange = {
              validation,
              documentation: validation.documentation || null,
              learning: validation.learning || null,
            };
          },
        });
      } catch (syncError) {
        process.stderr.write(`[mcpee] Post-change synchronization failed: ${syncError.message}\n`);
        postChange = { validation: { status: "blocked", reason: syncError.message } };
      }
    }
    const report = writeRunReport(root, {
      task,
      plan,
      execution: failedExecution,
      postChange,
      events: readEvents(root),
    });
    printRunReport(report);
    throw error;
  } finally {
    process.removeListener("message", onHostMessage);
  }
  if (!args.includes("--chat-json")) process.stdout.write(`${result.content}\n`);
  let postChange = null;
  let exitCode = 0;
  if (result.changedPaths.length) {
    process.stdout.write(`[mcpee] Copilot changed ${result.changedPaths.length} project file(s): ${result.changedPaths.join(", ")}\n`);
    try {
      exitCode = await synchronizeAfterCopilotChanges(root, result.changedPaths, plan.workflow.id, {
        onValidation: (validation) => { postChange = { validation, documentation: validation.documentation || null, learning: validation.learning || null }; },
      });
    } catch (error) {
      process.stderr.write(`[mcpee] Post-change synchronization failed: ${error.message}\n`);
      postChange = { validation: { status: "blocked", reason: error.message } };
      exitCode = 1;
    }
  }
  const report = writeRunReport(root, {
    task,
    plan,
    execution: result,
    postChange,
    events: readEvents(root),
  });
  printRunReport(report);
  if (args.includes("--chat-json")) {
    const marker = CHAT_RESULT_MARKER;
    if (typeof marker !== "string" || !/^__MCPEE_CHAT_RESULT_[a-f0-9]{32}__$/.test(marker)) {
      process.stderr.write("[mcpee] --chat-json requires a valid chat response marker.\n");
      return 1;
    }
    process.stdout.write(`${marker}${JSON.stringify({ content: result.content })}\n`);
  }
  return exitCode;
}

function printRunReport(report) {
  process.stdout.write(`[mcpee] Workflow lifecycle report: ${report.status} (${report.file})\n`);
  for (const stage of report.stages) {
    process.stdout.write(`  ${stage.status}: ${stage.id}${stage.reason ? ` — ${stage.reason}` : ""}\n`);
  }
}

function runObserve(root, args) {
  if (args.includes("--report") && (!args.includes("--html") || !optionValue(args, "--report"))) {
    throw new Error("--report requires a JSON path and --html.");
  }
  const events = readEvents(root);
  const eventCounts = {};
  const toolCounts = {};
  const sessions = new Set();
  const outcomes = {
    copilot: { completed: 0, succeeded: 0, failed: 0, duration_ms_total: 0 },
    routing: { plans: 0, fallbacks: 0, impact_preflight_unready: 0, memory_candidates: 0, knowledge_candidates: 0, knowledge_graph_candidates: 0, unified_graph_candidates: 0, codegraph_candidates: 0, tools_available: 0 },
    context: { executions: 0, repomix_packaged: 0, grounded_packaged: 0, bytes_total: 0, estimated_tokens_total: 0, sources_total: 0 },
    tool_authorizations: { total: 0, allowed: 0, denied: 0, human_approved: 0 },
    tool_results: { total: 0, succeeded: 0, failed: 0 },
    evaluations: { total: 0, passed: 0, failed: 0, checks: 0, passed_checks: 0, failed_checks: 0, blocked_checks: 0, duration_ms_total: 0 },
    workflows: { total: 0, passed: 0, failed: 0, checks: 0, passed_checks: 0, failed_checks: 0, blocked_checks: 0, duration_ms_total: 0 },
    model_usage: {
      calls: 0,
      input_tokens_total: null,
      input_token_events: 0,
      output_tokens_total: null,
      output_token_events: 0,
      cost_total: null,
      cost_events: 0,
      models: {},
    },
    tools: { duration_ms_total: 0, timed_calls: 0 },
    local_tools: { total: 0, succeeded: 0, failed: 0, timed_out: 0, duration_ms_total: 0, timed_calls: 0 },
  };
  for (const event of events) {
    eventCounts[event.event_name] = (eventCounts[event.event_name] || 0) + 1;
    if (event.tool_name) toolCounts[event.tool_name] = (toolCounts[event.tool_name] || 0) + 1;
    if (event.session_id) sessions.add(event.session_id);
    const attributes = event.attributes || {};
    if (event.event_name === "routing.plan.created") {
      outcomes.routing.plans += 1;
      if (attributes.fallback === true) outcomes.routing.fallbacks += 1;
      if (attributes.impact_preflight_status && attributes.impact_preflight_status !== "ready") {
        outcomes.routing.impact_preflight_unready += 1;
      }
      for (const key of ["memory_candidates", "knowledge_candidates", "knowledge_graph_candidates", "unified_graph_candidates", "codegraph_candidates", "available_tools"]) {
        const target = key === "available_tools" ? "tools_available" : key;
        if (Number.isInteger(attributes[key]) && attributes[key] >= 0) outcomes.routing[target] += attributes[key];
      }
    } else if (event.event_name === "copilot.execution.started") {
      outcomes.context.executions += 1;
      if (attributes.context_mode === "repomix-selected-sources") outcomes.context.repomix_packaged += 1;
      if (attributes.context_mode === "grounded-local-evidence") outcomes.context.grounded_packaged += 1;
      if (Number.isInteger(attributes.context_bytes) && attributes.context_bytes >= 0) {
        outcomes.context.bytes_total += attributes.context_bytes;
      }
      if (Number.isInteger(attributes.context_source_count) && attributes.context_source_count >= 0) {
        outcomes.context.sources_total += attributes.context_source_count;
      }
      if (Number.isInteger(attributes.context_estimated_tokens) && attributes.context_estimated_tokens >= 0) {
        outcomes.context.estimated_tokens_total += attributes.context_estimated_tokens;
      }
    } else if (event.event_name === "copilot.execution.completed") {
      outcomes.copilot.completed += 1;
      if (attributes.outcome === "success") outcomes.copilot.succeeded += 1;
      if (attributes.outcome === "failure") outcomes.copilot.failed += 1;
      if (Number.isFinite(attributes.duration_ms) && attributes.duration_ms >= 0) {
        outcomes.copilot.duration_ms_total += attributes.duration_ms;
      }
    } else if (event.event_name === "copilot.tool.authorization") {
      outcomes.tool_authorizations.total += 1;
      if (attributes.decision === "allow") outcomes.tool_authorizations.allowed += 1;
      if (attributes.decision === "deny") outcomes.tool_authorizations.denied += 1;
      if (attributes.approval === "human-approved-once") outcomes.tool_authorizations.human_approved += 1;
    } else if (event.event_name === "copilot.tool.completed") {
      outcomes.tool_results.total += 1;
      if (attributes.result === "success") outcomes.tool_results.succeeded += 1;
      if (attributes.result === "failure") outcomes.tool_results.failed += 1;
    } else if (event.event_name === "copilot.sdk.assistant.usage") {
      outcomes.model_usage.calls += 1;
      if (Number.isFinite(attributes.input_tokens) && attributes.input_tokens >= 0) {
        outcomes.model_usage.input_tokens_total =
          (outcomes.model_usage.input_tokens_total || 0) + attributes.input_tokens;
        outcomes.model_usage.input_token_events += 1;
      }
      if (Number.isFinite(attributes.output_tokens) && attributes.output_tokens >= 0) {
        outcomes.model_usage.output_tokens_total =
          (outcomes.model_usage.output_tokens_total || 0) + attributes.output_tokens;
        outcomes.model_usage.output_token_events += 1;
      }
      if (Number.isFinite(attributes.cost) && attributes.cost >= 0) {
        outcomes.model_usage.cost_total = (outcomes.model_usage.cost_total || 0) + attributes.cost;
        outcomes.model_usage.cost_events += 1;
      }
      if (typeof attributes.model === "string") {
        outcomes.model_usage.models[attributes.model] =
          (outcomes.model_usage.models[attributes.model] || 0) + 1;
      }
    } else if (event.event_name === "tool.invocation.completed") {
      outcomes.local_tools.total += 1;
      if (attributes.exit_code === 0 && !attributes.failed_to_start) outcomes.local_tools.succeeded += 1;
      else outcomes.local_tools.failed += 1;
      if (attributes.timed_out === true) outcomes.local_tools.timed_out += 1;
      if (Number.isFinite(attributes.duration_ms) && attributes.duration_ms >= 0) {
        outcomes.local_tools.duration_ms_total += attributes.duration_ms;
        outcomes.local_tools.timed_calls += 1;
      }
    } else if (event.event_name === "copilot.sdk.tool.execution_complete") {
      if (Number.isFinite(attributes.duration_ms) && attributes.duration_ms >= 0) {
        outcomes.tools.duration_ms_total += attributes.duration_ms;
        outcomes.tools.timed_calls += 1;
      }
    } else if (event.event_name === "evaluation.completed" || event.event_name === "workflow.completed") {
      const group = event.event_name === "workflow.completed" ? outcomes.workflows : outcomes.evaluations;
      group.total += 1;
      if (attributes.status === "passed") group.passed += 1;
      if (attributes.status === "failed") group.failed += 1;
      for (const key of ["check_count", "passed_checks", "failed_checks", "blocked_checks"]) {
        const target = key === "check_count" ? "checks" : key;
        if (Number.isInteger(attributes[key]) && attributes[key] >= 0) group[target] += attributes[key];
      }
      if (Number.isFinite(attributes.duration_ms) && attributes.duration_ms >= 0) {
        group.duration_ms_total += attributes.duration_ms;
      }
    }
  }
  for (const group of [outcomes.copilot, outcomes.evaluations, outcomes.workflows]) {
    group.duration_ms_average = group.completed || group.total
      ? Math.round(group.duration_ms_total / (group.completed || group.total))
      : null;
  }
  outcomes.tools.duration_ms_average = outcomes.tools.timed_calls
    ? Math.round(outcomes.tools.duration_ms_total / outcomes.tools.timed_calls)
    : null;
  outcomes.local_tools.duration_ms_average = outcomes.local_tools.timed_calls
    ? Math.round(outcomes.local_tools.duration_ms_total / outcomes.local_tools.timed_calls)
    : null;
  const report = {
    generated_at: new Date().toISOString(),
    retention_days: TELEMETRY_RETENTION_DAYS,
    event_count: events.length,
    session_count: sessions.size,
    event_counts: eventCounts,
    tool_counts: toolCounts,
    outcomes,
    telemetry_file: TELEMETRY_FILE,
  };
  const exportPath = optionValue(args, "--export");
  if (args.includes("--html")) {
    const htmlPath = optionValue(args, "--html");
    if (!htmlPath || !htmlPath.endsWith(".html")) throw new Error("--html requires a project-relative .html path.");
    const destination = writeLocalReport(root, htmlPath,
      renderObservationHtml(root, report, events, optionValue(args, "--report") || null));
    process.stderr.write(`[mcpee] Human-readable observation report: ${destination}\n`);
  }
  if (args.includes("--export")) {
    if (!exportPath) throw new Error("--export requires a project-relative JSON path.");
    const destination = writeLocalTelemetryExport(root, exportPath, report);
    process.stderr.write(`[mcpee] Exported local observation report to ${path.relative(root, destination).replace(/\\/g, "/")}.\n`);
  }
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Locally observed events: ${report.event_count}\nSessions: ${report.session_count}\n`);
    process.stdout.write(`Copilot executions: ${outcomes.copilot.succeeded} succeeded, ${outcomes.copilot.failed} failed\n`);
    process.stdout.write(`Tool authorizations: ${outcomes.tool_authorizations.allowed} allowed, ${outcomes.tool_authorizations.denied} denied; human-approved ${outcomes.tool_authorizations.human_approved}\n`);
    process.stdout.write(`Validation: ${outcomes.evaluations.passed} evaluations and ${outcomes.workflows.passed} workflows passed\n`);
    if (outcomes.model_usage.calls) {
      process.stdout.write(`Actual model usage: ${outcomes.model_usage.calls} SDK call(s), input=${outcomes.model_usage.input_tokens_total ?? "unavailable"} cumulative tokens, output=${outcomes.model_usage.output_tokens_total ?? "unavailable"} tokens, SDK cost sum=${outcomes.model_usage.cost_total ?? "unavailable"} (documented premium-request multipliers; billed spend unavailable)\n`);
    } else {
      process.stdout.write("Actual model usage: unavailable (no assistant.usage events)\n");
    }
    process.stdout.write(`Timed tool executions: ${outcomes.tools.timed_calls}, average=${outcomes.tools.duration_ms_average ?? "unavailable"} ms\n`);
    for (const [name, count] of Object.entries(eventCounts)) process.stdout.write(`  ${name}: ${count}\n`);
  }
  const reportPath = path.join(root, ".mcpee/observability/runtime/summary.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return 0;
}

function runTelemetry(root, args) {
  if (args[0] !== "validate") {
    process.stderr.write("[mcpee] Usage: mcpee telemetry validate [--json]\n");
    return 2;
  }
  const report = evaluateTelemetryIntegrity(root);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Telemetry integrity: ${report.status} (${report.event_count} recorded event(s))\n`);
    for (const check of report.checks) {
      process.stdout.write(`  ${check.id}: ${check.status}\n`);
    }
    for (const finding of report.findings) {
      process.stdout.write(`  line ${finding.line}: ${finding.check} — ${finding.message}\n`);
    }
  }
  return report.status === "passed" ? 0 : report.status === "no-evidence" ? 2 : 1;
}

function runCloud(root, args) {
  const [action] = args.filter((argument) => !argument.startsWith("--"));
  if (action !== "inventory") {
    process.stderr.write("[mcpee] Usage: mcpee cloud inventory --provider azure|aws [--json]\n");
    return 2;
  }
  const provider = optionValue(args, "--provider");
  if (!["azure", "aws"].includes(provider)) {
    process.stderr.write("[mcpee] --provider must be azure or aws.\n");
    return 2;
  }
  const executable = findExecutable(provider === "azure" ? "az" : "aws");
  if (!executable) {
    process.stderr.write(`[mcpee] ${provider === "azure" ? "Azure CLI (az)" : "AWS CLI (aws)"} is not installed or is not available on PATH. MCPEE does not install CLIs or credentials.\n`);
    return 1;
  }
  const cliArgs = provider === "azure"
    ? ["resource", "list", "--query", "[].{type:type,location:location}", "--output", "json", "--only-show-errors"]
    : ["resourcegroupstaggingapi", "get-resources", "--max-items", "1000", "--output", "json"];
  const result = spawnSync(executable, cliArgs, {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    shell: process.platform === "win32",
    env: {
      ...process.env,
      AZURE_CORE_COLLECT_TELEMETRY: "0",
      AWS_PAGER: "",
    },
  });
  if (result.error) {
    process.stderr.write(`[mcpee] ${provider} read-only inventory failed: ${result.error.message}\n`);
    return 1;
  }
  if (result.status !== 0) {
    const detail = redact(result.stderr || result.stdout || "").trim().slice(0, 1200);
    process.stderr.write(`[mcpee] ${provider} read-only inventory failed with exit code ${result.status}${detail ? `: ${detail}` : "."}\n`);
    return 1;
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    process.stderr.write(`[mcpee] ${provider} CLI returned invalid JSON: ${error.message}\n`);
    return 1;
  }
  const report = summarizeInventory(provider, payload);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Provider: ${report.provider}\nScope: ${report.scope}\nObserved: ${report.observed_at}\nResources: ${report.resource_count}${report.truncated ? " (first 1000 tagged resources; truncated)" : ""}\n`);
    const groups = report.resource_counts_by_type;
    for (const [type, count] of Object.entries(groups)) process.stdout.write(`  ${type}: ${count}\n`);
  }
  return 0;
}

async function run(args) {
  const [command, ...rest] = args;
  const root = projectRoot(rest);
  if (!TELEMETRY_COMMANDS.has(command) ||
      !fs.existsSync(path.join(root, ".mcpee/state/project.json"))) {
    return runCommand(args);
  }
  const traceId = process.env.MCPEE_TRACE_ID || crypto.randomUUID();
  const inheritedParentId = process.env.MCPEE_PARENT_EVENT_ID || null;
  const startedAt = Date.now();
  const started = withTelemetryContext(
    { trace_id: traceId, parent_id: inheritedParentId },
    () => recordEvent(root, {
      source: "mcpee-cli",
      event_name: "mcpee.cli.operation.started",
      attributes: { command },
      payload: { arguments: rest },
    }),
  );
  return withTelemetryContext({ trace_id: traceId, parent_id: started.event_id }, async () => {
    try {
      const exitCode = await runCommand(args);
      recordEvent(root, {
        source: "mcpee-cli",
        event_name: "mcpee.cli.operation.completed",
        attributes: {
          command,
          outcome: exitCode === 0 ? "success" : "failure",
          exit_code: exitCode,
          duration_ms: Math.max(0, Date.now() - startedAt),
        },
      });
      return exitCode;
    } catch (error) {
      recordEvent(root, {
        source: "mcpee-cli",
        event_name: "mcpee.cli.operation.completed",
        attributes: {
          command,
          outcome: "failure",
          duration_ms: Math.max(0, Date.now() - startedAt),
          error: error.message,
        },
      });
      throw error;
    }
  });
}

async function runCommand(args) {
  const [command = "help", ...rest] = args;
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  const root = projectRoot(rest);
  if (command === "init") {
    let embeddingProfile;
    let initialAgents;
    try {
      embeddingProfile = await chooseInitEmbeddingProfile(rest);
      initialAgents = await chooseInitAgents(root, rest);
    } catch (error) {
      process.stderr.write(`[mcpee] ${error.message}\n`);
      return 2;
    }
    const hookPath = path.join(root, ".mcpee/runtime/copilot-hook.cjs");
    const refreshRuntime = fs.existsSync(hookPath) &&
      !fs.readFileSync(hookPath, "utf8").includes("assessCopilotToolCall");
    const hookConfigPath = path.join(root, ".github/hooks/mcpee-observability.json");
    const refreshApprovalHook = fs.existsSync(hookConfigPath) && !approvalHookInstalled(root);
    if ((refreshRuntime || refreshApprovalHook) &&
        !await approveRuntimeRefresh({ refreshRuntime, refreshApprovalHook })) {
      process.stderr.write("[mcpee] Initialization stopped because the existing hook does not enforce human approval.\n");
      return 1;
    }
    const result = initializeProject(root, {
      refreshRuntime,
      refreshApprovalHook,
      ...(initialAgents ? { initialAgents } : {}),
    });
    const toolInstallation = await installCatalogTools(root, {
      skipInstall: rest.includes("--skip-tool-install"),
      approveInstall,
    });
    const toolReport = discoverTools(root);
    saveToolReport(root, toolReport);
    const codeGraph = updateCodeGraph(root, {
      available: toolReport.tools.some((tool) => tool.id === "codegraph" && tool.available),
      required: true,
    });
    const sync = syncProject(root);
    const brownfieldProposal = sync.specifications;
    const workflowSpecs = provisionWorkflowSpecs(root, toolReport, result.catalog.capabilities);
    let embeddingResult;
    try {
      embeddingResult = await refreshConfiguredEmbeddings(root);
    } catch (error) {
      embeddingResult = { warning: error.message };
    }
    if (embeddingProfile !== "none") {
      const embeddingExitCode = await runEmbeddingCommand(root, [
        "setup",
        "--profile",
        embeddingProfile,
      ]);
      if (embeddingExitCode !== 0) {
        process.stderr.write(`[mcpee] Optional ${embeddingProfile} embeddings were not enabled; the local lexical knowledge index remains available.\n`);
      }
    } else if (!rest.includes("--embeddings") && !process.stdin.isTTY) {
      process.stdout.write("[mcpee] Optional semantic embeddings skipped in non-interactive init; choose a profile with --embeddings light|bge-m3 or run mcpee knowledge embeddings setup later.\n");
    }
    const availableTools = toolReport.tools.filter((tool) => tool.available).length;
    process.stdout.write(`[mcpee] Initialized project at ${root}\n`);
    process.stdout.write(`Created ${result.created.length} paths; updated ${result.updated.length} MCPEE-managed files; preserved ${result.preserved.length} existing files.\n`);
    process.stdout.write(`[mcpee] Copilot catalog: ${result.catalog.counts.created} created, ${result.catalog.counts.updated} updated, ${result.catalog.counts.preserved} preserved.\n`);
    const technologies = result.catalog.capabilities.detected_technologies.map(({ id }) => id);
    process.stdout.write(`[mcpee] Detected stack: ${technologies.join(", ") || "no supported signals; general-purpose assets only"}.\n`);
    process.stdout.write(`[mcpee] Provisioned capabilities: ${result.catalog.capabilities.assets.agents.length} agents, ${result.catalog.capabilities.assets.skills.length} skills, ${result.catalog.capabilities.assets.workflows.length} workflows, ${result.catalog.capabilities.assets.technical_guidance.length} technical guides, ${result.catalog.capabilities.assets.templates.length} templates available.\n`);
    process.stdout.write(`[mcpee] Discovered ${availableTools}/${toolReport.tools.length} catalogued local tools.\n`);
    for (const installation of toolInstallation.results) {
      process.stdout.write(`[mcpee] Tool ${installation.id}: ${installation.status}${installation.version ? ` (${installation.version})` : ""}${installation.reason ? ` — ${installation.reason}` : ""}\n`);
    }
    if (toolInstallation.pythonRuntime) {
      process.stdout.write(`[mcpee] Project-local Python runtime: ${toolInstallation.pythonRuntime.version} via uv; system Python was not modified.\n`);
    }
    if (toolInstallation.latestLts) {
      process.stdout.write(`[mcpee] Node.js LTS check: current=${process.version}; latest=${toolInstallation.latestLts}.\n`);
    } else if (toolInstallation.nodeLtsError) {
      process.stderr.write(`[mcpee] Node.js LTS check failed: ${toolInstallation.nodeLtsError}\n`);
    }
    process.stdout.write(`[mcpee] Initial local sync: ${sync.discoveredFiles} source(s); processed=${sync.counts.processed}, requires-tool=${sync.counts["requires-tool"]}, failed=${sync.counts.failed}.\n`);
    if (brownfieldProposal.status === "created" || brownfieldProposal.status === "preserved") {
      process.stdout.write(`[mcpee] Brownfield proposals ${brownfieldProposal.status}: ${brownfieldProposal.domainCount} candidate domains; ${brownfieldProposal.proposals.length} documents; sources=${brownfieldProposal.sourceCount}. Start reading: ${brownfieldProposal.indexPath}. None are approved.\n`);
      const coverage = brownfieldProposal.coverage;
      process.stdout.write(`[mcpee] Automatic brownfield extraction: observations=${coverage.observations}, declared-tests=${coverage.declared_tests}, associated-assertions=${coverage.associated_assertions}; excluded-sources=${coverage.excluded_sources.length}, unsupported-implementation-files=${coverage.implementation_recognition.unsupported.length}. Coverage and gaps are recorded in ${brownfieldProposal.indexPath} and .mcpee/specs/latest.json. No extra discovery command is needed.\n`);
    } else {
      process.stdout.write("[mcpee] Brownfield specification discovery skipped: no eligible source evidence was indexed.\n");
    }
    if (workflowSpecs.status === "ready") {
      const checks = workflowSpecs.checks.map((check) => `${check.tool}:${check.id}`).join(", ");
      process.stdout.write(`[mcpee] Workflow validation: generated=${workflowSpecs.created}, preserved=${workflowSpecs.preserved}, checks=${checks}. Checks run only after explicit approval.\n`);
    } else {
      process.stderr.write(`[mcpee] Workflow validation specs were not generated: ${workflowSpecs.reason} Post-change documentation refresh will remain blocked until a matching workflow spec is configured.\n`);
    }
    if (embeddingResult?.chunkCount !== undefined) {
      process.stdout.write(`[mcpee] Local embedding index refreshed: ${embeddingResult.chunkCount} chunk(s).\n`);
    } else if (embeddingResult?.warning) {
      process.stderr.write(`[mcpee] Local embedding index was not refreshed: ${embeddingResult.warning}\n`);
    }
    process.stdout.write(`[mcpee] Unified evidence graph: nodes=${sync.unifiedGraph.node_count}, edges=${sync.unifiedGraph.edge_count}.\n`);
    if (sync.graphify.status === "ready") {
      process.stdout.write(`[mcpee] Graphify ${sync.graphify.operation}: nodes=${sync.graphify.node_count}, edges=${sync.graphify.edge_count}.\n`);
    } else if (sync.graphify.status === "failed") {
      process.stderr.write(`[mcpee] Graphify sync failed: ${sync.graphify.error}\n`);
    } else {
      process.stdout.write(`[mcpee] Graphify unavailable: ${sync.graphify.reason}\n`);
    }
    process.stdout.write(`[mcpee] Generated documentation: written=${sync.documentation.counts.written}, preserved=${sync.documentation.counts.preserved}.\n`);
    if (codeGraph.status === "ready") {
      process.stdout.write(`[mcpee] CodeGraph ${codeGraph.operation} completed: files=${codeGraph.summary.file_count ?? "unknown"} nodes=${codeGraph.summary.node_count ?? "unknown"} edges=${codeGraph.summary.edge_count ?? "unknown"}; MCP ${codeGraph.mcp.status} in ${codeGraph.mcp.file}.\n`);
    } else if (codeGraph.status === "unavailable") {
      process.stderr.write("[mcpee] CodeGraph is required but the project-local tool is not installed.\n");
    } else {
      process.stderr.write(`[mcpee] CodeGraph initialization failed: ${codeGraph.error}\n`);
    }
    const toolFailures = requiredToolInstallationFailures(
      toolInstallation.results,
      toolReport.tools,
    );
    if (workflowSpecs.status === "failed" ||
        sync.counts.failed > 0 || sync.graphify.status === "failed" ||
        toolFailures.length > 0 || codeGraph.status !== "ready") {
      process.stderr.write("[mcpee] Initialization completed with incomplete tool installation or source processing; review the messages above and rerun mcpee init after resolving them.\n");
      return 1;
    }
    return 0;
  }
  if (command === "trace") return runTrace(root, rest);
  if (command === "knowledge") return runKnowledge(root, rest);
  if (command === "impact") return runImpact(root, rest);
  if (command === "drift") return runDrift(root, rest);
  if (command === "specs") return runSpecs(root, rest);
  if (command === "tools") return runTools(root, rest);
  if (command === "cloud") return runCloud(root, rest);
  if (command === "telemetry") return runTelemetry(root, rest);
  if (command === "capabilities") return runCapabilities(root, rest);
  if (command === "assets") return runAssetAudit(root, rest);
  if (command === "coverage") return runCatalogCoverage(rest);
  if (command === "quality") return runQualityGates(root, rest);
  if (command === "skills") return runSkillHealth(root, rest);
  if (command === "plan") return runPlan(root, rest);
  if (command === "memory") return runMemory(root, rest);
  if (command === "evaluate") return await runEvaluation(root, rest);
  if (command === "workflow") return await runWorkflowCommand(root, rest);
  if (command === "learn") return runLearning(root, rest);
  if (command === "tasks") return runTasks(root, rest);
  if (command === "route") return runRoute(root, rest);
  if (command === "run") return await runCopilotCommand(root, rest);
  if (command === "explain") return runExplain(root, rest);
  if (command === "rebuild") return await runRebuild(root);
  if (command === "update") return await runUpdate(root);
  if (command === "clean") return await runClean(root);
  if (command === "observe") return runObserve(root, rest);
  if (command === "view") {
    if (!rest.includes("--html")) throw new Error("view requires --html <project-relative-html>.");
    return runObserve(root, rest);
  }
  if (command === "status") return runStatus(root);
  if (command === "doctor") return runDoctor(root);
  if (command === "sync") return runSync(root);
  process.stderr.write(`[mcpee] Unknown command: ${command}\n`);
  printHelp();
  return 2;
}

module.exports = {
  provisionWorkflowSpecs,
  readChatContext,
  requestApprovalFromHost,
  requiredToolInstallationFailures,
  run,
  runContextMode,
  synchronizeAfterCopilotChanges,
};
