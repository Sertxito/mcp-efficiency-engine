#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { runHostInstallFromCli } = require("./install-host");

const repoRoot = path.resolve(__dirname, "..");
const commandMap = {
  bootstrap: "scripts/bootstrap-portable.ps1",
  validate: "scripts/setup/validate-context.ps1",
  hi: "scripts/ops/hi.ps1",
  bye: "scripts/ops/bye.ps1",
  intake: "scripts/intake/run-repo-intake.ps1",
  "observe-on": "scripts/ops/install-terminal-telemetry-hook.ps1",
  "observe-off": "scripts/ops/uninstall-terminal-telemetry-hook.ps1",
};

function resolveSessionId() {
  const explicitSessionId = (process.env.MCP_SESSION_ID || "").trim();
  if (explicitSessionId) {
    return explicitSessionId;
  }

  const sessionLogHint = (process.env.VSCODE_TARGET_SESSION_LOG || "").trim();
  if (sessionLogHint) {
    const match = sessionLogHint.match(/[0-9a-fA-F-]{36}/);
    if (match && match[0]) {
      return match[0];
    }
  }

  return "mcpee-cli";
}

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

function resolveExecutionRoot(scriptRelativePath) {
  const configuredTarget = process.env.MCPEE_TARGET_DIR ? path.resolve(process.env.MCPEE_TARGET_DIR) : "";
  const cwdRoot = process.cwd();

  if (configuredTarget && fs.existsSync(path.join(configuredTarget, scriptRelativePath))) {
    return configuredTarget;
  }

  if (cwdRoot !== repoRoot && fs.existsSync(path.join(cwdRoot, scriptRelativePath))) {
    return cwdRoot;
  }

  return repoRoot;
}

function printHelp() {
  process.stdout.write(
    [
      "mcpee <comando> [args]",
      "",
      "Comandos:",
      "  install    Scaffold del engine en el proyecto actual y ejecuta bootstrap.",
      "  bootstrap  Ejecuta el bootstrap portable completo.",
      "  validate   Ejecuta la validacion minima del contexto.",
      "  hi         Ejecuta el preflight diario.",
      "  bye        Ejecuta el cierre diario.",
      "  intake     Ejecuta el repo intake.",
      "  observe-on Activa telemetria global del terminal (hook PowerShell).",
      "  observe-off Desactiva telemetria global del terminal.",
      "",
      "Ejemplos:",
      "  npx mcp-efficiency-engine bootstrap",
      "  mcpee validate -PortableMode",
    ].join("\n") + "\n",
  );
}

function resolveInvocationCandidates() {
  if (process.platform === "win32") {
    return ["pwsh", "powershell"];
  }

  return ["pwsh"];
}

function runPowerShellScript(scriptRelativePath, forwardedArgs) {
  const executionRoot = resolveExecutionRoot(scriptRelativePath);
  const scriptPath = path.join(executionRoot, scriptRelativePath);
  const tracerScriptPath = path.join(repoRoot, "scripts", "ops", "trace-command.py");
  const sessionId = resolveSessionId();

  runCopilotUsageIngest(repoRoot);

  if (!fs.existsSync(scriptPath)) {
    process.stderr.write(`Script no encontrado: ${scriptRelativePath}\n`);
    return 1;
  }

  const shellCandidates = resolveInvocationCandidates();
  for (const shellCommand of shellCandidates) {
    if (fs.existsSync(tracerScriptPath)) {
      const operation = `mcpee.${path.basename(scriptRelativePath, path.extname(scriptRelativePath))}`;
      for (const [pythonCommand, pythonPrefixArgs] of resolvePythonCandidates()) {
        const tracedResult = spawnSync(
          pythonCommand,
          [
            ...pythonPrefixArgs,
            tracerScriptPath,
            "--operation",
            operation,
            "--session-id",
            sessionId,
            "--cwd",
            executionRoot,
            "--",
            shellCommand,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            ...forwardedArgs,
          ],
          {
            cwd: repoRoot,
            stdio: "inherit",
          },
        );

        if (tracedResult.error && tracedResult.error.code === "ENOENT") {
          continue;
        }

        if (tracedResult.error) {
          process.stderr.write(`${tracedResult.error.message}\n`);
          return 1;
        }

        return tracedResult.status ?? 0;
      }
    }

    const result = spawnSync(
      shellCommand,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...forwardedArgs],
      {
        cwd: executionRoot,
        stdio: "inherit",
      },
    );

    if (result.error && result.error.code === "ENOENT") {
      continue;
    }

    if (result.error) {
      process.stderr.write(`${result.error.message}\n`);
      return 1;
    }

    return result.status ?? 0;
  }

  process.stderr.write("PowerShell no esta disponible. Instala pwsh para usar este CLI.\n");
  return 1;
}

const argv = process.argv.slice(2);
const firstArg = argv[0] || "bootstrap";

if (["-h", "--help", "help"].includes(firstArg)) {
  printHelp();
  process.exit(0);
}

if (firstArg === "install") {
  process.exit(runHostInstallFromCli(argv.slice(1)));
}

const command = commandMap[firstArg] ? firstArg : "bootstrap";
const forwardedArgs = command === firstArg ? argv.slice(1) : argv;

if (!commandMap[command]) {
  process.stderr.write(`Comando no soportado: ${firstArg}\n`);
  printHelp();
  process.exit(1);
}

process.exit(runPowerShellScript(commandMap[command], forwardedArgs));