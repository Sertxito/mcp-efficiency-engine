"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { recordEvent } = require("../../core/src/telemetry");

const catalogPath = path.resolve(__dirname, "../../../catalog/tools/tools.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const toolsById = new Map(catalog.tools.map((tool) => [tool.id, tool]));
const WINDOWS_EXTENSIONS = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
  .split(";").filter(Boolean);
const INSTALL_STATE = ".mcpee/tools/installation-state.json";
const NPM_TOOL_ROOT = ".mcpee/tools/npm";
const PYTHON_TOOL_ROOT = ".mcpee/tools/python";
const PYTHON_BOOTSTRAP_ROOT = ".mcpee/tools/bootstrap/uv";
const MAX_INSTALL_OUTPUT = 1024 * 1024;

function candidates(directory, command) {
  const extension = path.extname(command);
  if (extension) return [path.join(directory, command)];
  const extensions = process.platform === "win32" ? WINDOWS_EXTENSIONS : [""];
  return extensions.map((suffix) => path.join(directory, `${command}${suffix}`));
}

function npmPlatformPackage(root, installer) {
  if (!installer.platform_package_prefix) return null;
  const packageName = `${installer.platform_package_prefix}${process.platform}-${process.arch}`;
  return path.join(root, NPM_TOOL_ROOT, "node_modules", packageName);
}

function findExecutable(projectRoot, tool, installState = null) {
  if (tool.id === "node") return process.execPath;
  if (tool.id === "python" && installState?.python_runtime?.executable) {
    const runtimeRoot = path.resolve(projectRoot, PYTHON_TOOL_ROOT, "runtime");
    const runtime = path.resolve(projectRoot, installState.python_runtime.executable);
    const relative = path.relative(runtimeRoot, runtime);
    if (relative !== ".." && !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative) && fs.existsSync(runtime)) return runtime;
  }
  if (tool.installer?.type === "npm-prefix") {
    const platformPackage = npmPlatformPackage(projectRoot, tool.installer);
    if (platformPackage && !fs.existsSync(platformPackage)) return null;
    const entryPoint = path.join(
      projectRoot,
      NPM_TOOL_ROOT,
      "node_modules",
      tool.installer.package,
      tool.installer.entry_point,
    );
    return fs.existsSync(entryPoint) ? entryPoint : null;
  }
  const pythonEnvironment = installState?.tools?.[tool.id]?.environment;
  const pythonEnvironmentRoot = path.resolve(projectRoot, PYTHON_TOOL_ROOT);
  const configuredPythonEnvironment = pythonEnvironment
    ? path.resolve(projectRoot, pythonEnvironment)
    : path.join(pythonEnvironmentRoot, tool.id);
  const pythonEnvironmentRelative = path.relative(pythonEnvironmentRoot, configuredPythonEnvironment);
  const pythonScripts = pythonEnvironmentRelative !== ".." &&
    !pythonEnvironmentRelative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(pythonEnvironmentRelative)
    ? path.join(configuredPythonEnvironment, process.platform === "win32" ? "Scripts" : "bin")
    : path.join(pythonEnvironmentRoot, tool.id, process.platform === "win32" ? "Scripts" : "bin");
  const localBins = [
    path.join(projectRoot, "node_modules", ".bin"),
    path.join(projectRoot, NPM_TOOL_ROOT, "node_modules", ".bin"),
    pythonScripts,
  ];
  const directories = [...localBins, ...(process.env.PATH || "").split(path.delimiter).filter(Boolean)];
  for (const directory of directories) {
    for (const candidate of candidates(directory, tool.command)) {
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
        throw error;
      }
    }
  }
  return null;
}

function discoverTools(projectRoot) {
  const root = path.resolve(projectRoot);
  const installState = readInstallState(root);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    discovery: "MCPEE project-isolated tool environments and PATH; only catalogued tools",
    tools: catalog.tools.map((tool) => {
      const executable = findExecutable(root, tool, installState);
      return {
        id: tool.id,
        command: tool.command,
        optional: tool.optional,
        available: executable !== null,
        invokable: executable !== null &&
          (!(process.platform === "win32" && /\.(?:cmd|bat|ps1)$/i.test(executable)) ||
            (tool.id === "npm" && Boolean(npmCliPath(process.execPath, executable)))),
        executable,
        validation: "not-run",
        installation: installState.tools[tool.id] || installState.results?.[tool.id] || (tool.auto_install ? null : {
          status: tool.installation || "not-installed-automatically",
          reason: tool.reason || null,
          url: tool.url,
          license: tool.license || null,
        }),
      };
    }),
  };
}

