"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { startActivity } = require("../packages/cli/src/activity");

test("activity is silent for nonterminals, JSON and help", () => {
  for (const args of [["sync", "--json"], ["run", "--chat-json"], ["help"]]) {
    startActivity(args, { isTTY: true })();
  }
  startActivity(["sync"], { isTTY: false })();
});

test("activity reports during synchronous work and does not write to stdout", () => {
  const modulePath = path.resolve(__dirname, "../packages/cli/src/activity");
  const script = `
    const {startActivity,reportActivity}=require(${JSON.stringify(modulePath)});
    const stop=startActivity(['sync'],{isTTY:true,write:s=>process.stderr.write(s)});
    reportActivity('test phase');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
    stop();
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Working: test phase; elapsed \d+s/);
});
