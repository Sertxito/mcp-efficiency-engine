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

const MAX_APPROVAL_BYTES = 64 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;

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
}) {
  const cliEntrypoint = path.join(packageRoot, "packages", "cli", "bin", "mcpee.js");
  const marker = `__MCPEE_CHAT_RESULT_${crypto.randomBytes(16).toString("hex")}__`;
  const effectiveTraceId = traceId || crypto.randomUUID();
  let child;
  let cancellation;
  let cancellationTimer;
  let broker;

  return (async () => {
    broker = await createApprovalBroker(approve);
    const environment = {
      ...process.env,
      MCPEE_APPROVAL_BROKER_URL: broker.url,
      MCPEE_APPROVAL_BROKER_TOKEN: broker.token,
      MCPEE_CHAT_RESULT_MARKER: marker,
      MCPEE_TRACE_ID: effectiveTraceId,
      MCPEE_PARENT_EVENT_ID: parentEventId,
    };
    child = spawnProcess(process.execPath, [
      cliEntrypoint,
      "run",
      "--project", projectRoot,
      "--task", task,
      "--chat-json",
    ], {
      cwd: projectRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
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
      child.once("close", (code, childSignal) => resolve({
        code,
        signal: childSignal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }));
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

  const execute = async ({ task }, extra = {}) => {
    if (!fsExists(path.join(projectRoot, ".mcpee", "state", "project.json"))) {
      return {
        isError: true,
        content: [{ type: "text", text: "This workspace is not initialized with MCPEE. Run `mcpee init` and retry." }],
      };
    }
    const traceId = crypto.randomUUID();
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
      return options.approve
        ? options.approve(kind, details)
        : requestApprovalFromMcp(options.mcpServer, kind, details, signal);
    };
    try {
      outcome = await runCopilotCli({
        projectRoot,
        packageRoot,
        task,
        approve,
        spawnProcess,
        signal,
        traceId,
        parentEventId: startedEvent.event_id,
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

  return async ({ task, run_id: runId, cancel = false }, extra = {}) => {
    if ((task && runId) || (!task && !runId) || (cancel && !runId)) {
      return { isError: true, content: [{ type: "text", text: "Provide either task to start a run or run_id to retrieve it; cancellation requires run_id." }] };
    }
    let run;
    if (runId) {
      run = runs.get(runId);
      if (!run) {
        return { isError: true, content: [{ type: "text", text: "Unknown MCPEE run_id. The server may have restarted; do not silently rerun the task." }] };
      }
    } else {
      const active = [...runs].find(([, entry]) => !entry.result);
      if (active) {
        return { isError: true, content: [{ type: "text", text: `An MCPEE run is already active (${active[0]}). Retrieve that run_id rather than starting duplicate work.` }] };
      }
      for (const [id, entry] of runs) {
        if (entry.result) runs.delete(id);
      }
      runId = crypto.randomUUID();
      run = { controller: new AbortController(), result: null };
      runs.set(runId, run);
      run.promise = execute({ task }, {
        ...extra,
        signal: run.controller.signal,
        runId,
      }).then((result) => {
        run.result = result;
        return result;
      }, (error) => {
        const result = {
          isError: true,
          content: [{ type: "text", text: `MCPEE execution failed: ${error.message}` }],
        };
        run.result = result;
        return result;
      });
    }
    if (cancel) run.controller.abort(new Error("MCPEE run cancelled by the host."));
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
                next_action: "Call mcpee_run again with this run_id (no task). Keep retrieving this same run until its final result. Do not restart the task, report completion, or ask the user to poll.",
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
  server.registerTool("mcpee_run", {
    title: "Run a project task with MCPEE",
    description: [
      "Use this tool for every engineering request about the current project, without asking the user to invoke a special chat participant.",
      "MCPEE performs local routing and grounding, then executes the task through the authenticated GitHub Copilot CLI agent runtime.",
      "The tool requests explicit approval before sending selected project context to Copilot and before each state-changing action.",
      "Start once with task. If the result is running, call this same tool with run_id and no task until it returns the final result; do not ask the user to poll. To cancel, pass run_id and cancel:true.",
      "Return the tool's result to the user; do not make the same project changes again in this chat turn.",
    ].join(" "),
    inputSchema: {
      task: z.string().trim().min(1).max(8000).optional().describe("Start a new task, preserving necessary constraints. Omit when retrieving an existing run."),
      run_id: z.string().uuid().optional().describe("Retrieve the existing run returned by this tool without executing the task again."),
      cancel: z.boolean().optional().describe("Cancel an existing run; requires run_id."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  }, createRunToolHandler({
    projectRoot: options.projectRoot,
    packageRoot: options.packageRoot,
    mcpServer: server,
    spawnProcess: options.spawnProcess,
  }));
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
