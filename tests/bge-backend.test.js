"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { BGE_PACKAGES, runBgeIndexBackend } = require("../packages/source-engine/src/embeddings");

function backendFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-index-runner-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const environment = ".mcpee/tools/python/bge_embeddings/3.12";
  const python = path.join(root, environment, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, "");
  fs.writeFileSync(path.join(root, ".mcpee/tools/installation-state.json"), JSON.stringify({
    generated_by: "mcpee", tools: { bge_embeddings: {
      environment, packages: BGE_PACKAGES, python_version: "3.12",
    } },
  }));
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; child.emit("close", null); };
  return { root, child };
}

test("BGE backend persists checkpoints, validates ownership and releases interrupted locks", t => {
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(python, [path.join(__dirname, "bge_backend_test.py")], {
    encoding: "utf8", timeout: 20_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.error?.code === "ENOENT") return t.skip("Python is unavailable for the standard-library backend tests.");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran 5 tests/);
});

test("BGE pipes force strict UTF-8 instead of inheriting the Windows locale", async t => {
  for (const [key, value] of Object.entries({ PYTHONUTF8: "0", PYTHONIOENCODING: "cp1252:surrogateescape" })) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
    process.env[key] = value;
  }
  const { root, child } = backendFixture(t);
  const result = runBgeIndexBackend(root, { action: "index", query: "Espa\u00f1ol \u0141 \u4e2d\u6587 \u{1f680}" }, {
    spawnProcess: (python, args, options) => {
      assert.equal(options.env.PYTHONUTF8, "1");
      assert.equal(options.env.PYTHONIOENCODING, "utf-8:strict");
      return child;
    },
  });
  child.stdout.write(JSON.stringify({ query: "Espa\u00f1ol \u0141 \u4e2d\u6587 \u{1f680}" }));
  child.emit("close", 0);
  assert.deepEqual(await result, { query: "Espa\u00f1ol \u0141 \u4e2d\u6587 \u{1f680}" });
});

test("index timeout follows measured progress rather than total wall time", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { root, child } = backendFixture(t);
    const events = [];
    const result = runBgeIndexBackend(root, { action: "index" }, {
      spawnProcess: () => child, idleTimeoutMs: 1000, onProgress: event => events.push(event),
    });
    for (let index = 0; index < 4; index++) {
      t.mock.timers.tick(900);
      child.stderr.write(`mcpee-bge-progress:${JSON.stringify({ phase: "encoding", completed: index })}\n`);
    }
    assert.equal(child.killed, undefined);
    child.stdout.write('{"chunk_count":4}');
    child.emit("close", 0);
    assert.deepEqual(await result, { chunk_count: 4 });
    assert.equal(events.length, 4);
});

test("stalled indexing is stopped explicitly and never becomes a successful result", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { root, child } = backendFixture(t);
    const result = runBgeIndexBackend(root, { action: "index" }, {
      spawnProcess: () => child, idleTimeoutMs: 1000,
    });
    const rejection = assert.rejects(result, /no progress.*cached/);
    t.mock.timers.tick(1001);
    await rejection;
    assert.equal(child.killed, true);
});

test("invalid progress fails explicitly and stops the backend", async t => {
  const { root, child } = backendFixture(t);
  const result = runBgeIndexBackend(root, { action: "index" }, { spawnProcess: () => child });
  const rejection = assert.rejects(result, /Invalid BGE-M3 progress event/);
  child.stderr.write("mcpee-bge-progress:invalid-json\n");
  await rejection;
  assert.equal(child.killed, true);
});

test("cancellation stops the backend and removes signal handlers", async t => {
  const { root, child } = backendFixture(t);
  const before = process.listenerCount("SIGINT");
  const result = runBgeIndexBackend(root, { action: "index" }, { spawnProcess: () => child });
  const rejection = assert.rejects(result, /indexing cancelled.*cached/);
  process.emit("SIGINT");
  await rejection;
  assert.equal(child.killed, true);
  assert.equal(process.listenerCount("SIGINT"), before);
});
