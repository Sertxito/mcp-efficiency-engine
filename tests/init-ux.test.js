"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { selectOptions } = require("../packages/cli/src/terminal-select");
const { installCatalogTools } = require("../packages/tool-manager/src/tools");

function terminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = value => { input.isRaw = value; };
  const output = new PassThrough();
  output.isTTY = true;
  let text = "";
  output.on("data", chunk => { text += chunk; });
  return { input, output, text: () => text };
}

test("capabilities are selected with arrows and space, without typing identifiers", async () => {
  const io = terminal();
  const selection = selectOptions({
    ...io, title: "Capabilities", multiple: true,
    options: [
      { value: "backend", label: "Backend" },
      { value: "architecture", label: "Architecture" },
    ],
  });
  await new Promise(resolve => setImmediate(resolve));
  io.input.write(" \x1b[B \r");
  assert.deepEqual(await selection, ["backend", "architecture"]);
  assert.equal(io.input.isRaw, false);
  assert.equal(io.input.listenerCount("keypress"), 0);
  assert.match(io.text(), /\[x\] Architecture/);
});

test("confirmation defaults to no, accepts yes with arrows, and restores input on cancel", async () => {
  for (const [keys, expected] of [["\r", false], ["\x1b[B\r", true], ["\x03", "cancel"], ["\x1b", "cancel"]]) {
    const io = terminal();
    const selection = selectOptions({
      ...io, title: "Authorize downloads?",
      options: [{ value: false, label: "No" }, { value: true, label: "Yes" }],
    });
    const assertion = expected === "cancel"
      ? assert.rejects(selection, /cancelled/)
      : selection.then(value => assert.equal(value, expected));
    await new Promise(resolve => setImmediate(resolve));
    io.input.write(keys);
    await assertion;
    assert.equal(io.input.isRaw, false);
    assert.equal(io.input.listenerCount("keypress"), 0);
    assert.ok(io.text().endsWith("\x1b[?25h"));
  }
});

test("non-terminal selection fails explicitly and terminal EOF cancels", async () => {
  await assert.rejects(selectOptions({ input: { isTTY: false }, output: {}, options: [] }), /terminal/);
  const io = terminal();
  const selection = selectOptions({ ...io, title: "Test", options: [{ value: false, label: "No" }] });
  const assertion = assert.rejects(selection, /input closed/);
  await new Promise(resolve => setImmediate(resolve));
  io.input.end();
  await assertion;
  assert.equal(io.input.isRaw, false);
});

test("tool bundle asks once, names required packages, and never installs after denial", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let approvals = 0;
  const result = await installCatalogTools(root, {
    onlyTools: ["codegraph", "repomix"],
    latestLts: "v99.0.0",
    npmCli: path.join(root, "fixture-npm.js"),
    approveInstallBatch: async installs => {
      approvals += 1;
      assert.deepEqual(installs.map(item => [item.id, item.required]), [["codegraph", true], ["repomix", false]]);
      assert.ok(installs.every(item => item.package && item.version && item.target));
      return false;
    },
    approveInstall: () => { throw new Error("must not ask per tool"); },
    runProcess: () => { throw new Error("must not install after denial"); },
  });
  assert.equal(approvals, 1);
  assert.deepEqual(result.results.map(item => item.status), ["blocked", "blocked"]);
});

test("Node update-check failure is advisory and approved compatible tools still install", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-node-advisory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let approvals = 0;
  const result = await installCatalogTools(root, {
    onlyTools: ["repomix"],
    get: () => {
      const request = new EventEmitter();
      process.nextTick(() => request.emit("error", new Error("Offline fixture")));
      return request;
    },
    npmCli: path.join(root, "fixture-npm.js"),
    onNodeCheck: check => assert.equal(check.error, "Offline fixture"),
    approveInstallBatch: async () => { approvals += 1; return true; },
    runProcess: (command, args) => {
      const prefix = args[args.indexOf("--prefix") + 1];
      const packageRoot = path.join(prefix, "node_modules", "repomix");
      fs.mkdirSync(packageRoot, { recursive: true });
      fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ version: "1.18.1" }));
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(approvals, 1);
  assert.equal(result.results[0].status, "installed");
  assert.equal(result.nodeLtsError, "Offline fixture");
});

test("incompatible Node is blocked before asking for installation approval", () => {
  const tools = path.resolve(__dirname, "../packages/tool-manager/src/tools");
  const script = `
    const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcpee-old-node-'));
    Object.defineProperty(process.versions,'node',{value:'18.0.0'});
    require(${JSON.stringify(tools)}).installCatalogTools(root,{
      onlyTools:['codegraph'],latestLts:'v24.22.1',
      onProgress: result => process.stdout.write(result.reason),
      approveInstallBatch: () => { throw new Error('must not ask'); },
      runProcess: () => { throw new Error('must not install'); },
    }).then(result => {
      if(result.results[0].status!=='blocked') throw new Error('not blocked');
    }).finally(()=>fs.rmSync(root,{recursive:true,force:true}));`;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /20\.0\.0\+ is required/);
});

test("interactive init configures Backend + Architecture with two menus and an unambiguous final status", () => {
  const cli = path.resolve(__dirname, "../packages/cli/src/cli");
  const selector = path.resolve(__dirname, "../packages/cli/src/terminal-select");
  const tools = path.resolve(__dirname, "../packages/tool-manager/src/tools");
  const graph = path.resolve(__dirname, "../packages/knowledge-engine/src/codegraph");
  for (const ready of [false, true]) {
    const script = `
      const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
      const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcpee-init-menu-'));
      Object.defineProperty(process.stdin,'isTTY',{value:true});
      Object.defineProperty(process.stdout,'isTTY',{value:true});
      let menus=0;
      require(${JSON.stringify(selector)}).selectOptions=async options=>{
        menus++;
        if(menus===1) return options.options.find(option=>Array.isArray(option.value)&&option.value.join(',')==='backend,architecture').value;
        if(menus===2) return true;
        throw new Error('unexpected extra setup question');
      };
      require(${JSON.stringify(tools)}).installCatalogTools=async(root,options)=>{
        assert.equal(typeof options.approveInstallBatch,'function');
        assert.equal(options.approveInstall,undefined);
        assert.equal(await options.approveInstallBatch([{
          id:'codegraph',package:'@colbymchenry/codegraph',version:'1.6.2',
          required:true,target:'.mcpee/tools/npm/',
        }]),true);
        return {results:[],latestLts:'v24.22.1'};
      };
      require(${JSON.stringify(graph)}).updateCodeGraph=()=>(${JSON.stringify(ready
        ? { status: "ready", operation: "fixture", summary: {}, mcp: { status: "configured", file: ".mcp.json" } }
        : { status: "failed", error: "Fixture CodeGraph unavailable" })});
      require(${JSON.stringify(cli)}).run(['init','--project',root]).then(code=>{
        assert.equal(code,${ready ? 0 : 1});
        assert.equal(menus,2);
        const state=JSON.parse(fs.readFileSync(path.join(root,'.mcpee/generated/project-capabilities.json'),'utf8'));
        assert.deepEqual(state.assets.agents,['architecture','backend']);
      }).catch(error=>{console.error(error);process.exitCode=1})
        .finally(()=>fs.rmSync(root,{recursive:true,force:true}));
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Capabilities configured: architecture, backend/);
    assert.match(result.stdout + result.stderr, ready ? /SETUP COMPLETE/ : /SETUP INCOMPLETE/);
    assert.doesNotMatch(result.stdout, /Agent IDs \(comma|Type "approve"|Optional local semantic embeddings:/);
  }
});
