"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { startActivity, reportEmbeddingProgress, setActivityStep, formatActivityPhase } = require("../packages/cli/src/activity");

test("measured embedding progress remains visible in redirected background logs", () => {
  let output = "";
  reportEmbeddingProgress({
    phase: "inference", completed: 616, total: 18989, cached: 608,
    batch_size: 1, max_tokens: 3981,
  }, { isTTY: false, write: text => { output += text; } });
  assert.equal(output, "[mcpee] BGE-M3: inference 616/18989; cached=608; batch=1; max_tokens=3981\n");
});

test("activity is silent for nonterminals, JSON and help", () => {
  for (const args of [["sync", "--json"], ["run", "--chat-json"], ["help"]]) {
    startActivity(args, { isTTY: true })();
  }
  startActivity(["sync"], { isTTY: false })();
});

test("activity reports during synchronous work and does not write to stdout", () => {
  const modulePath = path.resolve(__dirname, "../packages/cli/src/activity");
  const script = `
    const {startActivity,reportActivity,setActivityStep}=require(${JSON.stringify(modulePath)});
    const stop=startActivity(['sync'],{isTTY:true,write:s=>process.stderr.write(s)});
    reportActivity('test phase');
    setActivityStep(2,5);
    reportActivity('stepped phase');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
    stop();
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Working: test phase; elapsed \d+s\./);
  assert.match(result.stderr, /Working: Step 2\/5: stepped phase; elapsed \d+s\./);
  assert.doesNotMatch(result.stderr, /no percentage/);
});

test("activity step prefix is cleared after the stepped flow", () => {
  setActivityStep(1, 5);
  assert.equal(formatActivityPhase("Building"), "Step 1/5: Building");
  setActivityStep();
  assert.equal(formatActivityPhase("Summary"), "Summary");
});

test("activity stays silent while waiting for input and resumes with a real phase", () => {
  const modulePath = path.resolve(__dirname, "../packages/cli/src/activity");
  const script = `
    const {startActivity,reportActivity,pauseActivity,resumeActivity}=require(${JSON.stringify(modulePath)});
    const stop=startActivity(['init'],{isTTY:true,write:s=>process.stderr.write(s)});
    (async()=>{
      await pauseActivity();
      reportActivity('question must stay visible');
      await new Promise(resolve=>setTimeout(resolve,10100));
      resumeActivity();
      reportActivity('installing codegraph');
      await new Promise(resolve=>setTimeout(resolve,100));
    })().finally(stop);
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /question must stay visible/);
  assert.match(result.stderr, /Working: installing codegraph/);
});

test("CLI logs embedding progress when redirected but suppresses it for machine-output flags", () => {
  const engine = path.resolve(__dirname, "../packages/source-engine/src/embeddings");
  const cli = path.resolve(__dirname, "../packages/cli/src/cli");
  for (const flag of [null, "--json", "--chat-json"]) {
    const script = `
      const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
      const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcpee-progress-cli-'));
      fs.mkdirSync(path.join(root,'.mcpee/state'),{recursive:true});
      fs.writeFileSync(path.join(root,'.mcpee/state/project.json'),'{}');
      require(${JSON.stringify(engine)}).buildEmbeddingIndex=async(root,options)=>{
        options.onProgress?.({phase:'inference',completed:616,total:18989,cached:608,batch_size:1,max_tokens:3981});
        return {chunkCount:1,model:'fixture'};
      };
      require(${JSON.stringify(cli)}).run(['knowledge','embeddings','index','--profile','bge-m3','--project',root,
        ...${JSON.stringify(flag ? [flag] : [])}])
        .then(code=>{process.exitCode=code}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr);
    if (flag) assert.equal(result.stderr, "");
    else assert.match(result.stderr, /inference 616\/18989; cached=608; batch=1; max_tokens=3981/);
    assert.doesNotMatch(result.stdout, /inference|cached=/);
  }
});
