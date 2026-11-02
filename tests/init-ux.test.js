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
  assert.notEqual(io.input.readableFlowing, true, "stdin must stop flowing so the CLI can exit");
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

test("interactive init defaults to the full catalog, preserves explicit agents and only asks for tool approval", () => {
  const cli = path.resolve(__dirname, "../packages/cli/src/cli");
  const selector = path.resolve(__dirname, "../packages/cli/src/terminal-select");
  const tools = path.resolve(__dirname, "../packages/tool-manager/src/tools");
  const graph = path.resolve(__dirname, "../packages/knowledge-engine/src/codegraph");
  for (const ready of [false, true]) {
    for (const explicit of [false, true]) {
    const script = `
      const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
      const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcpee-init-menu-'));
      Object.defineProperty(process.stdin,'isTTY',{value:true});
      Object.defineProperty(process.stdout,'isTTY',{value:true});
      let menus=0;
      require(${JSON.stringify(selector)}).selectOptions=async options=>{
        menus++;
        if(menus===1) return true;
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
      require(${JSON.stringify(cli)}).run(['init','--project',root,...${JSON.stringify(explicit ? ["--agents", "backend,architecture"] : [])}]).then(code=>{
        assert.equal(code,${ready ? 0 : 1});
        assert.equal(menus,1);
        const state=JSON.parse(fs.readFileSync(path.join(root,'.mcpee/generated/project-capabilities.json'),'utf8'));
        assert.deepEqual(state.assets.agents,${explicit
          ? "['architecture','backend','orchestrator']"
          : `require(${JSON.stringify(path.resolve(__dirname, "../catalog/catalog.json"))}).agents.map(agent=>agent.id).sort()`});
      }).catch(error=>{console.error(error);process.exitCode=1})
        .finally(()=>fs.rmSync(root,{recursive:true,force:true}));
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, explicit ? /Capabilities configured: architecture, backend, orchestrator/ : /Capabilities configured: .*performance-forensics/);
    assert.doesNotMatch(result.stdout, /Brownfield authoring scopes:/,
      "greenfield initialization does not prepare brownfield scopes");
    assert.match(result.stdout + result.stderr, ready ? /SETUP COMPLETE/ : /SETUP INCOMPLETE/);
    assert.doesNotMatch(result.stdout, /Agent IDs \(comma|Type "approve"|Optional local semantic embeddings:/);
    }
  }
});

test("brownfield init automatically invokes proposal authoring once after local preparation without another consent prompt", () => {
  for (const complete of [true, false]) {
  const cli = path.resolve(__dirname, "../packages/cli/src/cli");
  const tools = path.resolve(__dirname, "../packages/tool-manager/src/tools");
  const graph = path.resolve(__dirname, "../packages/knowledge-engine/src/codegraph");
  const authoring = path.resolve(__dirname, "../packages/spec-engine/src/brownfield-authoring");
  const result = spawnSync(process.execPath, ["-e", `
    const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcpee-init-auto-brownfield-'));
    fs.mkdirSync(path.join(root,'src'),{recursive:true});
    fs.writeFileSync(path.join(root,'src/orders.js'),"function listOrders() { return []; }\\n");
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'orders',scripts:{test:'node --version'}}));
    require(${JSON.stringify(tools)}).installCatalogTools=async()=>({results:[]});
    require(${JSON.stringify(graph)}).updateCodeGraph=()=>({status:'ready',operation:'fixture',summary:{},mcp:{status:'unchanged',file:'.mcp.json'}});
    let calls=0;
    require(${JSON.stringify(authoring)}).authorBrownfield=async(project,options)=>{
      calls++;
      assert.equal(project,root);
      assert.equal(options.authorized,true);
      assert.ok(fs.existsSync(path.join(root,'.mcpee/indexes/knowledge-index.json')));
      assert.ok(fs.existsSync(path.join(root,'.mcpee/graphs/unified/graph.json')));
      return {status:${JSON.stringify(complete ? "completed" : "blocked")},exitCode:${complete ? 0 : 1},scopes:[{id:'orders'}],report:'.mcpee/reports/brownfield/fixture.json'};
    };
    require(${JSON.stringify(cli)}).run(['init','--project',root,'--skip-tool-install','--embeddings','none'])
      .then(code=>{assert.equal(code,${complete ? 0 : 1});assert.equal(calls,1);})
      .catch(error=>{console.error(error);process.exitCode=1;})
      .finally(()=>fs.rmSync(root,{recursive:true,force:true}));
  `], { encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  if (complete) {
    assert.match(result.stdout, /Brownfield complete:/);
    assert.match(result.stdout, /SETUP COMPLETE/);
  } else {
    assert.match(result.stderr, /BROWNFIELD INCOMPLETE/);
    assert.doesNotMatch(result.stdout, /SETUP COMPLETE|Brownfield complete:/);
  }
  assert.doesNotMatch(result.stdout, /Type "approve"|No model was run/);
  }
});

test("prepare-only brownfield init prepares source-bound scopes without paid authoring", () => {
  const cli = path.resolve(__dirname, "../packages/cli/src/cli");
  const tools = path.resolve(__dirname, "../packages/tool-manager/src/tools");
  const graph = path.resolve(__dirname, "../packages/knowledge-engine/src/codegraph");
  const result = spawnSync(process.execPath, ["-e", `
    const assert=require('node:assert/strict');
    const fs=require('node:fs');
    const os=require('node:os');
    const path=require('node:path');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcpee-init-brownfield-scopes-'));
    fs.mkdirSync(path.join(root,'src/modules/orders'),{recursive:true});
    fs.mkdirSync(path.join(root,'tests/modules/orders'),{recursive:true});
    fs.writeFileSync(path.join(root,'src/modules/orders/query.js'),"function queryOrders() { return []; }\\n");
    fs.writeFileSync(path.join(root,'tests/modules/orders/query.test.js'),"test('returns orders', () => {});\\n");
    fs.mkdirSync(path.join(root,'docs'),{recursive:true});
    fs.writeFileSync(path.join(root,'docs/policy.md'),"# Orders\\n\\nReaders may inspect submitted orders.\\n");
    require(${JSON.stringify(tools)}).installCatalogTools=async()=>({results:[],latestLts:null});
    require(${JSON.stringify(graph)}).updateCodeGraph=()=>({
      status:'ready',operation:'fixture',summary:{file_count:2,node_count:2,edge_count:1},
      mcp:{status:'configured',file:'.mcp.json'}
    });
    const {run}=require(${JSON.stringify(cli)});
    run(['init','--project',root,'--agents','backend','--skip-tool-install','--embeddings','none','--prepare-only'])
      .then(async code=>{
        assert.equal(code,0);
        const scopes=await run(['specs','scopes','--project',root,'--json']);
        assert.equal(scopes,0);
        const report=require(${JSON.stringify(path.resolve(__dirname, "../packages/spec-engine/src/scopes"))})
          .buildSpecificationScopes(root);
        assert.equal(report.status,'planned');
        assert.ok(report.scopes.some(scope=>scope.sources.some(source=>source.path==='src/modules/orders/query.js')));
        assert.ok(report.scopes.some(scope=>scope.sources.some(source=>source.path==='tests/modules/orders/query.test.js')));
      })
      .catch(error=>{console.error(error);process.exitCode=1})
      .finally(()=>fs.rmSync(root,{recursive:true,force:true}));
  `], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Brownfield authoring scopes: planned/);
  assert.match(result.stdout, /Run mcpee brownfield to complete authoring/);
  assert.match(result.stdout, /LOCAL PREPARATION COMPLETE/);
});
