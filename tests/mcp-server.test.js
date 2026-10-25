"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const { initializeProject } = require("../packages/core/src/project");
const { readEvents } = require("../packages/core/src/telemetry");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const {
  approvalMessage,
  createApprovalBroker,
  createMcpServer,
  createRunToolHandler,
  requestApprovalFromMcp,
  runCopilotCli,
} = require("../packages/mcp-server/src/server");

test("MCP elicitation gates transfer and per-action approval, failing closed when unavailable", async () => {
  const requests = [];
  const client = {
    server: {
      getClientCapabilities: () => ({ elicitation: { form: {} } }),
      elicitInput: async (request, options) => {
        assert.equal(options.timeout, 600_000);
        requests.push(request);
        return { action: "accept", content: { decision: "approve" } };
      },
    },
  };
  assert.equal(await requestApprovalFromMcp(client, "project-data-transfer", {
    workflow: "deliver-feature",
    agent: "backend",
    memory_count: 1,
    knowledge_source_count: 2,
    codegraph_match_count: 3,
    context_kind: "grounded",
    context_retrieval: "hybrid",
    estimated_tokens: 400,
    selected_sources: ["src/service.js"],
  }), true);
  assert.equal(requests[0].mode, "form");
  assert.match(requests[0].message, /src\/service\.js/);
  assert.deepEqual(requests[0].requestedSchema.properties.decision.enum, ["approve", "deny"]);

  client.server.elicitInput = async () => ({ action: "accept" });
  assert.equal(await requestApprovalFromMcp(client, "project-data-transfer", {}), true);
  client.server.elicitInput = async () => ({ action: "accept", content: { decision: "deny" } });
  assert.equal(await requestApprovalFromMcp(client, "project-data-transfer", {}), false);
  client.server.elicitInput = async () => ({ action: "decline" });
  assert.equal(await requestApprovalFromMcp(client, "copilot-tool", {}), false);
  client.server.getClientCapabilities = () => ({});
  await assert.rejects(
    requestApprovalFromMcp(client, "copilot-tool", {}),
    /does not support interactive approvals/,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    requestApprovalFromMcp(client, "copilot-tool", {}, cancelled.signal),
    /abort/i,
  );
});

test("approval summaries show the exact requested Copilot action", () => {
  assert.match(approvalMessage("copilot-tool", {
    tool: "write_file",
    arguments: '{"path":"src/service.js"}',
    impact: ["Target: src/service.js", "Affected: src/consumer.js (depth 1)"],
    reason: "File writes require approval.",
  }), /write_file[\s\S]*src\/service\.js[\s\S]*Affected/);
});

