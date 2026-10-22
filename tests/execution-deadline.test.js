"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createExecutionDeadline } = require("../packages/execution-engine/src/execution-deadline");
const { runCopilotTask } = require("../packages/execution-engine/src/copilot");

function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const deadline = createExecutionDeadline({ activeMs: 100, wallMs: 500 });
  t.after(() => deadline.dispose());
  return deadline;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("execution deadline enforces the active budget without approvals", async t => {
  const deadline = setup(t);
  const failure = assert.rejects(deadline.start(), /100ms of active time/);
  t.mock.timers.tick(100);
  await failure;
});

test("approval waits pause, then resume only the remaining active budget", async t => {
  const deadline = setup(t);
  let expired = false;
  const failure = assert.rejects(deadline.start(), /100ms of active time/)
    .then(() => { expired = true; });
  t.mock.timers.tick(60);
  const decision = deferred();
  const approval = deadline.waitForApproval(() => decision.promise);
  t.mock.timers.tick(200);
  decision.resolve(true);
  assert.equal(await approval, true);
  t.mock.timers.tick(39);
  await Promise.resolve();
  assert.equal(expired, false);
  t.mock.timers.tick(1);
  await failure;
});

test("overlapping approvals pause once until the last decision", async t => {
  const deadline = setup(t);
  const failure = assert.rejects(deadline.start(), /100ms of active time/);
  t.mock.timers.tick(30);
  const first = deferred();
  const second = deferred();
  const approvalA = deadline.waitForApproval(() => first.promise);
  t.mock.timers.tick(100);
  const approvalB = deadline.waitForApproval(() => second.promise);
  first.resolve(false);
  assert.equal(await approvalA, false);
  t.mock.timers.tick(100);
  second.resolve(true);
  assert.equal(await approvalB, true);
  t.mock.timers.tick(70);
  await failure;
});

test("total deadline expires during an approval and rejects a late approval", async t => {
  const deadline = setup(t);
  const failure = assert.rejects(deadline.start(), /500ms total deadline/);
  const decision = deferred();
  const approval = deadline.waitForApproval(() => decision.promise);
  const lateApproval = assert.rejects(approval, /500ms total deadline/);
  t.mock.timers.tick(500);
  await failure;
  decision.resolve(true);
  await lateApproval;
});

test("approval errors remain errors and resume the active deadline", async t => {
  const deadline = setup(t);
  const failure = assert.rejects(deadline.start(), /100ms of active time/);
  const error = new Error("approval disconnected");
  await assert.rejects(deadline.waitForApproval(() => { throw error; }), actual => actual === error);
  t.mock.timers.tick(100);
  await failure;
});

test("disposal prevents late approvals from rearming timers or authorizing actions", async t => {
  const deadline = setup(t);
  let expired = false;
  deadline.start().catch(() => { expired = true; });
  const decision = deferred();
  const approval = deadline.waitForApproval(() => decision.promise);
  deadline.dispose();
  decision.resolve(true);
  await assert.rejects(approval, /already ended/);
  t.mock.timers.tick(1000);
  assert.equal(expired, false);
  await assert.rejects(deadline.waitForApproval(() => true), /already ended/);
});

test("execution deadlines validate limits and cannot restart", t => {
  for (const limits of [{ activeMs: 0 }, { activeMs: 1.2 }, { activeMs: 100, wallMs: 90 }]) {
    assert.throws(() => createExecutionDeadline(limits), /positive integer/);
  }
  const deadline = setup(t);
  deadline.start();
  assert.throws(() => deadline.start(), /only start once/);
});

test("Copilot pauses its active budget for both approval surfaces", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-deadline-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let reviews = 0;
  const client = {
    async start() {},
    async createSession(config) {
      return {
        sessionId: "approval-deadline-test",
        async sendAndWait(message, timeoutMs) {
          assert.equal(timeoutMs, 1_800_000);
          const permission = await config.onPermissionRequest(
            { kind: "shell", fullCommandText: "npm test", intention: "Run local tests" },
            { sessionId: this.sessionId },
          );
          assert.equal(permission.kind, "approved");
          const hook = await config.hooks.onPreToolUse(
            { toolName: "powershell", toolArgs: { command: "npm test" } },
            { sessionId: this.sessionId },
          );
          assert.equal(hook.permissionDecision, "allow");
          return { data: { content: "Completed after human approvals." } };
        },
        async disconnect() {},
      };
    },
    async stop() {},
  };
  const approve = async () => {
    reviews += 1;
    t.mock.timers.tick(660_000);
    return true;
  };
  const result = await runCopilotTask(root, "Test the approval deadline", {
    workflow: { id: "resolve-bug" }, agent: { id: "debugger" },
    impact_preflight: { status: "ready", targets: [] },
  }, {
    approved: true, interactive: true,
    impactPreflight: { status: "ready", targets: [] },
    approveTool: approve, approvePermission: approve,
    clientFactory: () => client,
  });
  assert.equal(reviews, 2);
  assert.equal(result.content, "Completed after human approvals.");
});

test("Copilot aborts on its active deadline and on host cancellation during approval", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-deadline-abort-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const mode of ["active-timeout", "cancel-approval"]) {
    const calls = [];
    const controller = new AbortController();
    const reason = new Error("host cancelled while waiting for approval");
    const client = {
      async start() {},
      async createSession(config) {
        return {
          sessionId: mode,
          async sendAndWait() {
            if (mode === "active-timeout") t.mock.timers.tick(600_000);
            else await config.onPermissionRequest({ kind: "write", fileName: "worker.cjs" },
              { sessionId: this.sessionId });
            return new Promise(() => {});
          },
          async abort() { calls.push("abort"); },
          async disconnect() { calls.push("disconnect"); },
        };
      },
      async stop() { calls.push("stop"); },
    };
    await assert.rejects(runCopilotTask(root, "Inspect the fixture", {
      workflow: { id: "resolve-bug" }, agent: { id: "debugger" },
    }, {
      approved: true, interactive: true, signal: controller.signal,
      approvePermission: async () => {
        controller.abort(reason);
        return new Promise(() => {});
      },
      clientFactory: () => client,
    }), error => mode === "active-timeout"
      ? error.code === "MCPEE_EXECUTION_TIMEOUT"
      : error === reason);
    assert.deepEqual(calls, ["abort", "disconnect", "stop"]);
  }
});
