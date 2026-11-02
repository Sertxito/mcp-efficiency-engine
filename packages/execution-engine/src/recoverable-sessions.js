"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { redact, readEvents } = require("../../core/src/telemetry");
const { renameAtomicSync } = require("../../core/src/atomic-file");

const DIRECTORY = ".mcpee/state/resumable-sessions";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function promptIdentity(prompt) {
  const marker = "MCPEE routing plan (context, not authorization to make changes):\n\n";
  const start = prompt.indexOf(marker);
  const end = prompt.indexOf("\n\nExecute the selected workflow", start + marker.length);
  if (start < 0 || end < 0) return hash(prompt);
  const context = JSON.parse(prompt.slice(start + marker.length, end));
  for (const target of context.impact_preflight?.targets || []) delete target.generated_at;
  return hash(prompt.slice(0, start + marker.length) + JSON.stringify(context) + prompt.slice(end));
}

function sessionFile(root, sessionId) {
  if (!UUID.test(sessionId)) throw new Error("Resume requires a valid SDK session UUID.");
  return path.join(root, DIRECTORY, `${sessionId}.json`);
}

function readSession(root, sessionId) {
  const filename = sessionFile(root, sessionId);
  let current = root;
  for (const segment of path.relative(root, filename).split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) throw new Error(`No resumable MCPEE session is recorded for ${sessionId}.`);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("Resumable session state cannot follow symbolic links.");
  }
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > 64 * 1024) throw new Error("Resumable session record is not a bounded regular file.");
  let record;
  try { record = JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch (error) { throw new Error(`Resumable session record is invalid: ${error.message}`); }
  if (record.schema_version !== 1 || record.generated_by !== "mcpee" ||
      record.session_id !== sessionId || !["running", "interrupted", "resuming", "completed"].includes(record.status) ||
      !/^[a-f0-9]{64}$/.test(record.task_sha256) ||
      !/^[a-f0-9]{64}$/.test(record.execution_sha256) ||
      typeof record.workflow_id !== "string" || typeof record.agent_id !== "string" ||
      typeof record.model !== "string" ||
      (["running", "resuming"].includes(record.status) &&
        (!Number.isInteger(record.owner_pid) || record.owner_pid <= 0)) ||
      !Array.isArray(record.changed_paths) ||
      record.changed_paths.some(item => typeof item !== "string" || path.isAbsolute(item) ||
        item.split(/[\\/]/).includes(".."))) {
    throw new Error("Resumable session record failed its schema and scope checks.");
  }
  return { filename, record };
}

