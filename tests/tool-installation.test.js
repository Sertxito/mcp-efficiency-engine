"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { installCatalogTools, installPythonEnvironment, validateTool } = require("../packages/tool-manager/src/tools");

function pythonInstaller(t, runtimeResult = () => ({ status: 0, stdout: "", stderr: "" })) {
  const root = fs.mkdtempSync(path.join(__dirname, ".mcpee-python-install-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const uv = path.join(root, "uv");
  const python = path.join(root, ".mcpee/tools/python/runtime/cpython-3.14.8",
    process.platform === "win32" ? "python.exe" : "bin/python");
  const calls = [];
  const options = {
    onlyTools: ["markitdown", "graphify"],
    skipNodeTools: true,
    approveInstall: async () => true,
    uvExecutable: uv,
    runProcess(command, args) {
      calls.push({ command, args });
      if (command === uv && args[0] === "--version") {
        return { status: 0, stdout: "uv 0.12.24\n", stderr: "" };
      }
      if (command === uv && args[0] === "python") {
        if (args[1] !== "find") return runtimeResult(args);
        fs.mkdirSync(path.dirname(python), { recursive: true });
        fs.writeFileSync(python, "fixture");
        return { status: 0, stdout: `${python}\n`, stderr: "" };
      }
      if (args[0] === "--version" && path.basename(command).startsWith("python")) {
        return { status: 0, stdout: "Python 3.14.8\n", stderr: "" };
      }
      if (command === uv && args[0] === "venv") {
        const environmentPython = path.join(args.at(-1),
          process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
        fs.mkdirSync(path.dirname(environmentPython), { recursive: true });
        fs.writeFileSync(environmentPython, "fixture");
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === uv && args[0] === "pip") {
        const name = args.at(-1).startsWith("graphifyy") ? "graphify" : "markitdown";
        const executable = path.join(path.dirname(args[3]), `${name}${process.platform === "win32" ? ".exe" : ""}`);
        fs.writeFileSync(executable, "fixture console entry point");
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "-c") {
        return { status: 0, stdout: args[2] === "graphifyy" ? "0.9.80\n" : "0.1.8\n", stderr: "" };
      }
      throw new Error(`Unexpected installer command: ${command} ${args.join(" ")}`);
    },
  };
  return { root, calls, options };
}

function npmInstaller(t) {
  const root = fs.mkdtempSync(path.join(__dirname, ".mcpee-npm-install-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const definitions = require("../catalog/tools/tools.json").tools.filter(tool => tool.installer?.type === "npm-prefix");
  const calls = [];
  const options = {
    onlyTools: definitions.map(tool => tool.id),
    latestLts: process.version,
    npmCli: path.join(root, "fixture-npm.js"),
    approveInstallBatch: async () => true,
    runProcess(command, args) {
      calls.push({ command, args });
      const tool = definitions.find(item => args.at(-1) === `${item.installer.package}@${item.installer.version}`);
      assert.ok(tool, "only an approved npm installation may run");
      const packageRoot = path.join(root, ".mcpee", "tools", "npm", "node_modules", tool.installer.package);
      fs.mkdirSync(path.dirname(path.join(packageRoot, tool.installer.entry_point)), { recursive: true });
      fs.writeFileSync(path.join(packageRoot, tool.installer.entry_point), "fixture entry point");
      fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ version: tool.installer.version }));
      if (tool.installer.platform_package_prefix) {
        fs.mkdirSync(path.join(root, ".mcpee", "tools", "npm", "node_modules",
          `${tool.installer.platform_package_prefix}${process.platform}-${process.arch}`), { recursive: true });
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  };
  return { root, calls, options, definitions };
}

test("repeat init reports verified pinned npm tools without approval or installation", async t => {
  const fixture = npmInstaller(t);
  await installCatalogTools(fixture.root, fixture.options);
  const statePath = path.join(fixture.root, ".mcpee", "tools", "installation-state.json");
  const previous = JSON.parse(fs.readFileSync(statePath));
  previous.results = Object.fromEntries(fixture.definitions.map(tool => [tool.id, {
    id: tool.id, status: "blocked", reason: "Previous noninteractive init denied approval.",
  }]));
  fs.writeFileSync(statePath, JSON.stringify(previous));
  fixture.calls.length = 0;
  for (const approveInstallBatch of [undefined, () => { throw new Error("ready tools must not ask for approval"); }]) {
    const progress = [];
    const result = await installCatalogTools(fixture.root, {
      ...fixture.options,
      npmCli: undefined,
      approveInstallBatch,
      approveInstall: () => { throw new Error("ready tools must not ask individually"); },
      onProgress: item => progress.push(item),
    });
    assert.ok(result.results.every(item => item.status === "already-installed"));
    assert.deepEqual(progress, result.results);
    const state = JSON.parse(fs.readFileSync(path.join(fixture.root, ".mcpee", "tools", "installation-state.json")));
    assert.ok(Object.values(state.results).every(item => item.status === "already-installed"));
  }
  assert.equal(fixture.calls.length, 0);
});

test("repeat init verifies existing Python tools without approval or runtime changes", async t => {
  const fixture = pythonInstaller(t);
  await installCatalogTools(fixture.root, fixture.options);
  fixture.calls.length = 0;
  const result = await installCatalogTools(fixture.root, {
    ...fixture.options,
    approveInstall: undefined,
    approveInstallBatch: () => { throw new Error("ready Python tools must not ask"); },
  });
  assert.deepEqual(result.results.map(item => item.status), ["already-installed", "already-installed"]);
  assert.equal(result.pythonRuntime.version, "3.14.8");
  assert.ok(fixture.calls.length > 0, "readiness must verify actual interpreters and package versions");
  assert.ok(fixture.calls.every(call => call.args[0] === "--version" || call.args[0] === "-c"));
  const state = JSON.parse(fs.readFileSync(path.join(fixture.root, ".mcpee", "tools", "installation-state.json")));
  assert.ok(Object.values(state.results).every(item => item.status === "already-installed"));
});

test("repeat init accepts uv Windows layout, CRLF versions and graphifyy distribution metadata", {
  skip: process.platform !== "win32",
}, async t => {
  const fixture = pythonInstaller(t);
  await installCatalogTools(fixture.root, fixture.options);
  const statePath = path.join(fixture.root, ".mcpee", "tools", "installation-state.json");
  const state = JSON.parse(fs.readFileSync(statePath));
  const runtime = path.join(fixture.root, ".mcpee", "tools", "python", "runtime",
    "cpython-3.14-windows-x86_64-none", "python.exe");
  fs.mkdirSync(path.dirname(runtime), { recursive: true });
  fs.renameSync(path.join(fixture.root, state.python_runtime.executable), runtime);
  state.python_runtime.executable = path.relative(fixture.root, runtime).split(path.sep).join("/");
  for (const [id, distribution, version] of [
    ["markitdown", "markitdown", "0.1.8"], ["graphify", "graphifyy", "0.9.80"],
  ]) {
    const environment = path.join(fixture.root, state.tools[id].environment);
    fs.writeFileSync(path.join(environment, "pyvenv.cfg"),
      `home = ${path.dirname(runtime)}\r\nimplementation = CPython\r\nuv = 0.12.24\r\nversion_info = 3.14\r\ninclude-system-site-packages = false\r\n`);
    const info = path.join(environment, "Lib", "site-packages", `${distribution}-${version}.dist-info`);
    fs.mkdirSync(info, { recursive: true });
    fs.writeFileSync(path.join(info, "METADATA"),
      `Metadata-Version: 2.4\r\nName: ${distribution}\r\nVersion: ${version}\r\n`);
    state.results[id] = { id, status: "blocked", reason: "Previous noninteractive init denied approval." };
  }
  fs.writeFileSync(statePath, JSON.stringify(state));
  const probes = [];
  const result = await installCatalogTools(fixture.root, {
    onlyTools: ["markitdown", "graphify"],
    skipNodeTools: true,
    approveInstallBatch: () => { throw new Error("verified uv tools must not request approval"); },
    runProcess(command, args) {
      probes.push({ command, args });
      assert.ok(fs.statSync(command).isFile());
      if (args[0] === "--version") return { status: 0, stdout: "Python 3.14.8\r\n", stderr: "" };
      assert.equal(args[0], "-c", "no runtime update or package installation is allowed");
      assert.match(args[1], /importlib\.metadata\.version\(sys\.argv\[1\]\)/);
      const sitePackages = path.join(path.dirname(command), "..", "Lib", "site-packages");
      const distribution = args[2];
      const info = fs.readdirSync(sitePackages).find(name => name.startsWith(`${distribution}-`));
      assert.ok(info, `probe must use distribution name ${distribution}, not extras or CLI name`);
      const metadata = fs.readFileSync(path.join(sitePackages, info, "METADATA"), "utf8");
      return { status: 0, stdout: `${metadata.match(/^Version: (.+)\r$/m)[1]}\r\n`, stderr: "" };
    },
  });
  assert.deepEqual(result.results.map(item => [item.id, item.status, item.python_version]), [
    ["markitdown", "already-installed", "3.14.8"], ["graphify", "already-installed", "3.14.8"],
  ]);
  assert.deepEqual(probes.filter(probe => probe.args[0] === "-c").map(probe => probe.args[2]),
    ["markitdown", "graphifyy"]);
  const saved = JSON.parse(fs.readFileSync(statePath));
  assert.ok(Object.values(saved.results).every(item => item.status === "already-installed"));
});

test("missing or changed npm artifacts require approval while ready tools stay out of the bundle", async t => {
  for (const damage of ["entry-point", "entry-point-directory", "version", "invalid-manifest", "platform-package"]) {
    await t.test(damage, async t => {
      const fixture = npmInstaller(t);
      await installCatalogTools(fixture.root, fixture.options);
      const tool = fixture.definitions.find(item => item.id === "codegraph");
      const packageRoot = path.join(fixture.root, ".mcpee", "tools", "npm", "node_modules", tool.installer.package);
      const entryPoint = path.join(packageRoot, tool.installer.entry_point);
      if (damage.startsWith("entry-point")) {
        fs.unlinkSync(entryPoint);
        if (damage === "entry-point-directory") fs.mkdirSync(entryPoint);
      } else if (damage === "platform-package") {
        fs.rmSync(path.join(packageRoot, "..", `codegraph-${process.platform}-${process.arch}`), { recursive: true });
      } else {
        fs.writeFileSync(path.join(packageRoot, "package.json"),
          damage === "version" ? JSON.stringify({ version: "0.0.0" }) : "{invalid");
      }
      fixture.calls.length = 0;
      let approvals = 0;
      const result = await installCatalogTools(fixture.root, {
        ...fixture.options,
        approveInstallBatch: async installs => {
          approvals++;
          assert.deepEqual(installs.map(item => item.id), ["codegraph"]);
          return false;
        },
      });
      assert.equal(approvals, 1);
      assert.deepEqual(result.results.map(item => item.status), ["blocked", "already-installed"]);
      assert.equal(fixture.calls.length, 0);
    });
  }
});

test("missing or changed Python installations require approval before any repair or runtime update", async t => {
  for (const damage of ["entry-point", "environment-python", "package-version", "runtime", "runtime-version", "environment-version"]) {
    await t.test(damage, async t => {
      const fixture = pythonInstaller(t);
      await installCatalogTools(fixture.root, fixture.options);
      const state = JSON.parse(fs.readFileSync(path.join(fixture.root, ".mcpee", "tools", "installation-state.json")));
      const scripts = path.join(fixture.root, state.tools.markitdown.environment,
        process.platform === "win32" ? "Scripts" : "bin");
      if (damage === "entry-point") fs.unlinkSync(path.join(scripts, `markitdown${process.platform === "win32" ? ".exe" : ""}`));
      if (damage === "environment-python") fs.unlinkSync(path.join(scripts, process.platform === "win32" ? "python.exe" : "python"));
      if (damage === "runtime") fs.unlinkSync(path.join(fixture.root, state.python_runtime.executable));
      const run = fixture.options.runProcess;
      fixture.calls.length = 0;
      let approvals = 0;
      const result = await installCatalogTools(fixture.root, {
        ...fixture.options,
        approveInstall: undefined,
        approveInstallBatch: async installs => {
          approvals++;
          assert.deepEqual(installs.map(item => item.id),
            damage.startsWith("runtime") ? ["markitdown", "graphify"] : ["markitdown"]);
          return false;
        },
        runProcess(command, args) {
          if (damage === "package-version" && args[0] === "-c" && args[2] === "markitdown") {
            return { status: 0, stdout: "0.0.0\n" };
          }
          if (args[0] === "--version" &&
              ((damage === "runtime-version" && command === path.join(fixture.root, state.python_runtime.executable)) ||
               (damage === "environment-version" && command.startsWith(scripts)))) {
            return { status: 0, stdout: "Python 3.15.0\n" };
          }
          return run(command, args);
        },
      });
      assert.equal(approvals, 1);
      assert.deepEqual(result.results.map(item => item.status),
        damage.startsWith("runtime") ? ["blocked", "blocked"] : ["blocked", "already-installed"]);
      assert.ok(fixture.calls.every(call => call.args[0] === "--version" || call.args[0] === "-c"));
    });
  }
});

test("explicit skip options preserve installation receipts and do not probe or ask", async t => {
  const fixture = pythonInstaller(t);
  await installCatalogTools(fixture.root, fixture.options);
  const statePath = path.join(fixture.root, ".mcpee", "tools", "installation-state.json");
  const before = fs.readFileSync(statePath, "utf8");
  const result = await installCatalogTools(fixture.root, {
    ...fixture.options,
    skipInstall: true,
    approveInstall: () => { throw new Error("must not ask when skipped"); },
    runProcess: () => { throw new Error("must not probe when skipped"); },
  });
  assert.ok(result.results.every(item => item.status === "skipped"));
  assert.equal(fs.readFileSync(statePath, "utf8"), before);
});

test("skipping Node tools still reports skipped and never asks about installed tools", async t => {
  const fixture = npmInstaller(t);
  await installCatalogTools(fixture.root, fixture.options);
  const result = await installCatalogTools(fixture.root, {
    ...fixture.options,
    skipNodeTools: true,
    approveInstallBatch: () => { throw new Error("must not ask for skipped Node tools"); },
    runProcess: () => { throw new Error("must not probe skipped Node tools"); },
  });
  assert.ok(result.results.every(item => item.status === "skipped"));
});

test("individual repair approval is requested only for the damaged npm tool", async t => {
  const fixture = npmInstaller(t);
  await installCatalogTools(fixture.root, fixture.options);
  const repomix = fixture.definitions.find(item => item.id === "repomix");
  fs.unlinkSync(path.join(fixture.root, ".mcpee", "tools", "npm", "node_modules",
    repomix.installer.package, repomix.installer.entry_point));
  fixture.calls.length = 0;
  const approvals = [];
  const result = await installCatalogTools(fixture.root, {
    ...fixture.options,
    approveInstallBatch: undefined,
    approveInstall: async detail => {
      approvals.push(detail.id);
      return true;
    },
  });
  assert.deepEqual(approvals, ["repomix"]);
  assert.deepEqual(result.results.map(item => item.status), ["already-installed", "installed"]);
  assert.equal(fixture.calls.length, 1);
});

test("Windows runtime rename locks are retried for install and upgrade before installing both tools", {
  skip: process.platform !== "win32",
}, async t => {
  const waits = t.mock.method(Atomics, "wait", () => "timed-out");
  const attempts = { install: 0, upgrade: 0 };
  const fixture = pythonInstaller(t, args => {
    if (++attempts[args[1]] === 1) {
      return { status: 1, stderr: `failed to rename file from runtime\\.temp\\python to runtime\\cpython: (os error ${args[1] === "install" ? 32 : 33})` };
    }
    return { status: 0, stdout: "", stderr: "" };
  });
  const result = await installCatalogTools(fixture.root, fixture.options);
  assert.deepEqual(result.results.map(item => [item.id, item.status]), [
    ["markitdown", "installed"], ["graphify", "installed"],
  ]);
  assert.deepEqual(attempts, { install: 2, upgrade: 2 });
  assert.equal(waits.mock.callCount(), 2);
  assert.equal(result.pythonRuntime.version, "3.14.8");
});

test("a persistent Windows runtime lock is bounded and shared by both Python tools", {
  skip: process.platform !== "win32",
}, async t => {
  const waits = t.mock.method(Atomics, "wait", () => "timed-out");
  let locked = true;
  const fixture = pythonInstaller(t, () => locked
    ? { status: 1, stderr: "failed to rename file from runtime\\.temp\\python to runtime\\cpython: (os error 5)" }
    : { status: 0, stdout: "", stderr: "" });
  const result = await installCatalogTools(fixture.root, fixture.options);
  assert.deepEqual(result.results.map(item => item.status), ["failed", "failed"]);
  assert.equal(result.results[0].reason, result.results[1].reason);
  assert.match(result.results[0].reason, /os error 5.*after 3 attempts/);
  assert.equal(fixture.calls.filter(call => call.args[0] === "python" && call.args[1] === "install").length, 3);
  assert.equal(waits.mock.callCount(), 2);
  assert.equal(result.pythonRuntime, null);
  assert.equal(fixture.calls.some(call => call.args[0] === "pip"), false);
  locked = false;
  const retried = await installCatalogTools(fixture.root, fixture.options);
  assert.deepEqual(retried.results.map(item => item.status), ["installed", "installed"]);
});

test("non-lock runtime failures are not retried or hidden by a second Python tool", async t => {
  const fixture = pythonInstaller(t, () => ({ status: 1, stderr: "download failed: HTTP 403" }));
  const result = await installCatalogTools(fixture.root, fixture.options);
  assert.deepEqual(result.results.map(item => item.status), ["failed", "failed"]);
  assert.ok(result.results.every(item => /HTTP 403/.test(item.reason)));
  assert.equal(fixture.calls.filter(call => call.args[0] === "python" && call.args[1] === "install").length, 1);
  assert.equal(result.pythonRuntime, null);
});

test("pinned Python environments use the same Windows runtime-lock recovery", {
  skip: process.platform !== "win32",
}, t => {
  t.mock.method(Atomics, "wait", () => "timed-out");
  let attempts = 0;
  const fixture = pythonInstaller(t, () => ++attempts === 1
    ? { status: 1, stderr: "failed to rename file: (os error 32)" }
    : { status: 0, stdout: "", stderr: "" });
  const result = installPythonEnvironment(fixture.root, "fixture", "3.14", ["markitdown==0.1.8"], fixture.options);
  assert.equal(attempts, 2);
  assert.equal(result.python_version, "3.14");
  assert.deepEqual(result.packages, ["markitdown==0.1.8"]);
});

test("a Python package failure does not block the other tool when their shared runtime is healthy", async t => {
  const fixture = pythonInstaller(t);
  const run = fixture.options.runProcess;
  fixture.options.runProcess = (command, args) =>
    args[0] === "pip" && args.at(-1).startsWith("markitdown")
      ? { status: 1, stderr: "fixture package failure" }
      : run(command, args);
  const result = await installCatalogTools(fixture.root, fixture.options);
  assert.deepEqual(result.results.map(item => item.status), ["failed", "installed"]);
  assert.equal(result.results[0].reason, "fixture package failure");
  assert.equal(fixture.calls.filter(call => call.args[0] === "python" && call.args[1] === "install").length, 1);
});

test("packaged CLI validation allows cold imports without changing runtime probes or explicit overrides", async t => {
  const fixture = pythonInstaller(t);
  await installCatalogTools(fixture.root, fixture.options);
  const codegraph = path.join(fixture.root, ".mcpee/tools/npm/node_modules/@colbymchenry");
  fs.mkdirSync(path.join(codegraph, "codegraph"), { recursive: true });
  fs.writeFileSync(path.join(codegraph, "codegraph/npm-shim.js"), "fixture");
  fs.mkdirSync(path.join(codegraph, `codegraph-${process.platform}-${process.arch}`));
  for (const [id, timeoutMs, expected] of [
    ["markitdown", undefined, 120_000],
    ["graphify", undefined, 120_000],
    ["codegraph", undefined, 30_000],
    ["node", undefined, 3000],
    ["markitdown", 250, 250],
  ]) {
    let invocations = 0;
    const result = validateTool(fixture.root, id, {
      timeoutMs,
      runProcess(_command, _args, options) {
        invocations += 1;
        assert.equal(options.timeout, expected);
        assert.equal(options.shell, false);
        return { status: 0, stdout: "fixture help", stderr: "" };
      },
    });
    assert.equal(invocations, 1);
    assert.equal(result.validation, "passed");
    if (id !== "node") assert.ok(result.executable.startsWith(`${fixture.root}${path.sep}`));
  }
});
