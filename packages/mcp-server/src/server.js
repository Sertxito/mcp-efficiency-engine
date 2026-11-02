"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { recordEvent, redact } = require("../../core/src/telemetry");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { renameAtomicSync } = require("../../core/src/atomic-file");

const MAX_APPROVAL_BYTES = 64 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
const RUN_STATE_DIRECTORY = ".mcpee/state/runs";
const runProgressSchema = z.object({
  stage: z.enum(["specification", "plan", "tasks", "indexing", "brownfield"]),
  status: z.enum(["authoring", "repairing", "validated", "indexing"]),
  attempt: z.number().int().min(1).max(3), updated_at: z.string(),
  trace_id: z.string().uuid(),
  completed: z.number().int().nonnegative().optional(),
  total: z.number().int().positive().max(5000).optional(),
  scope: z.string().regex(/^brownfield-[a-z0-9-]+$/).max(150).optional(),
  failed: z.number().int().nonnegative().optional(),
  active: z.number().int().nonnegative().optional(),
  pending: z.number().int().nonnegative().optional(),
  concurrency: z.number().int().min(0).max(10).optional(),
  elapsed_ms: z.number().int().nonnegative().optional(),
  last_activity_at: z.string().optional(),
}).strict().refine(progress => progress.stage !== "brownfield" ||
  progress.completed !== undefined && progress.total !== undefined &&
  progress.completed <= progress.total && progress.scope !== undefined &&
  (progress.failed === undefined || progress.completed + progress.failed <= progress.total),
"Brownfield progress requires a bounded scope count and current scope.");
const runStateSchema = z.object({
  schema_version: z.literal(1), generated_by: z.literal("mcpee"),
  run_id: z.string().uuid(), owner_pid: z.number().int().positive(),
  child_pid: z.number().int().positive().nullable(),
  started_at: z.number().int().nonnegative(), updated_at: z.number().int().nonnegative(),
  task_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  trace_id: z.string().uuid().nullable(),
  status: z.enum(["running", "cancelling", "completed", "failed", "cancelled"]),
  progress: runProgressSchema.nullable(),
  result: z.object({
    isError: z.boolean(),
    content: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()).min(1),
  }).strict().nullable(),
}).strict().refine(state => ["running", "cancelling"].includes(state.status)
  ? state.result === null : state.result !== null &&
    state.result.isError === (state.status !== "completed"), "Run status must agree with its terminal result.");

