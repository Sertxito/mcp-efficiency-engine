#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const scaffoldEntries = [
  ".githooks",
  ".github",
  ".vscode",
  "autodocs/README.md",
  "autodocs/schema",
  "autolearning",
  "context/repomix/repomix.config.json",
  "memory",
  "observability",
  "optimization",
  "orchestrator",
  "policies",
  "repo-intake",
  "repo-registry/repos.schema.json",
  "repo-registry/repos.template.json",
  "scripts",
  "specs",
  "templates",
  "tooling",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "FINAL_USAGE_GUIDE.md",
  "README.md",
  "README_WIKI.md",
  "LICENSE",
  "requirements.txt",
];

const runtimeDirs = [
  ".cache/github-repos",
  "autodocs/generated",
  "autodocs/site",
  "context/graphify-out",
  "context/repomix",
  "observability/logs/session",
  "repo-registry",
  "repo-intake/generated/reports",
];

function parseArgs(argv) {
  const options = {
    postinstall: false,
    force: false,
    skipBootstrap: false,
    nonInteractive: false,
    targetDir: process.env.MCPEE_TARGET_DIR || process.env.INIT_CWD || process.cwd(),
    owner: process.env.MCPEE_OWNER || "",
    repoPrefix: process.env.MCPEE_REPO_PREFIX || "",
    initialRepoName: process.env.MCPEE_INITIAL_REPO_NAME || "",
    initialRepoDomain: process.env.MCPEE_INITIAL_REPO_DOMAIN || "",
    initialRepoLocation: process.env.MCPEE_INITIAL_REPO_LOCATION || "",
    skipInitialRepo: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "-h":
      case "--help":
      case "help":
        options.help = true;
        break;
      case "--postinstall":
        options.postinstall = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--skip-bootstrap":
        options.skipBootstrap = true;
        break;
      case "--non-interactive":
        options.nonInteractive = true;
        break;
      case "--skip-initial-repo":
        options.skipInitialRepo = true;
        break;
      case "--target":
        options.targetDir = argv[index + 1] || options.targetDir;
        index += 1;
        break;
      case "--owner":
        options.owner = argv[index + 1] || options.owner;
        index += 1;
        break;
      case "--repo-prefix":
        options.repoPrefix = argv[index + 1] || options.repoPrefix;
        index += 1;
        break;
      case "--initial-repo-name":
        options.initialRepoName = argv[index + 1] || options.initialRepoName;
        index += 1;
        break;
      case "--initial-repo-domain":
        options.initialRepoDomain = argv[index + 1] || options.initialRepoDomain;
        index += 1;
        break;
      case "--initial-repo-location":
        options.initialRepoLocation = argv[index + 1] || options.initialRepoLocation;
        index += 1;
        break;
      default:
        break;
    }
  }

  if (process.env.MCPEE_SKIP_POSTINSTALL === "1") {
    options.skipBootstrap = true;
  }

  if (process.env.CI === "true" || !process.stdin.isTTY) {
    options.nonInteractive = true;
  }

  return options;
}

function printInstallHelp() {
  process.stdout.write(
    [
      "mcpee install [opciones]",
      "",
      "Opciones:",
      "  --target <ruta>            Proyecto host donde scaffoldar el engine.",
      "  --force                    Sobrescribe archivos scaffold cuando ya existan.",
      "  --skip-bootstrap           Copia artefactos e inicializa registry plantilla sin bootstrap.",
      "  --non-interactive          Evita prompts; deja registry plantilla listo para editar luego.",
      "  --owner <valor>            Owner para repo-registry/repos.yml.",
      "  --repo-prefix <valor>      Prefijo de nombres para repos del intake.",
      "  --skip-initial-repo        Crea el registry sin alta inicial de repos.",
    ].join("\n") + "\n",
  );
}

function normalizePath(inputPath) {
  return path.resolve(inputPath);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, targetPath, overwrite) {
  ensureDir(path.dirname(targetPath));
  if (!overwrite && fs.existsSync(targetPath)) {
    const sourceContent = fs.readFileSync(sourcePath);
    const targetContent = fs.readFileSync(targetPath);
    if (Buffer.compare(sourceContent, targetContent) === 0) {
      return { copied: false, skipped: true, reason: "same" };
    }

    return { copied: false, skipped: true, reason: "exists" };
  }

  fs.copyFileSync(sourcePath, targetPath);
  return { copied: true, skipped: false, reason: "copied" };
}

