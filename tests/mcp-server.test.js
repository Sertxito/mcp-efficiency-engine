"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
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

function durableFixture(t, { failure = false, beforeClose } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-durable-run-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".mcpee", "state"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mcpee", "state", "project.json"), "{}\n");
  let starts = 0;
  const options = {
    projectRoot: root, packageRoot: path.resolve(__dirname, ".."),
    spawnProcess: (_command, _args, options) => {
      starts++;
      const stateFile = fs.readdirSync(path.join(root, ".mcpee/state/runs")).find(name => name.endsWith(".json"));
      const state = JSON.parse(fs.readFileSync(path.join(root, ".mcpee/state/runs", stateFile), "utf8"));
      assert.equal(state.status, "running", "The journal must exist before execution starts");
      assert.equal(state.result, null);
      assert.equal(Object.hasOwn(state, "task"), false);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => { setImmediate(() => child.emit("close", null, "SIGTERM")); };
      setImmediate(() => {
        child.emit("message", { type: "mcpee-authoring-progress", stage: "plan", status: "validated", attempt: 1 });
        child.stdout.end(`${options.env.MCPEE_CHAT_RESULT_MARKER}${JSON.stringify({
          content: `Preserved ${failure ? "failed" : "completed"} result Bearer ${"a".repeat(30)}`,
        })}\n`);
        child.stderr.end(failure ? "Real validation failed." : "");
        beforeClose?.(path.join(root, ".mcpee/state/runs", stateFile));
        child.emit("close", failure ? 1 : 0, null);
      });
      return child;
    },
  };
  const snapshot = () => {
    const directory = path.join(root, ".mcpee/state/runs");
    const file = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith(".json")));
    return { file, state: JSON.parse(fs.readFileSync(file, "utf8")) };
  };
  return { root, options, snapshot, starts: () => starts };
}

test("MCP preserves redacted success and failure results across handler restart and subsequent tasks", async t => {
  for (const failure of [false, true]) {
    const fixture = durableFixture(t, { failure });
    const handler = createRunToolHandler(fixture.options);
    const result = await handler({ task: "Inspect the current canonical plan" });
    const { state, file } = fixture.snapshot();
    assert.equal(state.status, failure ? "failed" : "completed");
    assert.equal(state.progress.stage, "plan");
    assert.equal(state.progress.attempt, 1);
    assert.equal(result.isError, failure);
    assert.ok(state.trace_id);
    assert.ok(!fs.readFileSync(file, "utf8").includes("a".repeat(30)));
    await handler({ task: "Inspect another explicitly requested plan" });
    const restarted = createRunToolHandler(fixture.options);
    const before = fs.readFileSync(file, "utf8");
    assert.deepEqual(await restarted({ run_id: state.run_id }), result);
    assert.deepEqual(await restarted({ run_id: state.run_id, cancel: true }), result);
    assert.equal(fs.readFileSync(file, "utf8"), before, "Status retrieval must not modify persisted evidence");
    assert.equal(fixture.starts(), 2, "Retrieving results must never invoke the CLI");
  }
});

test("MCP reports a dead-owner interruption with last progress, without replay or false completion", async t => {
  const fixture = durableFixture(t);
  await createRunToolHandler(fixture.options)({ task: "Inspect canonical source evidence" });
  const { state, file } = fixture.snapshot();
  const exited = spawnSync(process.execPath, ["-e", ""], { windowsHide: true });
  assert.equal(exited.status, 0);
  state.owner_pid = exited.pid;
  state.status = "running";
  state.result = null;
  fs.writeFileSync(file, JSON.stringify(state));
  const before = fs.readFileSync(file, "utf8");
  const restarted = createRunToolHandler(fixture.options);
  const result = await restarted({ run_id: state.run_id });
  const interrupted = JSON.parse(result.content[0].text);
  assert.equal(result.isError, true);
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.owner_alive, false);
  assert.equal(interrupted.progress.stage, "plan");
  assert.equal(interrupted.trace_id, state.trace_id);
  assert.match(interrupted.next_action, /specs recover/);
  assert.equal(interrupted.poll_after_ms, null);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fixture.starts(), 1);
});