function runStateDirectory(root, create = false) {
  let current = root;
  for (const segment of RUN_STATE_DIRECTORY.split("/")) {
    current = path.join(current, segment);
    if (create && !fsExists(current)) {
      try { fs.mkdirSync(current); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    if (fsExists(current) && (!fs.lstatSync(current).isDirectory() || fs.lstatSync(current).isSymbolicLink())) {
      throw new Error("MCPEE run state must use real project-local directories, not symbolic links.");
    }
  }
  return current;
}

function readRunState(root, runId) {
  if (!z.string().uuid().safeParse(runId).success) throw new Error("Invalid MCPEE run_id.");
  const filename = path.join(runStateDirectory(root), `${runId}.json`);
  if (!fsExists(filename)) return null;
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 24 * 1024 * 1024) {
    throw new Error("MCPEE run state is not a bounded regular file.");
  }
  const state = runStateSchema.parse(JSON.parse(fs.readFileSync(filename, "utf8")));
  if (state.run_id !== runId) throw new Error("MCPEE run state identifier does not match its filename.");
  return state;
}

function writeRunState(root, state) {
  const content = `${JSON.stringify(runStateSchema.parse(redact(state)), null, 2)}\n`;
  if (Buffer.byteLength(content) > 24 * 1024 * 1024) throw new Error("MCPEE run state exceeded its size limit.");
  const directory = runStateDirectory(root, true);
  const filename = path.join(directory, `${state.run_id}.json`);
  if (fsExists(filename) && fs.lstatSync(filename).isSymbolicLink()) throw new Error("Refusing to replace linked MCPEE run state.");
  const temporary = path.join(directory, `${state.run_id}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    renameAtomicSync(temporary, filename);
  } finally {
    if (fsExists(temporary)) fs.unlinkSync(temporary);
  }
}

function processIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

function admitRun(root, task) {
  const directory = runStateDirectory(root, true);
  const lock = path.join(directory, "admission.lock");
  let descriptor;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      return { blocked: "MCPEE run admission is locked by another server. Retry status instead of starting work. If the lock survives a crash, inspect owner/process and run journals before explicitly removing admission.lock; no stale lock is silently stolen." };
    }
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ generated_by: "mcpee", owner_pid: process.pid, created_at: new Date().toISOString() }));
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".json"))) {
      const state = readRunState(root, name.slice(0, -5));
      if (!state.result && (processIsAlive(state.owner_pid) || processIsAlive(state.child_pid))) {
        return { blocked: `An MCPEE execution may still be active (${state.run_id}). Retrieve its durable status and inspect its owning server; no duplicate work was started.` };
      }
    }
    const state = {
      schema_version: 1, generated_by: "mcpee", run_id: crypto.randomUUID(), owner_pid: process.pid, child_pid: null,
      started_at: Date.now(), updated_at: Date.now(),
      task_sha256: crypto.createHash("sha256").update(task).digest("hex"),
      trace_id: crypto.randomUUID(), status: "running", progress: null, result: null,
    };
    writeRunState(root, state);
    return { state };
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

function persistedRunResult(state, cancel) {
  if (state.result) return state.result;
  const ownerAlive = processIsAlive(state.owner_pid);
  const childAlive = processIsAlive(state.child_pid);
  return {
    isError: !ownerAlive || cancel,
    content: [{ type: "text", text: JSON.stringify({
      status: ownerAlive ? state.status : "interrupted",
      run_id: state.run_id, trace_id: state.trace_id,
      elapsed_ms: Math.max(0, (ownerAlive ? Date.now() : state.updated_at) - state.started_at),
      progress: state.progress, owner_alive: ownerAlive, child_may_be_running: childAlive,
      poll_after_ms: ownerAlive ? 20_000 : null,
      next_action: cancel
        ? "This server does not own the live execution and cannot safely cancel it. Use its owning MCP server; no PID was killed and no task was replayed."
        : ownerAlive
        ? "Retrieve this same run_id after poll_after_ms. Another server owns the execution; no duplicate task was started."
        : "The owning server stopped before a terminal result was persisted. Inspect this trace and changed files, and recover saved authoring candidates with mcpee specs recover. Do not claim completion or automatically replay the task.",
    }) }],
  };
}

function approvalMessage(kind, details) {
  if (kind === "project-data-transfer") {
    return [
      "Send the task and selected local project evidence to GitHub Copilot?",
      `Workflow: ${details.workflow}; agent: ${details.agent}.`,
      `Memory entries: ${details.memory_count}; knowledge sources: ${details.knowledge_source_count}; CodeGraph matches: ${details.codegraph_match_count}.`,
      `Context: ${details.context_kind}; retrieval: ${details.context_retrieval || "routing summary"}; approximately ${details.estimated_tokens ?? "unknown"} tokens.`,
      `Selected sources:\n${(details.selected_sources || []).map((source) => `- ${source}`).join("\n") || "- None"}`,
    ].join("\n\n");
  }
  if (kind === "copilot-tool") {
    return [
      "Approve this Copilot tool call once?",
      `Tool: ${details.tool || "unknown"}`,
      `Arguments:\n${details.arguments || "{}"}`,
      `Impact:\n${Array.isArray(details.impact) ? details.impact.join("\n") : "No indexed impact evidence."}`,
      `Reason: ${details.reason || "No reason provided."}`,
    ].join("\n\n");
  }
  if (kind === "copilot-permission") {
    return [
      "Approve this Copilot runtime permission once?",
      `Permission: ${details.permission_kind || "unknown"}.`,
      details.description || "",
    ].filter(Boolean).join("\n\n");
  }
  if (kind === "maintenance") {
    return [
      details.description || "Authorize a local project maintenance operation?",
      `Action: ${details.action || "unknown"}.`,
    ].join("\n\n");
  }
  if (kind === "workflow-step") {
    return [
      "Approve this validation invocation once?",
      `${details.action || "action"} "${details.label || "unnamed check"}"`,
      `Tool: ${details.tool || "unknown"} ${Array.isArray(details.args) ? details.args.join(" ") : ""}`,
      `Reason: ${details.reason || "No reason provided."}`,
    ].join("\n\n");
  }
  throw new Error(`Unsupported approval request: ${kind}`);
}

async function requestApprovalFromMcp(client, kind, details, signal) {
  signal?.throwIfAborted();
  const capabilities = client.server.getClientCapabilities();
  if (!capabilities?.elicitation?.form) {
    throw new Error("This MCP host does not support interactive approvals. MCPEE denied the action.");
  }
  const result = await client.server.elicitInput({
    mode: "form",
    message: approvalMessage(kind, details).slice(0, 12_000),
    requestedSchema: {
      type: "object",
      properties: {
        decision: {
          type: "string",
          title: "Decision",
          enum: ["approve", "deny"],
        },
      },
      required: ["decision"],
    },
  }, { timeout: 600_000, signal });
  if (result.action !== "accept") return false;
  return result.content?.decision === undefined || result.content.decision === "approve";
}

function createApprovalBroker(approve) {
  const token = crypto.randomBytes(32).toString("hex");
  const server = http.createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "POST" || request.url !== "/approve") {
      send(404, { approved: false });
      return;
    }
    const authorization = request.headers.authorization || "";
    const supplied = Buffer.from(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      send(401, { approved: false });
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_APPROVAL_BYTES) {
          send(413, { approved: false });
          request.destroy();
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body.kind !== "string" ||
          !body.details || typeof body.details !== "object" || Array.isArray(body.details)) {
        send(400, { approved: false });
        return;
      }
      send(200, { approved: await approve(body.kind, body.details) });
    } catch (error) {
      process.stderr.write(`[mcpee] MCP approval request failed: ${error.message}\n`);
      if (!response.headersSent) send(400, { approved: false });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        token,
        url: `http://127.0.0.1:${address.port}/approve`,
        close() {
          server.close();
          server.closeAllConnections?.();
        },
      });
    });
  });
}

