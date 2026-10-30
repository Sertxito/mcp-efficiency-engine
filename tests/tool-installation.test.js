"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { installCatalogTools, installPythonEnvironment, validateTool } = require("../packages/tool-manager/src/tools");

function pythonInstaller(t, runtimeResult = () => ({ status: 0, stdout: "", stderr: "" })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-python-install-"));
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
      if (command === python && args[0] === "--version") {
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
    ["markitdown", undefined, 30_000],
    ["graphify", undefined, 30_000],
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
