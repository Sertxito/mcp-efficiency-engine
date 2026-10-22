"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { mapBounded } = require("./worker.cjs");

test("normal: bounded parallelism and stable result ordering", async () => {
  let active = 0;
  let maximum = 0;
  const result = await mapBounded([3, 1, 2, 0, 4], 2, async value => {
    active += 1;
    maximum = Math.max(maximum, active);
    for (let turn = 0; turn <= value; turn += 1) await nextTurn();
    active -= 1;
    return value * 10;
  });
  assert.deepEqual(result, [30, 10, 20, 0, 40]);
  assert.equal(maximum, 2, "fill but never exceed the available capacity");
  assert.equal(active, 0);
});

test("failure: rejected and synchronously thrown worker errors are propagated", async () => {
  const asyncError = new Error("fixture async failure");
  await assert.rejects(mapBounded([1, 2], 1, async () => { throw asyncError; }),
    error => error === asyncError);
  const syncError = new Error("fixture sync failure");
  await assert.rejects(mapBounded([1], 1, () => { throw syncError; }),
    error => error === syncError);
});

test("failure: no new work is scheduled after a worker failure", async () => {
  const error = new Error("first job failed");
  const started = [];
  await assert.rejects(mapBounded([0, 1, 2], 1, async value => {
    started.push(value);
    throw error;
  }), actual => actual === error);
  assert.deepEqual(started, [0]);
});

test("failure: one runner failing stops other runners from taking more work", async () => {
  const failure = new Error("parallel job failed");
  const started = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const result = mapBounded([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (value === 0) throw failure;
    await pending;
    return value;
  });
  const rejected = assert.rejects(result, error => error === failure);
  await nextTurn();
  release();
  await rejected;
  await nextTurn();
  assert.deepEqual(started, [0, 1], "a surviving runner must not continue after global failure");
});

test("failure: falsy thrown reasons are not mistaken for successful completion", async () => {
  for (const reason of [undefined, null, false, 0, ""]) {
    await assert.rejects(mapBounded([1], 1, async () => { throw reason; }),
      actual => actual === reason);
  }
});

test("failure: cancellation stops scheduling and reaches the worker", async () => {
  const controller = new AbortController();
  const reason = new Error("fixture cancellation");
  const started = [];
  await assert.rejects(mapBounded([0, 1, 2], 1, async (value, index, signal) => {
    assert.equal(signal, controller.signal);
    started.push(index);
    controller.abort(reason);
    await nextTurn();
    signal.throwIfAborted();
    return value;
  }, { signal: controller.signal }), error => error === reason);
  assert.deepEqual(started, [0]);
});

test("boundary: pre-aborted input never starts work", async () => {
  const controller = new AbortController();
  controller.abort(new Error("already cancelled"));
  let calls = 0;
  await assert.rejects(mapBounded([1], 2, async () => { calls += 1; },
    { signal: controller.signal }), error => error === controller.signal.reason);
  assert.equal(calls, 0);
});

test("failure: scheduler observes cancellation even when a worker returns normally", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled by a completed worker");
  const started = [];
  await assert.rejects(mapBounded([0, 1, 2], 1, async value => {
    started.push(value);
    controller.abort(reason);
    return value;
  }, { signal: controller.signal }), actual => actual === reason);
  assert.deepEqual(started, [0]);
});

test("boundary: invalid limits reject and empty input is valid", async () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity, "2", null]) {
    await assert.rejects(mapBounded([1], limit, async value => value), RangeError);
  }
  let calls = 0;
  assert.deepEqual(await mapBounded([], 2, async () => { calls += 1; }), []);
  assert.equal(calls, 0);
});