function writeSession(filename, record) {
  const temporary = `${filename}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({
      ...record, updated_at: new Date().toISOString(),
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameAtomicSync(temporary, filename);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

function createSessionRecord(root, input) {
  if (!/^[a-f0-9]{64}$/.test(input.task_sha256) ||
      !/^[a-f0-9]{64}$/.test(input.execution_sha256) ||
      typeof input.workflow_id !== "string" || typeof input.agent_id !== "string" ||
      typeof input.model !== "string") {
    throw new Error("Cannot record an SDK session without complete execution identity hashes and route metadata.");
  }
  const changedPaths = [...new Set(input.changed_paths || [])].sort();
  if (changedPaths.some(item => typeof item !== "string" || item.includes("\0") ||
      path.isAbsolute(item) || item.split(/[\\/]/).includes(".."))) {
    throw new Error("Resumable session changes must use safe project-relative paths.");
  }
  const directory = path.join(root, DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  let current = root;
  for (const segment of DIRECTORY.split("/")) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) {
      throw new Error("Resumable session directory must be project-local and non-symbolic.");
    }
  }
  const filename = sessionFile(root, input.session_id);
  const record = {
    schema_version: 1, generated_by: "mcpee", session_id: input.session_id,
    status: "running", task_sha256: input.task_sha256,
    execution_sha256: input.execution_sha256, workflow_id: input.workflow_id,
    agent_id: input.agent_id, model: input.model, trace_id: input.trace_id,
    changed_paths: changedPaths,
    attempts: 0, owner_pid: process.pid,
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(filename, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { filename, record };
}

function acquireSession(root, sessionId, input) {
  const { filename, record } = readSession(root, sessionId);
  const lock = `${filename}.lock`;
  let descriptor;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const lockStat = fs.lstatSync(lock);
    if (lockStat.isSymbolicLink() || !lockStat.isFile()) {
      throw new Error("Resume admission lock is not a regular project-local file.");
    }
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(lock, "utf8")); } catch {}
    if (!owner || !Number.isInteger(owner.pid)) throw new Error("Resume admission lock is corrupt; inspect it before recovery.");
    try {
      process.kill(owner.pid, 0);
      throw new Error("Another process may be resuming this SDK session; recovery is blocked.");
    } catch (probe) {
      if (probe.code !== "ESRCH") throw probe;
    }
    fs.unlinkSync(lock);
    descriptor = fs.openSync(lock, "wx", 0o600);
  }
  fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, session_id: sessionId }));
  const lockIdentity = fs.fstatSync(descriptor);
  const release = () => {
    fs.closeSync(descriptor);
    if (fs.existsSync(lock)) {
      const currentLock = fs.lstatSync(lock);
      if (!currentLock.isSymbolicLink() && currentLock.dev === lockIdentity.dev &&
          currentLock.ino === lockIdentity.ino) fs.unlinkSync(lock);
    }
  };
  try {
    if (record.status === "running" || record.status === "resuming") {
      try {
        process.kill(record.owner_pid, 0);
        throw new Error("The recorded SDK session owner may still be running; automatic takeover is denied.");
      } catch (probe) {
        if (probe.code !== "ESRCH") throw probe;
      }
      record.status = "interrupted";
    }
    if (record.status !== "interrupted") {
      throw new Error(`SDK session cannot resume from status '${record.status}'.`);
    }
    const expectedTask = hash(input.task);
    const expectedExecution = hash(JSON.stringify({
      task_sha256: expectedTask, workflow_id: input.workflow_id, agent_id: input.agent_id,
      prompt_sha256: input.prompt_sha256, model: input.model,
    }));
    const sameTask = record.task_sha256 === expectedTask && record.workflow_id === input.workflow_id &&
      record.agent_id === input.agent_id && record.model === input.model;
    let sameExecution = record.execution_sha256 === expectedExecution;
    if (sameTask && !sameExecution && typeof input.prompt === "string") {
      const original = readEvents(root).find(event => event.event_name === "copilot.execution.started" &&
        event.session_id === sessionId && event.trace_id === record.trace_id && typeof event.payload?.prompt === "string");
      if (original) {
        const originalExecution = hash(JSON.stringify({
          task_sha256: expectedTask, workflow_id: input.workflow_id, agent_id: input.agent_id,
          prompt_sha256: hash(original.payload.prompt), model: input.model,
        }));
        sameExecution = record.execution_sha256 === originalExecution &&
          promptIdentity(original.payload.prompt) === input.prompt_sha256;
      }
    }
    if (!sameTask || !sameExecution) {
      throw new Error("Resume task, route, model or selected context differs from the interrupted execution; no SDK session was resumed.");
    }
    record.status = "resuming";
    record.owner_pid = process.pid;
    record.attempts += 1;
    writeSession(filename, record);
    return { filename, record, release };
  } catch (error) {
    release();
    throw error;
  }
}

function updateSession(lease, status, details = {}) {
  if (!["interrupted", "completed"].includes(status) || lease.record.status === "completed") {
    throw new Error(`Invalid resumable session status transition to '${status}'.`);
  }
  const changed = details.changed_paths || [];
  if (!Array.isArray(changed) || changed.some(item => typeof item !== "string" ||
      item.includes("\0") || path.isAbsolute(item) || item.split(/[\\/]/).includes(".."))) {
    throw new Error("Resumable session changes must use safe project-relative paths.");
  }
  lease.record.status = status;
  lease.record.owner_pid = process.pid;
  lease.record.changed_paths = [...new Set([
    ...lease.record.changed_paths, ...changed,
  ])].sort();
  if (details.error) lease.record.last_error = redact(details.error);
  if (details.response_sha256) lease.record.response_sha256 = details.response_sha256;
  writeSession(lease.filename, lease.record);
}

module.exports = {
  acquireSession, createSessionRecord, hash, promptIdentity, updateSession, readSession,
};