function npmCliPath(nodeExecutable = process.execPath, npmExecutable = null) {
  const directories = [...new Set([
    path.dirname(path.resolve(nodeExecutable)),
    ...(npmExecutable ? [path.dirname(path.resolve(npmExecutable))] : []),
  ])];
  const candidates = directories.flatMap((directory) => [
    path.join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(directory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(directory, "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ]);
  for (const candidate of new Set(candidates)) {
    try {
      if (fs.lstatSync(candidate).isFile()) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
  }
  return null;
}

function runProcess(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: "utf8",
    timeout: options.timeoutMs || 900_000,
    maxBuffer: MAX_INSTALL_OUTPUT,
    windowsHide: true,
    shell: false,
  });
}

function readLatestLtsVersion(options = {}) {
  const get = options.get || https.get;
  return new Promise((resolve, reject) => {
    const request = get("https://nodejs.org/dist/index.json", { timeout: 8000 }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Node.js release index returned HTTP ${response.statusCode}`));
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) {
          request.destroy(new Error("Node.js release index exceeded the 2 MiB limit"));
        }
      });
      response.on("end", () => {
        try {
          const releases = JSON.parse(body);
          const latest = releases.find((release) => release.lts);
          if (!latest || !/^v\d+\.\d+\.\d+$/.test(latest.version)) {
            throw new Error("No valid LTS release was found in the Node.js release index");
          }
          resolve(latest.version);
        } catch (error) {
          reject(new Error(`Could not read the official Node.js LTS release index: ${error.message}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Timed out checking the official Node.js LTS release")));
    request.on("error", reject);
  });
}

function readInstallState(root) {
  const file = path.join(root, INSTALL_STATE);
  if (!fs.existsSync(file)) return { schema_version: 1, generated_by: "mcpee", tools: {} };
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (state.generated_by !== "mcpee" || !state.tools || typeof state.tools !== "object") {
    throw new Error(`Refusing to update invalid or user-owned install state: ${file}`);
  }
  return state;
}

function ensureManagedToolsDirectory(root) {
  const toolsDirectory = path.join(root, ".mcpee/tools");
  const marker = path.join(toolsDirectory, ".mcpee-owned");
  let current = path.resolve(root);
  for (const part of [".mcpee", "tools"]) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to install tools through symbolic link: ${current}`);
    }
  }
  if (fs.existsSync(marker)) {
    if (fs.readFileSync(marker, "utf8") !== "MCPEE managed tool installations\n") {
      throw new Error(`Refusing to use invalid tool ownership marker: ${marker}`);
    }
    return;
  }
  if (fs.existsSync(toolsDirectory) && fs.readdirSync(toolsDirectory).length > 0) {
    throw new Error(`Refusing to overwrite user-owned tool directory without MCPEE ownership marker: ${toolsDirectory}`);
  }
  fs.mkdirSync(toolsDirectory, { recursive: true });
  fs.writeFileSync(marker, "MCPEE managed tool installations\n", { encoding: "utf8", flag: "wx" });
}

function ensureManagedSubdirectory(root, relativePath) {
  const toolsRoot = path.resolve(root, ".mcpee/tools");
  const target = path.resolve(root, relativePath);
  const relative = path.relative(toolsRoot, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing to create a tool directory outside MCPEE's managed tools root: ${target}`);
  }
  let current = toolsRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Refusing to install tools through symbolic link: ${current}`);
      }
    } else {
      fs.mkdirSync(current);
    }
  }
  return target;
}

function writeInstallState(root, state) {
  const destination = path.join(root, INSTALL_STATE);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

function systemPythonExecutable() {
  const pythonTool = catalog.tools.find((tool) => tool.id === "python");
  if (!pythonTool) return null;
  for (const directory of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const candidate of candidates(directory, pythonTool.command)) {
      try {
        if (fs.statSync(candidate).isFile() &&
            !(process.platform === "win32" && /\.(?:cmd|bat|ps1)$/i.test(candidate))) return candidate;
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
        throw error;
      }
    }
  }
  return null;
}

function isVersionAtLeast(actual, minimum) {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function isPythonAtLeast(actual, minimum) {
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(actual.length, right.length); index += 1) {
    const difference = (actual[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function uvExecutablePath(root) {
  return path.join(root, PYTHON_BOOTSTRAP_ROOT,
    process.platform === "win32" ? "Scripts/uv.exe" : "bin/uv");
}

function pythonEnvironment(root, runtimeDirectory) {
  return {
    UV_PYTHON_INSTALL_DIR: runtimeDirectory,
    UV_CACHE_DIR: path.join(root, ".mcpee/tools/uv-cache"),
  };
}

function reportsUvVersion(result, expectedVersion) {
  if (result.error || result.status !== 0) return false;
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  return output.match(/^uv\s+(\d+\.\d+\.\d+)(?:\s|$)/m)?.[1] === expectedVersion;
}

function runPythonRuntimeCommand(root, uv, args, env, options) {
  const run = options.runProcess || runProcess;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = run(uv, args, { cwd: root, env });
    if (!result.error && result.status === 0) return result;
    const details = (result.error?.message || result.stderr || "Managed Python installation failed.").slice(-4000);
    const lockedRename = /failed to rename file/i.test(details) && /\bos error (?:5|32|33)\b/i.test(details);
    if (process.platform !== "win32" || !lockedRename || attempt === 3) {
      throw new Error(`${details.trim()}${attempt > 1 ? ` (after ${attempt} attempts)` : ""}`);
    }
    // Windows scanners can briefly hold files while uv finalizes the runtime.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 500);
  }
}

function ensureUv(root, options) {
  const runtimeDefinition = catalog.python_runtime;
  const localUv = uvExecutablePath(root);
  if (fs.existsSync(localUv) && fs.lstatSync(localUv).isSymbolicLink()) {
    throw new Error(`Refusing to execute uv through symbolic link: ${localUv}`);
  }
  const uv = options.uvExecutable || (fs.existsSync(localUv) ? localUv : null);
  const run = options.runProcess || runProcess;
  if (uv) {
    const version = run(uv, ["--version"], { cwd: root, timeoutMs: 5000 });
    if (reportsUvVersion(version, runtimeDefinition.version)) return uv;
  }
  const python = options.pythonExecutable || systemPythonExecutable();
  if (!python) {
    throw new Error(`Cannot bootstrap project-local uv ${runtimeDefinition.version}: install Python 3.8+ with pip, then rerun mcpee init. No global Python runtime was modified.`);
  }
  const baseVersion = run(python, ["--version"], { cwd: root, timeoutMs: 5000 });
  const output = baseVersion.error || baseVersion.status !== 0
    ? ""
    : `${baseVersion.stdout || ""}${baseVersion.stderr || ""}`;
  const match = output.match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
  if (!match || !isPythonAtLeast(match.slice(1).map(Number), "3.8")) {
    throw new Error(`A Python 3.8+ runtime is required only to bootstrap local uv; detected ${match?.[0] || "unknown"}.`);
  }
  ensureManagedSubdirectory(root, PYTHON_BOOTSTRAP_ROOT);
  const bootstrapEnvironment = {
    PIP_CACHE_DIR: ensureManagedSubdirectory(root, ".mcpee/tools/pip-cache"),
  };
  const installed = run(python, [
    "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
    "--prefix", path.resolve(root, PYTHON_BOOTSTRAP_ROOT),
    "--upgrade", `uv==${runtimeDefinition.version}`,
  ], {
    cwd: root,
    env: bootstrapEnvironment,
  });
  if (installed.error || installed.status !== 0) {
    throw new Error(installed.error?.message || (installed.stderr || "Could not install the local uv runtime").slice(-4000));
  }
  if (!fs.existsSync(localUv)) {
    throw new Error(`uv ${runtimeDefinition.version} installation succeeded but its executable was not found at ${localUv}.`);
  }
  const version = run(localUv, ["--version"], { cwd: root, timeoutMs: 5000 });
  if (!reportsUvVersion(version, runtimeDefinition.version)) {
    throw new Error(`The project-local uv executable did not report the expected version ${runtimeDefinition.version}.`);
  }
  return localUv;
}

function ensureLatestPython(root, state, options) {
  const uv = ensureUv(root, options);
  const run = options.runProcess || runProcess;
  const runtimeDirectory = ensureManagedSubdirectory(root, path.join(PYTHON_TOOL_ROOT, "runtime"));
  ensureManagedSubdirectory(root, ".mcpee/tools/uv-cache");
  const env = pythonEnvironment(root, runtimeDirectory);
  runPythonRuntimeCommand(root, uv, ["python", "install"], env, options);
  runPythonRuntimeCommand(root, uv, ["python", "upgrade"], env, options);
  const found = run(uv, ["python", "find", "--managed-python"], { cwd: root, env });
  if (found.error || found.status !== 0) {
    throw new Error(found.error?.message || (found.stderr || "Could not locate the project-local Python runtime").slice(-4000));
  }
  const executable = (found.stdout || "").trim();
  if (!executable) throw new Error("uv did not return a path for the project-local Python runtime.");
  const relative = path.relative(runtimeDirectory, path.resolve(executable));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`uv selected a Python executable outside MCPEE's managed runtime directory: ${executable}`);
  }
  const versionResult = run(executable, ["--version"], { cwd: root, timeoutMs: 5000 });
  const versionOutput = versionResult.error || versionResult.status !== 0
    ? ""
    : `${versionResult.stdout || ""}${versionResult.stderr || ""}`;
  const versionMatch = versionOutput.match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
  if (!versionMatch) {
    throw new Error(versionResult.error?.message || (versionResult.stderr || "The managed Python runtime returned an invalid version").trim());
  }
  const version = versionMatch.slice(1).join(".");
  state.python_runtime = {
    manager: "uv",
    manager_version: catalog.python_runtime.version,
    policy: "latest-stable",
    version,
    executable: path.relative(root, executable).split(path.sep).join("/"),
  };
  return { uv, executable, version, env };
}

function installedPythonPackageVersion(run, python, root, packageName) {
  const result = run(python, [
    "-c",
    "import importlib.metadata,sys; print(importlib.metadata.version(sys.argv[1]))",
    packageName,
  ], { cwd: root, timeoutMs: 10_000 });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}

function installPythonTool(root, tool, state, options, runtime) {
  const definition = tool.installer;
  const run = options.runProcess || runProcess;
  const target = path.join(root, PYTHON_TOOL_ROOT, tool.id, runtime.version);
  const relativeTarget = path.relative(root, target).split(path.sep).join("/");
  const pythonName = process.platform === "win32" ? "python.exe" : "python";
  const environmentPython = path.join(target, process.platform === "win32" ? "Scripts" : "bin", pythonName);
  const oldState = state.tools[tool.id];
  const packageName = tool.id === "graphify" ? "graphifyy" : "markitdown";
  if (oldState?.version === definition.version &&
      oldState?.python_version === runtime.version &&
      oldState?.environment === relativeTarget &&
      fs.existsSync(environmentPython) &&
      installedPythonPackageVersion(run, environmentPython, root, packageName) === definition.version) {
    return { id: tool.id, status: "already-installed", version: definition.version, python_version: runtime.version };
  }
  if (fs.existsSync(target) && oldState?.environment !== relativeTarget) {
    return { id: tool.id, status: "failed", reason: `Refusing to reuse an untracked Python environment: ${target}` };
  }
  ensureManagedSubdirectory(root, path.join(PYTHON_TOOL_ROOT, tool.id));
  if (!fs.existsSync(target)) ensureManagedSubdirectory(root, path.join(PYTHON_TOOL_ROOT, tool.id, runtime.version));
  const created = run(runtime.uv, [
    "venv", "--python", runtime.executable, target,
  ], { cwd: root, env: runtime.env });
  if (created.error || created.status !== 0 || !fs.existsSync(environmentPython)) {
    return { id: tool.id, status: "failed", reason: created.error?.message || (created.stderr || "Could not create isolated Python environment").slice(-4000), exit_code: created.status };
  }
  const installed = run(runtime.uv, [
    "pip", "install", "--python", environmentPython, "--no-progress",
    `${definition.package}==${definition.version}`,
  ], { cwd: root, env: runtime.env });
  if (installed.error || installed.status !== 0) {
    return { id: tool.id, status: "failed", reason: installed.error?.message || (installed.stderr || "pip install failed").slice(-4000), exit_code: installed.status };
  }
  if (installedPythonPackageVersion(run, environmentPython, root, packageName) !== definition.version) {
    return { id: tool.id, status: "failed", reason: `Installed ${packageName} did not report the expected version ${definition.version}.` };
  }
  state.tools[tool.id] = {
    version: definition.version,
    python_version: runtime.version,
    environment: relativeTarget,
  };
  return { id: tool.id, status: "installed", version: definition.version, python_version: runtime.version };
}

function installNpmTool(root, tool, state, options) {
  const definition = tool.installer;
  if (!isVersionAtLeast(process.versions.node, definition.node_minimum)) {
    return { id: tool.id, status: "blocked", reason: `Node.js ${definition.node_minimum}+ is required; current runtime is ${process.version}.` };
  }
  const npmCli = options.npmCli || npmCliPath();
  if (!npmCli) return { id: tool.id, status: "blocked", reason: "npm's JavaScript CLI was not found beside the active Node runtime." };
  const installedPackage = path.join(root, NPM_TOOL_ROOT, "node_modules", definition.package, "package.json");
  const platformPackage = npmPlatformPackage(root, definition);
  const hasPlatformPackage = !platformPackage || fs.existsSync(platformPackage);
  if (state.tools[tool.id]?.version === definition.version && fs.existsSync(installedPackage)) {
    const packageState = JSON.parse(fs.readFileSync(installedPackage, "utf8"));
    if (packageState.version === definition.version && hasPlatformPackage) {
      return { id: tool.id, status: "already-installed", version: definition.version };
    }
  }
  const target = path.join(root, NPM_TOOL_ROOT);
  const run = options.runProcess || runProcess;
  const installed = run(process.execPath, [
    npmCli,
    "install",
    "--prefix", target,
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    "--save-exact",
    `${definition.package}@${definition.version}`,
  ], { cwd: root });
  if (installed.error || installed.status !== 0) {
    return { id: tool.id, status: "failed", reason: installed.error?.message || (installed.stderr || "npm install failed").slice(-4000), exit_code: installed.status };
  }
  const installedState = JSON.parse(fs.readFileSync(installedPackage, "utf8"));
  if (installedState.version !== definition.version) {
    return { id: tool.id, status: "failed", reason: `Installed ${definition.package} version ${installedState.version}; expected ${definition.version}.` };
  }
  if (platformPackage && !fs.existsSync(platformPackage)) {
    return {
      id: tool.id,
      status: "failed",
      reason: `The npm install did not provide the platform runtime ${path.basename(platformPackage)}. Check optional-dependency access to the npm registry and rerun mcpee init.`,
    };
  }
  state.tools[tool.id] = { version: definition.version, environment: path.relative(root, target).split(path.sep).join("/") };
  return { id: tool.id, status: "installed", version: definition.version };
}

function installPythonEnvironment(projectRoot, environmentId, pythonVersion, packages, options = {}) {
  if (!/^[a-z][a-z0-9_-]{1,40}$/.test(environmentId)) {
    throw new Error("Python environment id must be a lowercase tool identifier.");
  }
  if (!/^\d+\.\d+$/.test(pythonVersion)) {
    throw new Error("Python environment version must be a major.minor version.");
  }
  if (!Array.isArray(packages) || !packages.length ||
      packages.some((item) => typeof item !== "string" || !/^[A-Za-z0-9_.-]+==[A-Za-z0-9_.+-]+$/.test(item))) {
    throw new Error("Python packages must be an array of exactly pinned package specifications.");
  }
  const root = path.resolve(projectRoot);
  const state = readInstallState(root);
  const run = options.runProcess || runProcess;
  ensureManagedToolsDirectory(root);
  const uv = ensureUv(root, options);
  const runtimeDirectory = ensureManagedSubdirectory(root, path.join(PYTHON_TOOL_ROOT, "runtime"));
  ensureManagedSubdirectory(root, ".mcpee/tools/uv-cache");
  const env = pythonEnvironment(root, runtimeDirectory);
  runPythonRuntimeCommand(root, uv, ["python", "install", pythonVersion], env, options);
  const foundRuntime = run(uv, ["python", "find", "--managed-python", pythonVersion], {
    cwd: root,
    env,
  });
  if (foundRuntime.error || foundRuntime.status !== 0) {
    throw new Error(foundRuntime.error?.message ||
      (foundRuntime.stderr || `Could not locate managed Python ${pythonVersion}`).slice(-4000));
  }
  const executable = (foundRuntime.stdout || "").trim();
  const runtimeRelative = path.relative(runtimeDirectory, path.resolve(executable));
  if (!executable || runtimeRelative === ".." || runtimeRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(runtimeRelative)) {
    throw new Error(`uv selected a Python executable outside MCPEE's managed runtime directory: ${executable}`);
  }
  if (!fs.existsSync(executable) || fs.lstatSync(executable).isSymbolicLink()) {
    throw new Error(`uv did not return a regular managed Python executable: ${executable}`);
  }
  const match = run(executable, ["--version"], { cwd: root, timeoutMs: 5000 });
  const versionOutput = match && !match.error && match.status === 0
    ? `${match.stdout || ""}${match.stderr || ""}`
    : "";
  if (!new RegExp(`Python\\s+${pythonVersion.replace(".", "\\.")}\\.\\d+`).test(versionOutput)) {
    throw new Error(match?.error?.message || `Managed Python did not report version ${pythonVersion}.`);
  }

  const target = path.join(root, PYTHON_TOOL_ROOT, environmentId, pythonVersion);
  const relativeTarget = path.relative(root, target).split(path.sep).join("/");
  const environmentPython = path.join(target,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const previous = state.tools[environmentId];
  if (fs.existsSync(target) && previous?.environment !== relativeTarget) {
    throw new Error(`Refusing to reuse an untracked Python environment: ${target}`);
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`Refusing to install through a symbolic link: ${target}`);
  }
  ensureManagedSubdirectory(root, path.join(PYTHON_TOOL_ROOT, environmentId));
  if (!fs.existsSync(target)) {
    const created = run(uv, ["venv", "--python", executable, target], { cwd: root, env });
    if (created.error || created.status !== 0 || !fs.existsSync(environmentPython)) {
      throw new Error(created.error?.message ||
        (created.stderr || "Could not create the isolated Python environment").slice(-4000));
    }
  }
  if (fs.lstatSync(environmentPython).isSymbolicLink()) {
    throw new Error(`Refusing to use a symbolic Python executable: ${environmentPython}`);
  }
  const installed = run(uv, [
    "pip", "install", "--python", environmentPython, "--no-progress", ...packages,
  ], { cwd: root, env });
  if (installed.error || installed.status !== 0) {
    throw new Error(installed.error?.message ||
      (installed.stderr || "Could not install the pinned Python packages").slice(-4000));
  }
  for (const specification of packages) {
    const [name, expectedVersion] = specification.split("==");
    const actualVersion = installedPythonPackageVersion(run, environmentPython, root, name);
    if (actualVersion !== expectedVersion) {
      throw new Error(`Installed ${name} version ${actualVersion || "unknown"}; expected ${expectedVersion}.`);
    }
  }
  state.tools[environmentId] = {
    version: packages.join(","),
    python_version: pythonVersion,
    environment: relativeTarget,
    packages,
  };
  state.checked_at = new Date().toISOString();
  writeInstallState(root, state);
  return { id: environmentId, environment: relativeTarget, python_version: pythonVersion, packages };
}

async function installCatalogTools(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const state = readInstallState(root);
  const results = [];
  let pythonRuntime;
  let pythonRuntimeError;
  let latestLts;
  let ltsCheckError;
  const tools = catalog.tools.filter((item) =>
    item.auto_install && (!options.onlyTools || options.onlyTools.includes(item.id)));
  if (!options.skipInstall && !options.skipNodeTools) {
    try {
      latestLts = options.latestLts || await readLatestLtsVersion(options);
    } catch (error) {
      ltsCheckError = error.message;
    }
  }
  options.onNodeCheck?.({ current: process.version, latest: latestLts || null, error: ltsCheckError || null });
  const nodeBlocker = (tool) => {
    if (tool.installer.type !== "npm-prefix" || options.skipNodeTools) return null;
    const minimum = tool.installer.node_minimum;
    if (!isVersionAtLeast(process.versions.node, minimum)) {
      return `Node.js ${minimum}+ is required; current runtime is ${process.version}.`;
    }
    if (!options.npmCli && !npmCliPath()) {
      return "npm's JavaScript CLI was not found beside the active Node runtime.";
    }
    return null;
  };
  const installDetails = tool => ({
    id: tool.id,
    package: tool.installer.package,
    version: tool.installer.version,
    installer: tool.installer.type,
    required: !tool.optional,
    target: tool.installer.type === "npm-prefix"
      ? `${NPM_TOOL_ROOT}/`
      : `${PYTHON_TOOL_ROOT}/${tool.id}/<python-version>/`,
    runtimeTarget: tool.installer.type === "python-venv"
      ? `${PYTHON_TOOL_ROOT}/runtime/ (latest stable Python, if not already installed)`
      : null,
  });
  const blockers = new Map(tools.map(tool => [tool.id, nodeBlocker(tool)]));
  const blockedTools = tools.filter(tool => blockers.get(tool.id));
  for (const tool of options.skipInstall ? [] : blockedTools) options.onProgress?.({
    id: tool.id, status: "blocked", reason: blockers.get(tool.id),
  });
  const eligible = tools.filter(tool => !blockers.get(tool.id) &&
    !(options.skipNodeTools && tool.installer.type === "npm-prefix"));
  const batchApproved = !options.skipInstall && eligible.length && options.approveInstallBatch
    ? await options.approveInstallBatch(eligible.map(installDetails))
    : undefined;
  for (const tool of tools) {
    if (options.skipInstall) {
      results.push({ id: tool.id, status: "skipped", reason: "Tool installation was disabled by --skip-tool-install." });
      continue;
    }
    const blocker = blockers.get(tool.id);
    if (blocker || (options.skipNodeTools && tool.installer.type === "npm-prefix")) {
      results.push({ id: tool.id, status: blocker ? "blocked" : "skipped",
        reason: blocker || "Node tool installation was disabled by --skip-tool-install." });
      recordEvent(root, {
        event_name: "action.blocked",
        tool_name: tool.id,
        attributes: { action: "tool installation", reason: blocker || "Node tool installation disabled" },
      });
      continue;
    }
    const approved = options.approveInstallBatch
      ? batchApproved
      : await options.approveInstall?.(installDetails(tool));
    if (!approved) {
      const result = { id: tool.id, status: "blocked", reason: "Human approval was not granted for package installation." };
      results.push(result);
      recordEvent(root, {
        event_name: "action.blocked",
        tool_name: tool.id,
        attributes: { action: "tool installation", package: tool.installer.package || null },
      });
      continue;
    }
    options.onProgress?.({ id: tool.id, status: "installing" });
    ensureManagedToolsDirectory(root);
    let result;
    if (tool.installer.type === "npm-prefix") {
      result = installNpmTool(root, tool, state, options);
    } else if (tool.installer.type === "python-venv") {
      try {
        if (pythonRuntimeError) throw pythonRuntimeError;
        pythonRuntime ||= ensureLatestPython(root, state, options);
        result = installPythonTool(root, tool, state, options, pythonRuntime);
      } catch (error) {
        if (!pythonRuntime) pythonRuntimeError = error;
        const blocked = error.message.startsWith("Cannot bootstrap") ||
          error.message.startsWith("A Python 3.8+");
        result = { id: tool.id, status: blocked ? "blocked" : "failed", reason: error.message };
      }
    } else {
      throw new Error(`Unsupported installer type '${tool.installer.type}' for tool '${tool.id}'`);
    }
    results.push(result);
    options.onProgress?.(result);
    recordEvent(root, {
      event_name: "tool.installation.completed",
      tool_name: tool.id,
      attributes: { status: result.status, version: result.version || null },
    });
  }
  state.checked_at = new Date().toISOString();
  state.node_lts = { current: process.version, latest: latestLts || null, error: ltsCheckError || null };
  if (!options.skipInstall) {
    state.results = Object.fromEntries(results.map((result) => [result.id, result]));
    writeInstallState(root, state);
  }
  return {
    latestLts: latestLts || null,
    nodeLtsError: ltsCheckError || null,
    pythonRuntime: state.python_runtime || null,
    results,
  };
}

function saveToolReport(projectRoot, report) {
  const root = path.resolve(projectRoot);
  const stateDirectory = path.join(root, ".mcpee", "state");
  let current = root;
  for (const part of [".mcpee", "state"]) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to write tool state through symbolic link: ${current}`);
    }
  }
  fs.mkdirSync(stateDirectory, { recursive: true });
  const destination = path.join(stateDirectory, "tools.json");
  const contents = `${JSON.stringify({ generated_by: "mcpee", ...report }, null, 2)}\n`;
  if (fs.existsSync(destination)) {
    let existing;
    try {
      existing = JSON.parse(fs.readFileSync(destination, "utf8"));
    } catch (error) {
      throw new Error(`Cannot update invalid MCPEE tool report: ${error.message}`);
    }
    if (existing.generated_by !== "mcpee") {
      throw new Error(`Refusing to overwrite non-MCPEE tool report: ${destination}`);
    }
  }
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, "utf8");
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
  return destination;
}

function validateTool(projectRoot, toolId, options = {}) {
  const definition = toolsById.get(toolId);
  if (!definition) throw new Error(`Unknown catalog tool: ${toolId}`);
  const installState = definition.id === "python" || definition.installer?.type === "python-venv"
    ? readInstallState(path.resolve(projectRoot))
    : null;
  const executable = findExecutable(projectRoot, definition, installState);
  if (!executable) {
    return { id: toolId, available: false, validation: "missing", error: `${definition.command} was not found on PATH or in project node_modules/.bin` };
  }
  const windowsWrapper = process.platform === "win32" && /\.(?:cmd|bat|ps1)$/i.test(executable);
  if (windowsWrapper && definition.id !== "npm") {
    return { id: toolId, available: true, executable, validation: "not-run", reason: "Windows script wrappers are not launched through a shell" };
  }
  const localNpmCli = windowsWrapper ? npmCliPath(process.execPath, executable) : null;
  if (windowsWrapper && !localNpmCli) {
    return { id: toolId, available: true, executable, validation: "not-run", reason: "npm's JavaScript CLI was not found beside the active Node runtime; the shell wrapper was not launched" };
  }
  const usesNodeEntrypoint = definition.installer?.type === "npm-prefix" || Boolean(localNpmCli);
  const command = usesNodeEntrypoint ? process.execPath : executable;
  const args = definition.installer?.type === "npm-prefix"
    ? [path.join(projectRoot, NPM_TOOL_ROOT, "node_modules", definition.installer.package, definition.installer.entry_point), ...definition.version_args]
    : localNpmCli
      ? [localNpmCli, ...definition.version_args]
      : definition.version_args;
  const run = options.runProcess || spawnSync;
  const result = run(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: definition.installer?.env ? { ...process.env, ...definition.installer.env } : process.env,
    timeout: options.timeoutMs || (definition.installer
      ? 30_000
      : definition.id === "npm" ? 10_000 : 3000),
    maxBuffer: 256 * 1024,
    windowsHide: true,
    shell: false,
  });
  if (result.error) {
    return { id: toolId, available: true, executable, validation: "failed", error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      id: toolId,
      available: true,
      executable,
      validation: "failed",
      exit_code: result.status,
      stderr: (result.stderr || "").trim(),
    };
  }
  return {
    id: toolId,
    available: true,
    executable,
    validation: "passed",
    version: (result.stdout || result.stderr || "").trim().split(/\r?\n/, 1)[0],
  };
}

function validateTools(projectRoot, ids) {
  const selected = ids?.length ? ids : catalog.tools.map((tool) => tool.id);
  const results = selected.map((id) => validateTool(projectRoot, id));
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    tools: results,
  };
  saveToolReport(projectRoot, report);
  recordEvent(projectRoot, {
    event_name: "tools.validation.completed",
    attributes: {
      checked: results.length,
      passed: results.filter((result) => result.validation === "passed").length,
      missing: results.filter((result) => result.validation === "missing").length,
      failed: results.filter((result) => result.validation === "failed").length,
    },
  });
  return report;
}

function invokeTool(projectRoot, toolId, args, options = {}) {
  const definition = toolsById.get(toolId);
  if (!definition) throw new Error(`Tool is not allowlisted by the MCPEE catalog: ${toolId}`);
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new Error("Tool arguments must be an array of strings without NUL bytes");
  }
  const root = path.resolve(projectRoot);
  const cwd = path.resolve(root, options.cwd || ".");
  const relativeCwd = path.relative(root, cwd);
  if (relativeCwd === ".." || relativeCwd.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCwd)) {
    throw new Error("Tool working directory must remain inside the project");
  }
  if (!fs.statSync(cwd).isDirectory()) throw new Error(`Tool working directory is not a directory: ${cwd}`);
  let currentCwd = root;
  for (const part of relativeCwd.split(path.sep).filter(Boolean)) {
    currentCwd = path.join(currentCwd, part);
    if (fs.lstatSync(currentCwd).isSymbolicLink()) {
      throw new Error(`Tool working directory cannot follow a symbolic link: ${currentCwd}`);
    }
  }
  const realRoot = fs.realpathSync(root);
  const realCwd = fs.realpathSync(cwd);
  const realRelativeCwd = path.relative(realRoot, realCwd);
  if (realRelativeCwd === ".." || realRelativeCwd.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelativeCwd)) {
    throw new Error("Tool working directory resolves outside the project");
  }
  const installState = definition.id === "python" || definition.installer?.type === "python-venv"
    ? readInstallState(root)
    : null;
  const executable = findExecutable(root, definition, installState);
  if (!executable) throw new Error(`Required local tool '${toolId}' is unavailable; no installation was attempted`);
  const windowsWrapper = process.platform === "win32" && /\.(?:cmd|bat|ps1)$/i.test(executable);
  if (windowsWrapper && definition.id !== "npm") {
    throw new Error(`Refusing to launch shell-based tool wrapper '${executable}'`);
  }
  const localNpmCli = windowsWrapper ? npmCliPath(process.execPath, executable) : null;
  if (windowsWrapper && !localNpmCli) {
    throw new Error(`Cannot invoke npm without a shell: npm's JavaScript CLI was not found beside the active Node runtime (${executable}).`);
  }
  const usesNodeEntrypoint = definition.installer?.type === "npm-prefix" || Boolean(localNpmCli);
  const started = Date.now();
  const command = usesNodeEntrypoint ? process.execPath : executable;
  const invocationArgs = definition.installer?.type === "npm-prefix"
    ? [path.join(root, NPM_TOOL_ROOT, "node_modules", definition.installer.package, definition.installer.entry_point), ...args]
    : localNpmCli
      ? [localNpmCli, ...args]
      : args;
  const result = spawnSync(command, invocationArgs, {
    cwd,
    input: options.input,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(definition.installer?.env || {}),
      ...(options.env || {}),
    },
    timeout: options.timeoutMs || 30_000,
    maxBuffer: options.maxBufferBytes || 4 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  const durationMs = Date.now() - started;
  recordEvent(root, {
    event_name: "tool.invocation.completed",
    tool_name: toolId,
    attributes: {
      argument_count: args.length,
      duration_ms: durationMs,
      exit_code: result.status,
      failed_to_start: Boolean(result.error),
      timed_out: result.error?.code === "ETIMEDOUT",
    },
  });
  if (result.error) {
    return {
      tool: toolId,
      executable,
      status: "failed",
      exit_code: result.status,
      error: result.error.message,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      duration_ms: durationMs,
    };
  }
  return {
    tool: toolId,
    executable,
    status: result.status === 0 ? "success" : "failed",
    exit_code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    duration_ms: durationMs,
  };
}

module.exports = {
  discoverTools,
  validateTool,
  validateTools,
  invokeTool,
  saveToolReport,
  installCatalogTools,
  installPythonEnvironment,
  npmCliPath,
  readLatestLtsVersion,
  isVersionAtLeast,
};
