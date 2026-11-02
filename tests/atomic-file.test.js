"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { renameAtomicSync } = require("../packages/core/src/atomic-file");

test("atomic replacement retries only bounded Windows sharing conflicts and surfaces permanent failures", () => {
  const original = fs.renameSync;
  let calls = 0;
  try {
    fs.renameSync = () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("Sharing conflict"), { code: "EPERM" });
    };
    if (process.platform === "win32") {
      renameAtomicSync("source", "destination");
      assert.equal(calls, 3);
    } else {
      assert.throws(() => renameAtomicSync("source", "destination"), /Sharing conflict/);
      assert.equal(calls, 1);
    }
    calls = 0;
    fs.renameSync = () => { calls++; throw Object.assign(new Error("Permanent denial"), { code: "EACCES" }); };
    assert.throws(() => renameAtomicSync("source", "destination"), /Permanent denial/);
    assert.equal(calls, process.platform === "win32" ? 6 : 1);
    calls = 0;
    fs.renameSync = () => { calls++; throw Object.assign(new Error("Missing source"), { code: "ENOENT" }); };
    assert.throws(() => renameAtomicSync("source", "destination"), /Missing source/);
    assert.equal(calls, 1);
  } finally {
    fs.renameSync = original;
  }
});