test("MCP does not duplicate or kill an execution owned by another live handler or an orphaned child", async t => {
  const fixture = durableFixture(t);
  await createRunToolHandler(fixture.options)({ task: "Inspect canonical source evidence" });
  const { state, file } = fixture.snapshot();
  state.status = "running";
  state.result = null;
  state.owner_pid = process.pid;
  fs.writeFileSync(file, JSON.stringify(state));
  const restarted = createRunToolHandler(fixture.options);
  const status = await restarted({ run_id: state.run_id });
  assert.equal(JSON.parse(status.content[0].text).status, "running");
  assert.equal(status.isError, false);
  const denied = await restarted({ run_id: state.run_id, cancel: true });
  assert.equal(denied.isError, true);
  assert.match(JSON.parse(denied.content[0].text).next_action, /cannot safely cancel/);
  assert.equal((await restarted({ task: "Do not duplicate an active execution" })).isError, true);
  const exited = spawnSync(process.execPath, ["-e", ""], { windowsHide: true });
  state.owner_pid = exited.pid;
  state.child_pid = process.pid;
  fs.writeFileSync(file, JSON.stringify(state));
  const orphaned = await restarted({ run_id: state.run_id });
  assert.equal(JSON.parse(orphaned.content[0].text).child_may_be_running, true);
  assert.equal((await restarted({ task: "Do not duplicate an orphaned execution" })).isError, true);
  assert.equal(fixture.starts(), 1);
});

test("MCP rejects corrupt, mismatched and escaping durable run state before any execution", async t => {
  const fixture = durableFixture(t);
  await createRunToolHandler(fixture.options)({ task: "Inspect canonical source evidence" });
  const { state, file } = fixture.snapshot();
  const restarted = createRunToolHandler(fixture.options);
  await assert.rejects(restarted({ run_id: "..\\project" }), /Invalid MCPEE run_id/);
  fs.writeFileSync(file, "{bad json");
  await assert.rejects(restarted({ run_id: state.run_id }), SyntaxError);
  await assert.rejects(restarted({ task: "Do not execute with corrupt state" }), SyntaxError);
  const mismatched = { ...state, run_id: require("node:crypto").randomUUID() };
  fs.writeFileSync(file, JSON.stringify(mismatched));
  await assert.rejects(restarted({ run_id: state.run_id }), /identifier does not match/);
  fs.writeFileSync(file, JSON.stringify({ ...state, status: "running" }));
  await assert.rejects(restarted({ run_id: state.run_id }), /terminal result/);
  assert.equal(fixture.starts(), 1);
});

test("MCP run journals refuse linked state directories without writing outside the project", async t => {
  const fixture = durableFixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-run-junction-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(fixture.root, ".mcpee/state/runs"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(createRunToolHandler(fixture.options)({ task: "Inspect only" }), /symbolic links/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fixture.starts(), 0);
});

test("MCP surfaces terminal persistence failure instead of claiming durable completion", async t => {
  const fixture = durableFixture(t, { beforeClose: file => {
    fs.renameSync(file, `${file}.preserved`);
    fs.mkdirSync(file);
  } });
  const handler = createRunToolHandler(fixture.options);
  const result = await handler({ task: "Inspect the canonical plan without changes" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /could not persist its terminal state/);
  assert.match(result.content[0].text, /Do not report durable completion/);
  const event = readEvents(fixture.root).find(event => event.event_name === "mcp.run.persistence.failed");
  assert.ok(event);
  assert.deepEqual(await handler({ run_id: event.attributes.run_id }), result);
  assert.equal(fixture.starts(), 1);
});

test("MCP atomically admits only one execution from simultaneous independent server processes", async t => {
  const fixture = durableFixture(t);
  const modulePath = path.resolve(__dirname, "../packages/mcp-server/src/server.js");
  const script = `
    const {createRunToolHandler}=require(${JSON.stringify(modulePath)});
    const {EventEmitter}=require('node:events');
    const {PassThrough}=require('node:stream');
    const handler=createRunToolHandler({
      projectRoot:${JSON.stringify(fixture.root)}, packageRoot:${JSON.stringify(path.resolve(__dirname, ".."))},
      spawnProcess:(_command,_args,options)=>{
        console.log('SPAWNED');
        const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
        child.kill=()=>true;
        setTimeout(()=>{child.stdout.end(options.env.MCPEE_CHAT_RESULT_MARKER+JSON.stringify({content:'Verified'})+'\\n');child.stderr.end();child.emit('close',0,null);},1500);
        return child;
      }
    });
    console.log('READY');
    process.stdin.once('data',()=>handler({task:'Inspect only'}).then(result=>{console.log(JSON.stringify(result));process.stdin.destroy();},error=>{console.error(error);process.exitCode=1;process.stdin.destroy();}));
  `;
  const processes = [0, 1].map(() => {
    const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let output = "", error = "";
    const ready = new Promise(resolve => child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("READY")) resolve();
    }));
    child.stderr.on("data", chunk => { error += chunk; });
    const done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve(output) : reject(new Error(error)));
    });
    return { child, ready, done };
  });
  await Promise.all(processes.map(process => process.ready));
  processes.forEach(process => process.child.stdin.end("begin"));
  const outputs = await Promise.all(processes.map(process => process.done));
  assert.equal(outputs.filter(output => output.includes("SPAWNED")).length, 1);
  assert.equal(outputs.filter(output => output.includes('"isError":true')).length, 1);
  assert.ok(outputs.some(output => /admission is locked|may still be active/.test(output)));
  assert.equal(fs.readdirSync(path.join(fixture.root, ".mcpee/state/runs")).filter(name => name.endsWith(".json")).length, 1);
  assert.equal(fs.existsSync(path.join(fixture.root, ".mcpee/state/runs/admission.lock")), false);
});

