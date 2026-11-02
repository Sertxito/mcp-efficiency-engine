"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  acquireSession, createSessionRecord, hash, promptIdentity, updateSession,
} = require("../packages/execution-engine/src/recoverable-sessions");

const sessionId = "30000000-0000-4000-8000-000000000001";
const task = "Inspect the service";
const route = { workflow_id: "resolve-bug", agent_id: "debugger", model: "auto" };
const promptHash = hash("stable execution prompt");
const executionHash = hash(JSON.stringify({
  task_sha256: hash(task), workflow_id: route.workflow_id, agent_id: route.agent_id,
  prompt_sha256: promptHash, model: route.model,
}));

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-resumable-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function create(root) {
  return createSessionRecord(root, {
    session_id: sessionId, task_sha256: hash(task), execution_sha256: executionHash,
    ...route, trace_id: crypto.randomUUID(), changed_paths: [],
  });
}

function prompt(generatedAt, sourceHash = "a".repeat(64)) {
  return "Task:\nInspect the service\n\nMCPEE routing plan (context, not authorization to make changes):\n\n" +
    JSON.stringify({ impact_preflight: { targets: [{ generated_at: generatedAt, path: "src/app.js", sha256: sourceHash }] } }, null, 2) +
    "\n\nExecute the selected workflow \"resolve-bug\".\n\nExact source content is unchanged.";
}

test("resume prompt identity ignores only graph refresh dates, not content or instructions", () => {
  const original = prompt("2026-01-01");
  assert.equal(promptIdentity(original), promptIdentity(prompt("2026-01-02")));
  assert.notEqual(promptIdentity(original), promptIdentity(prompt("2026-01-02", "b".repeat(64))));
  assert.notEqual(promptIdentity(original), promptIdentity(prompt("2026-01-02") + "\nChanged instructions."));
  assert.equal(promptIdentity("ordinary prompt"), hash("ordinary prompt"));
});

test("legacy interrupted sessions resume across graph refresh only with hash-verified original prompt evidence", t => {
  const root = project(t), original = prompt("2026-01-01");
  const journal = createSessionRecord(root, {
    session_id: sessionId, task_sha256: hash(task),
    execution_sha256: hash(JSON.stringify({
      task_sha256: hash(task), workflow_id: route.workflow_id, agent_id: route.agent_id,
      prompt_sha256: hash(original), model: route.model,
    })),
    ...route, trace_id: crypto.randomUUID(),
  });
  updateSession(journal, "interrupted");
  require("../packages/core/src/telemetry").recordEvent(root, {
    event_name: "copilot.execution.started", trace_id: journal.record.trace_id, session_id: sessionId,
    payload: { prompt: original },
  });
  const changed = prompt("2026-01-02", "b".repeat(64));
  assert.throws(() => acquireSession(root, sessionId, {
    task, ...route, prompt_sha256: promptIdentity(changed), prompt: changed,
  }), /differs from the interrupted execution/);
  const refreshed = prompt("2026-01-02");
  const lease = acquireSession(root, sessionId, {
    task, ...route, prompt_sha256: promptIdentity(refreshed), prompt: refreshed,
  });
  assert.equal(lease.record.status, "resuming");
  lease.release();
});

test("resumable session journal records interruption, accumulates paths and closes on completion", t => {
  const root = project(t);
  const journal = create(root);
  assert.equal(journal.record.status, "running");

  updateSession(journal, "interrupted", {
    changed_paths: ["src/first.js"], error: "interrupted with token=secret",
  });
  const lease = acquireSession(root, sessionId, {
    task, ...route, prompt_sha256: promptHash,
  });
  assert.equal(lease.record.status, "resuming");
  assert.equal(lease.record.attempts, 1);
  assert.deepEqual(lease.record.changed_paths, ["src/first.js"]);
  lease.release();

  updateSession(lease, "completed", { changed_paths: ["src/second.js"] });
  const persisted = JSON.parse(fs.readFileSync(journal.filename, "utf8"));
  assert.equal(persisted.status, "completed");
  assert.deepEqual(persisted.changed_paths, ["src/first.js", "src/second.js"]);
  assert.doesNotMatch(persisted.last_error, /secret/);
  assert.throws(() => acquireSession(root, sessionId, {
    task, ...route, prompt_sha256: promptHash,
  }), /cannot resume/);
});

test("resumable session refuses changed task or route before acquisition", t => {
  const root = project(t);
  const journal = create(root);
  updateSession(journal, "interrupted");
  assert.throws(() => acquireSession(root, sessionId, {
    task: "Different task", ...route, prompt_sha256: promptHash,
  }), /differs from the interrupted execution/);
  assert.throws(() => acquireSession(root, sessionId, {
    task, ...route, agent_id: "different-agent", prompt_sha256: promptHash,
  }), /differs from the interrupted execution/);
});

test("resumable session rejects a live owner and serializes concurrent recovery", t => {
  const root = project(t);
  const journal = create(root);
  assert.throws(() => acquireSession(root, sessionId, {
    task, ...route, prompt_sha256: promptHash,
  }), /owner may still be running/);

  updateSession(journal, "interrupted");
  const first = acquireSession(root, sessionId, {
    task, ...route, prompt_sha256: promptHash,
  });
  assert.throws(() => acquireSession(root, sessionId, {
    task, ...route, prompt_sha256: promptHash,
  }), /Another process may be resuming/);
  first.release();
});

test("resumable session validates UUIDs and rejects symlink records", t => {
  const root = project(t);
  assert.throws(() => createSessionRecord(root, {
    session_id: "not-a-uuid", task_sha256: hash(task), execution_sha256: executionHash,
    ...route,
  }), /valid SDK session UUID/);
  const directory = path.join(root, ".mcpee", "state", "resumable-sessions");
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(root, "outside.json");
  fs.writeFileSync(target, "{}");
  try {
    fs.symlinkSync(target, path.join(directory, `${sessionId}.json`));
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip("Symlink creation is not permitted by this Windows environment.");
      return;
    }
    throw error;
  }
  assert.throws(() => acquireSession(root, sessionId, {
    task, ...route, prompt_sha256: promptHash,
  }), /symbolic links/);
});
