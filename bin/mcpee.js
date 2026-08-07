#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { runHostInstallFromCli } = require("./install-host");
const { runInit } = require("./core-v2/commands/init");
const { runDoctor } = require("./core-v2/commands/doctor");
const { runHealth } = require("./core-v2/commands/health");
const { runChat } = require("./core-v2/commands/chat");
const { runTelemetryReport } = require("./core-v2/commands/telemetry-report");
const { runKnowledgeBuild } = require("./core-v2/commands/knowledge-build");
const { runSkillOpt } = require("./core-v2/commands/skillopt");
const { runArtifactReport } = require("./core-v2/commands/artifact-report");

const repoRoot = path.resolve(__dirname, "..");

const internalCommandMap = {
  init: runInit,
  doctor: runDoctor,
  health: runHealth,
  chat: runChat,
  "telemetry-report": runTelemetryReport,
  "knowledge-build": runKnowledgeBuild,
  "skillopt-sleep": runSkillOpt,
  "artifact-report": runArtifactReport,
};

function resolvePythonCandidates() {
  if (process.platform === "win32") {
    return [
      ["py", ["-3"]],
      ["python", []],
      ["python3", []],
    ];
  }

  return [
    ["python3", []],
    ["python", []],
  ];
}

function runCopilotUsageIngest(repoRootPath) {
  const sessionLogHint = (process.env.VSCODE_TARGET_SESSION_LOG || "").trim();
  if (!sessionLogHint) {
    return;
  }

  const ingestScriptPath = path.join(repoRootPath, "scripts", "learning", "ingest-copilot-session-usage.py");
  if (!fs.existsSync(ingestScriptPath)) {
    return;
  }

  for (const [pythonCommand, pythonPrefixArgs] of resolvePythonCandidates()) {
    const ingestResult = spawnSync(
      pythonCommand,
      [
        ...pythonPrefixArgs,
        ingestScriptPath,
        "--session-log",
        sessionLogHint,
      ],
      {
        cwd: repoRootPath,
        stdio: "ignore",
      },
    );

    if (ingestResult.error && ingestResult.error.code === "ENOENT") {
      continue;
    }

    // La ingesta es best-effort: si falla no bloquea el comando principal.
    return;
  }
}

function printHelp() {
  process.stdout.write(
    [
      "mcpee <comando> [args]",
      "",
      "Comandos:",
      "  init       Inicializa .mcpee/ para el proyecto actual (v2).",
      "  doctor     Diagnostico v2: core, boosts, providers y optimizers.",
      "  health     Resumen de salud v2 en JSON.",
      "  chat       Ejecuta ruta capability-centric (usa --capability).",
      "  telemetry-report Reporte agregado de ejecuciones v2.",
      "  knowledge-build Construye indice de conocimiento v2.",
      "  skillopt-sleep Genera drafts de skills desde telemetria (bridge al upstream oficial).",
      "  artifact-report Reporte del artifact registry v2.",
      "  install    Scaffold del engine en el proyecto actual y ejecuta bootstrap.",
      "",
      "Ejemplos:",
      "  npx mcp-efficiency-engine init",
      "  npx mcp-efficiency-engine doctor",
      "  npx mcp-efficiency-engine chat --capability backend.architecture.review --message \"analiza arquitectura\"",
      "  npx mcp-efficiency-engine knowledge-build",
      "  npx mcp-efficiency-engine skillopt-sleep",
      "  npx mcp-efficiency-engine artifact-report",
      "",
      "Nota: comandos legacy (bootstrap/validate/hi/bye/intake/observe-*)",
      "ya no forman parte de la superficie publica del CLI.",
    ].join("\n") + "\n",
  );
}

function runInternalCommand(commandName, args) {
  const executionRoot = process.cwd();
  const handler = internalCommandMap[commandName];
  if (!handler) {
    process.stderr.write(`Comando interno no soportado: ${commandName}\n`);
    return 1;
  }

  return handler(executionRoot, args);
}

const argv = process.argv.slice(2);
const firstArg = argv[0] || "doctor";

if (["-h", "--help", "help"].includes(firstArg)) {
  printHelp();
  process.exit(0);
}

runCopilotUsageIngest(repoRoot);

if (firstArg === "install") {
  process.exit(runHostInstallFromCli(argv.slice(1)));
}

if (internalCommandMap[firstArg]) {
  process.exit(runInternalCommand(firstArg, argv.slice(1)));
}

process.stderr.write(`Comando no soportado: ${firstArg}\n`);
printHelp();
process.exit(1);