function copyEntry(sourceRelativePath, targetRoot, overwrite, stats) {
  const sourcePath = path.join(packageRoot, sourceRelativePath);
  const targetPath = path.join(targetRoot, sourceRelativePath);

  if (!fs.existsSync(sourcePath)) {
    return;
  }

  const entry = fs.statSync(sourcePath);
  if (entry.isDirectory()) {
    ensureDir(targetPath);
    for (const childName of fs.readdirSync(sourcePath)) {
      copyEntry(path.posix.join(sourceRelativePath.replaceAll(path.sep, "/"), childName), targetRoot, overwrite, stats);
    }
    return;
  }

  const result = copyFile(sourcePath, targetPath, overwrite);
  if (result.copied) {
    stats.copied += 1;
    return;
  }

  if (result.reason === "exists") {
    stats.skippedExisting += 1;
  }
}

function ensureRuntimeLayout(targetRoot) {
  for (const dirRelativePath of runtimeDirs) {
    ensureDir(path.join(targetRoot, dirRelativePath));
  }
}

function resolveShellCandidates() {
  if (process.platform === "win32") {
    return ["pwsh", "powershell"];
  }

  return ["pwsh"];
}

function runPowerShell(scriptPath, args, cwd) {
  const shellCandidates = resolveShellCandidates();
  for (const shellCommand of shellCandidates) {
    const result = spawnSync(shellCommand, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    if (result.error && result.error.code === "ENOENT") {
      continue;
    }

    if (result.error) {
      throw result.error;
    }

    return result.status ?? 0;
  }

  throw new Error("PowerShell no esta disponible. Instala pwsh para completar la instalacion.");
}

function deriveRepoPrefix(targetRoot, options) {
  if (options.repoPrefix) {
    return options.repoPrefix;
  }

  return `${path.basename(targetRoot).replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()}_`;
}

function initializeTemplateRegistry(targetRoot, options) {
  const registryPath = path.join(targetRoot, "repo-registry", "repos.yml");
  if (fs.existsSync(registryPath)) {
    return 0;
  }

  const initScript = path.join(targetRoot, "scripts", "intake", "init-template-registry.ps1");
  const args = [
    "-Owner",
    options.owner || "your-team",
    "-RepoNamePrefix",
    deriveRepoPrefix(targetRoot, options),
    "-SkipInitialRepo",
  ];

  return runPowerShell(initScript, args, targetRoot);
}

function runBootstrap(targetRoot) {
  const bootstrapScript = path.join(targetRoot, "scripts", "bootstrap-portable.ps1");
  return runPowerShell(bootstrapScript, [], targetRoot);
}

function installProjectHooks(targetRoot) {
  const hookScript = path.join(targetRoot, "scripts", "setup", "install-project-hooks.ps1");
  if (!fs.existsSync(hookScript)) {
    return 0;
  }

  return runPowerShell(hookScript, [], targetRoot);
}

function runHostInstall(rawOptions) {
  const options = rawOptions;
  const targetRoot = normalizePath(options.targetDir);
  const stats = { copied: 0, skippedExisting: 0 };

  if (normalizePath(packageRoot) === targetRoot) {
    process.stdout.write("[mcpee] Instalacion en el propio repo detectada; se omite scaffold host.\n");
    return 0;
  }

  process.stdout.write(`[mcpee] Scaffold del engine en ${targetRoot}\n`);
  for (const entry of scaffoldEntries) {
    copyEntry(entry, targetRoot, options.force, stats);
  }

  ensureRuntimeLayout(targetRoot);
  process.stdout.write(`[mcpee] Archivos copiados: ${stats.copied}; existentes preservados: ${stats.skippedExisting}\n`);

  if (options.skipBootstrap) {
    const initStatus = initializeTemplateRegistry(targetRoot, options);
    if (initStatus !== 0) {
      return initStatus;
    }

    const hookStatus = installProjectHooks(targetRoot);
    if (hookStatus !== 0) {
      return hookStatus;
    }

    process.stdout.write("[mcpee] Bootstrap omitido. Puedes ejecutar .\\scripts\\bootstrap-portable.cmd mas tarde.\n");
    return 0;
  }

  if (options.nonInteractive) {
    const initStatus = initializeTemplateRegistry(targetRoot, options);
    if (initStatus !== 0) {
      return initStatus;
    }

    const hookStatus = installProjectHooks(targetRoot);
    if (hookStatus !== 0) {
      return hookStatus;
    }

    process.stdout.write("[mcpee] Modo no interactivo detectado. Se inicializo el registry plantilla y se omitio bootstrap interactivo.\n");
    return 0;
  }

  const bootstrapStatus = runBootstrap(targetRoot);
  if (bootstrapStatus !== 0) {
    return bootstrapStatus;
  }

  return installProjectHooks(targetRoot);
}

function runHostInstallFromCli(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printInstallHelp();
      return 0;
    }
    return runHostInstall(options);
  }
  catch (error) {
    process.stderr.write(`[mcpee] ${error.message}\n`);
    return 1;
  }
}

module.exports = {
  runHostInstall,
  runHostInstallFromCli,
};

if (require.main === module) {
  process.exit(runHostInstallFromCli());
}