function extractResult(stdout, marker) {
  const line = stdout.split(/\r?\n/).findLast((entry) => entry.startsWith(marker));
  if (!line) return null;
  try {
    const result = JSON.parse(line.slice(marker.length));
    return typeof result.content === "string" ? result.content : null;
  } catch {
    return null;
  }
}

function runCopilotCli({
  projectRoot,
  packageRoot,
  task,
  approve,
  spawnProcess = spawn,
  signal,
  traceId,
  parentEventId,
  onProgress,
  onStarted,
  feature,
  through,
}) {
  const cliEntrypoint = path.join(packageRoot, "packages", "cli", "bin", "mcpee.js");
  const marker = `__MCPEE_CHAT_RESULT_${crypto.randomBytes(16).toString("hex")}__`;
  const effectiveTraceId = traceId || crypto.randomUUID();
  let child;
  let cancellation;
  let cancellationTimer;
  let broker;
  let progressFailure;

  return (async () => {
    broker = await createApprovalBroker(approve);
    const environment = {
      ...process.env,
      MCPEE_APPROVAL_BROKER_URL: broker.url,
      MCPEE_APPROVAL_BROKER_TOKEN: broker.token,
      MCPEE_CHAT_RESULT_MARKER: marker,
      MCPEE_MCP_TASK_AUTHORIZED: "1",
      MCPEE_TRACE_ID: effectiveTraceId,
      MCPEE_PARENT_EVENT_ID: parentEventId,
    };
    child = spawnProcess(process.execPath, [
      cliEntrypoint,
      "run",
      "--project", projectRoot,
      "--task", task,
      ...(through ? ["--feature", feature, "--through", through] : []),
      "--chat-json",
    ], {
      cwd: projectRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    });
    child.on("message", (message) => {
      if (message?.type !== "mcpee-authoring-progress") return;
      const progress = runProgressSchema.safeParse({
        stage: message.stage, status: message.status, attempt: message.attempt,
        updated_at: new Date().toISOString(), trace_id: effectiveTraceId,
        ...(message.stage === "brownfield" ? {
          completed: message.completed, total: message.total, scope: message.scope,
          failed: message.failed, active: message.active, pending: message.pending,
          concurrency: message.concurrency,
          elapsed_ms: message.elapsed_ms, last_activity_at: message.last_activity_at,
        } : {}),
      });
      if (!progress.success) return;
      try {
        onProgress?.(progress.data);
      } catch (error) {
        progressFailure = error;
        child.kill();
      }
    });
    const output = await new Promise((resolve, reject) => {
      const stdout = [];
      const stderr = [];
      let bytes = 0;
      const collect = (stream, target) => stream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_PROCESS_OUTPUT_BYTES) {
          child.kill();
          reject(new Error("MCPEE CLI output exceeded the 4 MiB safety limit."));
          return;
        }
        target.push(chunk);
      });
      collect(child.stdout, stdout);
      collect(child.stderr, stderr);
      child.once("error", reject);
      child.once("close", (code, childSignal) => progressFailure ? reject(progressFailure) : resolve({
        code,
        signal: childSignal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }));
      try {
        onStarted?.(child.pid || null);
      } catch (error) {
        child.kill();
        reject(error);
        return;
      }
      if (signal) {
        cancellation = () => {
          if (typeof child.send !== "function" || !child.connected) {
            child.kill();
            return;
          }
          cancellationTimer = setTimeout(() => child.kill(), 5_000);
          child.send({ type: "mcpee.cancel" }, (error) => {
            if (error) {
              process.stderr.write(`[mcpee] Could not request graceful cancellation: ${error.message}\n`);
              child.kill();
            }
          });
        };
        if (signal.aborted) cancellation();
        else signal.addEventListener("abort", cancellation, { once: true });
      }
    });
    if (signal?.aborted) {
      return { isError: true, text: "MCPEE execution was cancelled." };
    }
    const content = extractResult(output.stdout, marker);
    if (content !== null) {
      return {
        isError: output.code !== 0,
        text: output.code === 0
          ? content
          : `${content}\n\nMCPEE returned exit code ${output.code}; the task is not complete.${output.stderr.trim() ? `\n\n${redact(output.stderr.trim().slice(-6000))}` : ""}`,
      };
    }
    const diagnostic = output.stderr.trim() || output.stdout.trim() ||
      `MCPEE CLI exited with code ${output.code ?? "unknown"}${output.signal ? ` (${output.signal})` : ""}.`;
    return {
      isError: true,
      text: `MCPEE could not complete the request:\n\n${redact(diagnostic.slice(-6000))}`,
    };
  })().finally(() => {
    clearTimeout(cancellationTimer);
    if (signal && cancellation) signal.removeEventListener("abort", cancellation);
    broker?.close();
  });
}