test("MCP reports an abandoned admission lock without stealing it or spawning work", async t => {
  const fixture = durableFixture(t);
  const directory = path.join(fixture.root, ".mcpee/state/runs");
  fs.mkdirSync(directory);
  const lock = path.join(directory, "admission.lock");
  fs.writeFileSync(lock, "interrupted admission evidence");
  const result = await createRunToolHandler(fixture.options)({ task: "Inspect only" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no stale lock is silently stolen/);
  assert.equal(fs.readFileSync(lock, "utf8"), "interrupted admission evidence");
  assert.equal(fixture.starts(), 0);
});

test("MCP requires an explicit lifecycle endpoint and forwards it to the CLI without default chaining", async t => {
  const fixture = durableFixture(t);
  let args;
  const spawnProcess = fixture.options.spawnProcess;
  fixture.options.spawnProcess = (command, arguments_, options) => {
    args = arguments_;
    return spawnProcess(command, arguments_, options);
  };
  const handler = createRunToolHandler(fixture.options);
  assert.equal((await handler({ task: "Build catalog", through: "verification" })).isError, true);
  assert.equal((await handler({ task: "Build catalog", feature: "public-catalog" })).isError, true);
  assert.equal((await handler({ task: "Build catalog", feature: "../outside", through: "tasks" })).isError, true);
  assert.equal(fixture.starts(), 0);
  await handler({ task: "Build catalog", feature: "public-catalog", through: "tasks" });
  assert.equal(args[args.indexOf("--feature") + 1], "public-catalog");
  assert.equal(args[args.indexOf("--through") + 1], "tasks");
  await handler({ task: "Inspect catalog" });
  assert.ok(!args.includes("--through"));
  assert.ok(!args.includes("--feature"));
});

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
      return false;
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
            for (const [kind, details, expected] of [
              ["maintenance", { action: "sync" }, true],
              ["maintenance", { action: "install" }, false],
              ["copilot-tool", { tool: "deploy", reason: "Deployment requires approval." }, false],
              ["copilot-permission", { permission_kind: "url" }, false],
            ]) {
              const response = await fetch(options.env.MCPEE_APPROVAL_BROKER_URL, {
                method: "POST",
                headers: {
                  authorization: `Bearer ${options.env.MCPEE_APPROVAL_BROKER_TOKEN}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify({ kind, details }),
              });
              assert.deepEqual(await response.json(), { approved: expected });
            }
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
  assert.equal(spawnOptions.options.env.MCPEE_MCP_TASK_AUTHORIZED, "1");
  assert.ok(spawnOptions.options.env.MCPEE_TRACE_ID);
  assert.ok(spawnOptions.options.env.MCPEE_PARENT_EVENT_ID);
  const telemetry = readEvents(projectRoot);
  const mcpStarted = telemetry.find((event) => event.event_name === "mcp.tool.started");
  const mcpCompleted = telemetry.find((event) => event.event_name === "mcp.tool.completed");
  assert.ok(mcpStarted);
  assert.equal(mcpCompleted.parent_id, mcpStarted.event_id);
  assert.equal(mcpCompleted.trace_id, mcpStarted.trace_id);
  assert.equal(mcpStarted.payload.task, "Corrige el error");
  assert.deepEqual(approvalKinds.map(({ kind }) => kind), ["maintenance", "copilot-tool", "copilot-permission"]);
  const internal = telemetry.filter((event) => event.event_name === "mcp.internal.authorization");
  assert.deepEqual(internal.map((event) => event.attributes.kind), ["project-data-transfer", "maintenance"]);
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
  const runTool = tools.tools.find((tool) => tool.name === "mcpee_run");
  assert.ok(runTool);
  assert.deepEqual(Object.keys(runTool.inputSchema.properties), ["task", "feature", "through"]);
  assert.deepEqual(runTool.inputSchema.required, ["task"]);
  const statusTool = tools.tools.find((tool) => tool.name === "mcpee_run_status");
  assert.ok(statusTool);
  assert.equal(statusTool.annotations.readOnlyHint, true);
  assert.equal(statusTool.annotations.openWorldHint, false);
  const cancelTool = tools.tools.find((tool) => tool.name === "mcpee_run_cancel");
  assert.ok(cancelTool);
  assert.equal(cancelTool.annotations.readOnlyHint, false);
  assert.equal(cancelTool.annotations.openWorldHint, false);
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
        setImmediate(() => child.emit("message", { type: "mcpee-authoring-progress",
          stage: "specification", attempt: 2, status: "repairing" }));
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
    assert.match(pending.next_action, /Wait poll_after_ms/);
    assert.equal(pending.poll_after_ms, 20_000);
    assert.ok(pending.elapsed_ms >= 20_000);
    assert.equal(pending.progress.stage, "specification");
    assert.equal(pending.progress.status, "repairing");
    assert.equal(pending.progress.attempt, 2);
    const invalidPoll = await client.callTool({
      name: "mcpee_run", arguments: { run_id: pending.run_id },
    });
    assert.equal(invalidPoll.isError, true);
    const duplicate = await client.callTool({ name: "mcpee_run", arguments: { task: "Inspect again" } });
    assert.equal(duplicate.isError, true);
    assert.match(duplicate.content[0].text, new RegExp(pending.run_id));
    const result = await client.callTool({
      name: "mcpee_run_status", arguments: { run_id: pending.run_id },
    }, undefined, { timeout: 25_000 });
    assert.equal(result.isError, false);
    assert.equal(result.content[0].text, "Verified inspection result");
    assert.equal(starts, 1);
    const retrieved = await client.callTool({
      name: "mcpee_run_status", arguments: { run_id: pending.run_id },
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

test("MCP forwards validated whole-brownfield scope progress without accepting invalid counts", async () => {
  const progress = [];
  const result = await runCopilotCli({
    projectRoot: os.tmpdir(), packageRoot: path.resolve(__dirname, ".."),
    task: "Run brownfield", approve: async () => false,
    onProgress: update => progress.push(update),
    spawnProcess: (_command, _args, options) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => assert.fail("Valid brownfield progress must not stop the batch.");
      setImmediate(() => {
        const message = { type: "mcpee-authoring-progress", stage: "brownfield",
          status: "authoring", attempt: 1, completed: 3, total: 58, scope: "brownfield-about-us-123abc",
          failed: 1, active: 2, pending: 52, concurrency: 6,
          elapsed_ms: 3600000, last_activity_at: "2026-11-02T14:00:00Z" };
        child.emit("message", { ...message, completed: 59 });
        child.emit("message", { ...message, concurrency: 11 });
        child.emit("message", message);
        child.stdout.end(`${options.env.MCPEE_CHAT_RESULT_MARKER}${JSON.stringify({ content: "Brownfield completed" })}\n`);
        child.emit("close", 0, null);
      });
      return child;
    },
  });
  assert.equal(result.isError, false);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].stage, "brownfield");
  assert.equal(progress[0].completed, 3);
  assert.equal(progress[0].total, 58);
  assert.equal(progress[0].scope, "brownfield-about-us-123abc");
  assert.equal(progress[0].failed, 1);
  assert.equal(progress[0].active, 2);
  assert.equal(progress[0].concurrency, 6);
  assert.equal(progress[0].elapsed_ms, 3600000);
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