test("MCP task tool invokes the MCPEE CLI and returns only its marked response", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-mcp-server-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectRoot, ".mcpee", "state"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".mcpee", "state", "project.json"), "{}\n");

  const approvalKinds = [];
  let spawnOptions;
  const handler = createRunToolHandler({
    projectRoot,
    packageRoot: path.resolve(__dirname, ".."),
    approve: async (kind, details) => {
      approvalKinds.push({ kind, details });
      return true;
    },
    spawnProcess: (command, args, options) => {
      spawnOptions = { command, args, options };
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;
      setImmediate(() => {
        void (async () => {
          try {
            const approval = await fetch(options.env.MCPEE_APPROVAL_BROKER_URL, {
              method: "POST",
              headers: {
                authorization: `Bearer ${options.env.MCPEE_APPROVAL_BROKER_TOKEN}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                kind: "project-data-transfer",
                details: { workflow: "resolve-bug", agent: "backend" },
              }),
            });
            assert.deepEqual(await approval.json(), { approved: true });
            const marker = options.env.MCPEE_CHAT_RESULT_MARKER;
            child.stdout.end(`${marker}${JSON.stringify({ content: "Respuesta de Copilot" })}\n`);
            child.stderr.end("[mcpee] internal execution diagnostics\n");
            setImmediate(() => child.emit("close", 0, null));
          } catch (error) {
            child.emit("error", error);
          }
        })();
      });
      return child;
    },
  });

  const result = await handler({ task: "Corrige el error" });
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [{ type: "text", text: "Respuesta de Copilot" }]);
  assert.equal(spawnOptions.command, process.execPath);
  assert.equal(spawnOptions.args[1], "run");
  assert.equal(spawnOptions.args[spawnOptions.args.indexOf("--task") + 1], "Corrige el error");
  assert.equal(spawnOptions.options.cwd, projectRoot);
  assert.ok(spawnOptions.options.env.MCPEE_APPROVAL_BROKER_URL.startsWith("http://127.0.0.1:"));
  assert.ok(spawnOptions.options.env.MCPEE_APPROVAL_BROKER_TOKEN);
  assert.ok(spawnOptions.options.env.MCPEE_TRACE_ID);
  assert.ok(spawnOptions.options.env.MCPEE_PARENT_EVENT_ID);
  const telemetry = readEvents(projectRoot);
  const mcpStarted = telemetry.find((event) => event.event_name === "mcp.tool.started");
  const mcpCompleted = telemetry.find((event) => event.event_name === "mcp.tool.completed");
  assert.ok(mcpStarted);
  assert.equal(mcpCompleted.parent_id, mcpStarted.event_id);
  assert.equal(mcpCompleted.trace_id, mcpStarted.trace_id);
  assert.equal(mcpStarted.payload.task, "Corrige el error");
  assert.deepEqual(approvalKinds, [{
    kind: "project-data-transfer",
    details: { workflow: "resolve-bug", agent: "backend" },
  }]);
});

test("MCP preserves redacted validation failures even when Copilot returned a response", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-mcp-failure-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectRoot, ".mcpee", "state"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".mcpee", "state", "project.json"), "{}\n");
  const handler = createRunToolHandler({
    projectRoot,
    packageRoot: path.resolve(__dirname, ".."),
    spawnProcess: (_command, _args, options) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;
      setImmediate(() => {
        child.stdout.end(`${options.env.MCPEE_CHAT_RESULT_MARKER}${JSON.stringify({ content: "File changed" })}\n`);
        child.stderr.end("[mcpee] Post-change synchronization failed: MCP configuration conflict; token=private-value\n");
        setImmediate(() => child.emit("close", 1, null));
      });
      return child;
    },
  });
  const result = await handler({ task: "Run controlled fixture" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /File changed/);
  assert.match(result.content[0].text, /Post-change synchronization failed: MCP configuration conflict/);
  assert.equal(result.content[0].text.includes("private-value"), false);
});

test("MCP server advertises the task tool to ordinary host clients", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-mcp-protocol-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const packageRoot = path.resolve(__dirname, "..");
  const server = createMcpServer({ projectRoot, packageRoot });
  const client = new Client(
    { name: "test-copilot-host", version: "1.0.0" },
    { capabilities: { elicitation: { form: {} } } },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "mcpee_run"));
});

  test("MCP retrieves long-running work across bounded calls without restarting it", async (t) => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-mcp-progress-"));
    t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
    fs.mkdirSync(path.join(projectRoot, ".mcpee", "state"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".mcpee", "state", "project.json"), "{}\n");
    let starts = 0;
    const server = createMcpServer({
      projectRoot,
      packageRoot: path.resolve(__dirname, ".."),
      spawnProcess: (command, args, options) => {
        starts++;
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        const timer = setTimeout(() => {
          child.stdout.end(`${options.env.MCPEE_CHAT_RESULT_MARKER}${JSON.stringify({ content: "Verified inspection result" })}\n`);
          child.emit("close", 0, null);
        }, 22_000);
        child.kill = () => {
          clearTimeout(timer);
          child.emit("close", null, "SIGTERM");
        };
        return child;
      },
    });
    const client = new Client({ name: "progress-test-host", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    t.after(async () => { await client.close(); await server.close(); });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const first = await client.callTool({ name: "mcpee_run", arguments: { task: "Inspect only" } }, undefined, {
      timeout: 25_000,
    });
    assert.equal(first.isError, false);
    const pending = JSON.parse(first.content[0].text);
    assert.equal(pending.status, "running");
    assert.match(pending.run_id, /^[a-f0-9-]{36}$/);
    const duplicate = await client.callTool({ name: "mcpee_run", arguments: { task: "Inspect again" } });
    assert.equal(duplicate.isError, true);
    assert.match(duplicate.content[0].text, new RegExp(pending.run_id));
    const result = await client.callTool({
      name: "mcpee_run", arguments: { run_id: pending.run_id },
    }, undefined, { timeout: 25_000 });
    assert.equal(result.isError, false);
    assert.equal(result.content[0].text, "Verified inspection result");
    assert.equal(starts, 1);
    const retrieved = await client.callTool({
      name: "mcpee_run", arguments: { run_id: pending.run_id },
    });
    assert.deepEqual(retrieved, result);
  });

  test("MCP cancellation aborts pending approval and rejects later approval requests", async (t) => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-mcp-cancel-"));
    t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
    fs.mkdirSync(path.join(projectRoot, ".mcpee", "state"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".mcpee", "state", "project.json"), "{}\n");
    const cancellation = new AbortController();
    let approvalSignal;
    let childKilled = false;
    let approve;
    const handler = createRunToolHandler({
      projectRoot,
      packageRoot: path.resolve(__dirname, ".."),
      mcpServer: {
        server: {
          getClientCapabilities: () => ({ elicitation: { form: {} } }),
          elicitInput: async (request, options) => {
            approvalSignal = options.signal;
            cancellation.abort();
            options.signal.throwIfAborted();
          },
        },
      },
      spawnProcess: (command, args, options) => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => {
          childKilled = true;
          setImmediate(() => child.emit("close", null, "SIGTERM"));
        };
        approve = () => fetch(options.env.MCPEE_APPROVAL_BROKER_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${options.env.MCPEE_APPROVAL_BROKER_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ kind: "copilot-tool", details: { tool: "powershell" } }),
        });
        setImmediate(() => { void approve().catch(() => {}); });
        return child;
      },
    });
    const result = await handler({ task: "Inspect only" }, { signal: cancellation.signal });
    assert.equal(childKilled, true);
    assert.equal(approvalSignal.aborted, true);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /cancelled/);
  });

test("MCP cancellation asks the CLI to stop its SDK before forcing process termination", async () => {
  const controller = new AbortController();
  let message;
  let forcedKill = false;
  const result = await runCopilotCli({
    projectRoot: os.tmpdir(),
    packageRoot: path.resolve(__dirname, ".."),
    task: "Inspect only",
    approve: async () => false,
    signal: controller.signal,
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.connected = true;
      child.kill = () => { forcedKill = true; };
      child.send = (input, callback) => {
        message = input;
        callback(null);
        setImmediate(() => child.emit("close", 1, null));
      };
      setImmediate(() => controller.abort());
      return child;
    },
  });
  assert.deepEqual(message, { type: "mcpee.cancel" });
  assert.equal(forcedKill, false);
  assert.equal(result.isError, true);
  assert.match(result.text, /cancelled/);
});

test("project-generated MCP launcher loads the installed server and exposes its tool", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-mcp-launcher-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  initializeProject(projectRoot);
  const child = spawn(process.execPath, [
    path.join(projectRoot, ".mcpee", "runtime", "mcp-server.cjs"),
  ], {
    cwd: projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  const tools = await new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP launcher did not respond: ${stderr}`));
    }, 5_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          })}\n`);
          child.stdin.write(`${JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          })}\n`);
        } else if (message.id === 2) {
          clearTimeout(timeout);
          resolve(message.result.tools);
        }
      }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: { elicitation: { form: {} } },
        clientInfo: { name: "test-host", version: "1.0.0" },
      },
    })}\n`);
  });
  assert.ok(tools.some((tool) => tool.name === "mcpee_run"));
  child.stdin.end();
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`MCP launcher exited with ${code}: ${stderr}`));
    });
  });
});

test("MCP task tool reports missing initialization rather than running outside MCPEE", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-mcp-uninitialized-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const handler = createRunToolHandler({
    projectRoot,
    packageRoot: path.resolve(__dirname, ".."),
    spawnProcess: () => assert.fail("must not start the Copilot CLI"),
  });
  const result = await handler({ task: "Read the project" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not initialized with MCPEE/);
});

test("approval broker accepts only authenticated requests and forwards their decision", async () => {
  const seen = [];
  const broker = await createApprovalBroker(async (kind, details) => {
    seen.push({ kind, details });
    return kind === "copilot-tool";
  });
  try {
    const accepted = await fetch(broker.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${broker.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ kind: "copilot-tool", details: { tool: "write_file" } }),
    });
    assert.deepEqual(await accepted.json(), { approved: true });
    const rejected = await fetch(broker.url, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
      body: JSON.stringify({ kind: "copilot-tool", details: {} }),
    });
    assert.equal(rejected.status, 401);
    assert.deepEqual(seen, [{ kind: "copilot-tool", details: { tool: "write_file" } }]);
  } finally {
    broker.close();
  }
});