function createRunToolHandler(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const packageRoot = path.resolve(options.packageRoot);
  const spawnProcess = options.spawnProcess || spawn;
  const runs = new Map();

  const execute = async ({ task, feature, through }, extra = {}) => {
    if (!fsExists(path.join(projectRoot, ".mcpee", "state", "project.json"))) {
      return {
        isError: true,
        content: [{ type: "text", text: "This workspace is not initialized with MCPEE. Run `mcpee init` and retry." }],
      };
    }
    const traceId = runs.get(extra.runId)?.state.trace_id || crypto.randomUUID();
    const startedAt = Date.now();
    const startedEvent = recordEvent(projectRoot, {
      source: "mcpee-mcp-server",
      event_name: "mcp.tool.started",
      trace_id: traceId,
      attributes: { tool_name: "mcpee_run", run_id: extra.runId || null },
      payload: { task },
    });
    let outcome;
    const signal = extra.signal;
    const approve = async (kind, details) => {
      signal?.throwIfAborted();
      if (kind === "project-data-transfer" || (kind === "maintenance" && details.action === "sync")) {
        recordEvent(projectRoot, {
          source: "mcpee-mcp-server",
          event_name: "mcp.internal.authorization",
          trace_id: traceId,
          parent_id: startedEvent.event_id,
          attributes: {
            decision: "allow", kind, action: details.action || null,
            reason: "Internal continuation of the requested MCPEE task; nested risky actions remain gated.",
          },
        });
        return true;
      }
      return options.approve
        ? options.approve(kind, details)
        : requestApprovalFromMcp(options.mcpServer, kind, details, signal);
    };
    try {
      outcome = await runCopilotCli({
        projectRoot,
        packageRoot,
        task,
        feature,
        through,
        approve,
        spawnProcess,
        signal,
        traceId,
        parentEventId: startedEvent.event_id,
        onStarted: (pid) => {
          const run = runs.get(extra.runId);
          if (run) {
            run.state.child_pid = pid;
            run.state.updated_at = Date.now();
            writeRunState(projectRoot, run.state);
          }
        },
        onProgress: (progress) => {
          const run = runs.get(extra.runId);
          if (run) {
            run.progress = { ...progress, trace_id: traceId };
            run.state.progress = run.progress;
            run.state.updated_at = Date.now();
            writeRunState(projectRoot, run.state);
          }
        },
      });
      recordEvent(projectRoot, {
        source: "mcpee-mcp-server",
        event_name: "mcp.tool.completed",
        trace_id: traceId,
        parent_id: startedEvent.event_id,
        attributes: {
          tool_name: "mcpee_run",
          outcome: outcome.isError ? "failure" : "success",
          duration_ms: Math.max(0, Date.now() - startedAt),
        },
      });
    } catch (error) {
      recordEvent(projectRoot, {
        source: "mcpee-mcp-server",
        event_name: "mcp.tool.completed",
        trace_id: traceId,
        parent_id: startedEvent.event_id,
        attributes: {
          tool_name: "mcpee_run",
          outcome: "failure",
          duration_ms: Math.max(0, Date.now() - startedAt),
          error: error.message,
        },
      });
      throw error;
    }
    return {
      isError: outcome.isError,
      content: [{ type: "text", text: outcome.text }],
    };
  };

  return async ({ task, feature, through, run_id: runId, cancel = false }, extra = {}) => {
    if (Boolean(feature) !== Boolean(through) || through && (!task || runId ||
        !["tasks", "verification"].includes(through) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature))) {
      return { isError: true, content: [{ type: "text", text: "Lifecycle execution requires task, feature slug and through=tasks|verification together; status requests cannot start a lifecycle." }] };
    }
    if ((task && runId) || (!task && !runId) || (cancel && !runId)) {
      return { isError: true, content: [{ type: "text", text: "Provide either task to start a run or run_id to retrieve it; cancellation requires run_id." }] };
    }
    let run;
    if (runId) {
      run = runs.get(runId);
      if (!run) {
        const state = readRunState(projectRoot, runId);
        if (state) return persistedRunResult(state, cancel);
        return { isError: true, content: [{ type: "text", text: "Unknown MCPEE run_id. The server may have restarted; do not silently rerun the task." }] };
      }
    } else {
      if (!fsExists(path.join(projectRoot, ".mcpee", "state", "project.json"))) {
        return { isError: true, content: [{ type: "text", text: "This workspace is not initialized with MCPEE. Run `mcpee init` and retry." }] };
      }
      const active = [...runs].find(([, entry]) => !entry.result);
      if (active) {
        return { isError: true, content: [{ type: "text", text: `An MCPEE run is already active (${active[0]}). Retrieve that run_id rather than starting duplicate work.` }] };
      }
      const admission = admitRun(projectRoot, task);
      if (admission.blocked) return { isError: true, content: [{ type: "text", text: admission.blocked }] };
      for (const [id, entry] of runs) {
        if (entry.result) runs.delete(id);
      }
      const state = admission.state;
      runId = state.run_id;
      run = { controller: new AbortController(), result: null, startedAt: state.started_at, progress: null, state };
      runs.set(runId, run);
      run.promise = execute({ task, feature, through }, {
        ...extra,
        signal: run.controller.signal,
        runId,
      }).then((result) => {
        return result;
      }, (error) => {
        const result = {
          isError: true,
          content: [{ type: "text", text: `MCPEE execution failed: ${error.message}` }],
        };
        return result;
      }).then((result) => {
        run.state.result = redact(result);
        run.state.status = run.controller.signal.aborted ? "cancelled" : result.isError ? "failed" : "completed";
        run.state.updated_at = Date.now();
        try {
          writeRunState(projectRoot, run.state);
        } catch (error) {
          run.result = { isError: true, content: [{ type: "text", text:
            `MCPEE finished execution but could not persist its terminal state: ${redact(error.message)}. Do not report durable completion; inspect local run reports and repair the state directory before starting more work.` }] };
          recordEvent(projectRoot, { source: "mcpee-mcp-server", event_name: "mcp.run.persistence.failed",
            trace_id: run.state.trace_id, attributes: { run_id: runId, error: error.message } });
          return run.result;
        }
        run.result = run.state.result;
        return run.result;
      });
    }
    if (run.result) return run.result;
    if (cancel) {
      run.state.status = "cancelling";
      run.state.updated_at = Date.now();
      writeRunState(projectRoot, run.state);
      run.controller.abort(new Error("MCPEE run cancelled by the host."));
    }
    let timer;
    const onAbort = () => run.controller.abort(extra.signal.reason);
    if (extra.signal?.aborted) onAbort();
    else extra.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await Promise.race([
        run.promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({
            isError: false,
            content: [{
              type: "text",
              text: JSON.stringify({
                status: cancel ? "cancelling" : "running",
                run_id: runId,
                elapsed_ms: Math.max(0, Date.now() - run.startedAt),
                progress: run.progress,
                poll_after_ms: 20_000,
                next_action: "Wait poll_after_ms before retrieving mcpee_run_status with this same run_id. Running alone is not evidence of progress; inspect the reported phase and telemetry if unchanged. Do not restart the task or report completion without a final result.",
              }),
            }],
          }), 20_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      extra.signal?.removeEventListener("abort", onAbort);
    }
  };
}

function fsExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

function createMcpServer(options) {
  const packageJson = require(path.join(path.resolve(options.packageRoot), "package.json"));
  const server = new McpServer({
    name: "mcpee",
    version: packageJson.version,
  });
  const runHandler = createRunToolHandler({
    projectRoot: options.projectRoot,
    packageRoot: options.packageRoot,
    mcpServer: server,
    spawnProcess: options.spawnProcess,
  });
  server.registerTool("mcpee_run", {
    title: "Run a project task with MCPEE",
    description: [
      "Use this tool for every engineering request about the current project, without asking the user to invoke a special chat participant.",
      "MCPEE performs local routing and grounding, then executes the task through the authenticated GitHub Copilot CLI agent runtime.",
      "Invoking this task tool authorizes its selected project context to the authenticated GitHub Copilot runtime and ordinary post-task local synchronization; MCPEE does not ask again for these internal steps.",
      "Nested destructive operations, dependency/tool installation, deployment, other external transfers and sensitive permissions retain their own explicit approval checks.",
      "This tool only starts a task. If the result is running, call the read-only mcpee_run_status tool with its run_id until the final result; do not start another task or ask the user to poll. Use mcpee_run_cancel to cancel a run.",
      "Return the tool's result to the user; do not make the same project changes again in this chat turn.",
    ].join(" "),
    inputSchema: {
      task: z.string().trim().min(1).max(8000).describe("Start a new task, preserving necessary constraints."),
      feature: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().describe("Canonical feature slug; required with through."),
      through: z.enum(["tasks", "verification"]).optional().describe("Explicitly execute validated specification/plan/tasks phases through tasks or implementation checks. Requires feature. Stops on genuine decisions, drift or failures; never proves product acceptance."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  }, ({ task, feature, through }, extra = {}) => runHandler({ task, feature, through }, extra));
  server.registerTool("mcpee_run_status", {
    title: "Check MCPEE run status",
    description: "Retrieve current progress or the persisted result of an existing MCPEE run by run_id, including after a server restart. A dead owner without a final result is interrupted, not successful; inspect its trace and saved authoring candidates instead of replaying the task. This only reads local run state; it does not start, cancel, or modify the run.",
    inputSchema: {
      run_id: z.string().uuid().describe("Existing MCPEE run identifier returned by mcpee_run."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  }, ({ run_id: runId }, extra = {}) => runHandler({ run_id: runId }, extra));
  server.registerTool("mcpee_run_cancel", {
    title: "Cancel an MCPEE run",
    description: "Cancel an existing MCPEE run and its pending approvals. This stops work; it does not restart or modify the project.",
    inputSchema: {
      run_id: z.string().uuid().describe("Existing MCPEE run identifier returned by mcpee_run."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  }, ({ run_id: runId }, extra = {}) => runHandler({ run_id: runId, cancel: true }, extra));
  return server;
}

async function startMcpServer(options) {
  const server = createMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}

module.exports = {
  approvalMessage,
  createApprovalBroker,
  createMcpServer,
  createRunToolHandler,
  extractResult,
  requestApprovalFromMcp,
  runCopilotCli,
  startMcpServer,
};
