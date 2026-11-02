"use strict";

const assert = require("node:assert/strict");
const { ScanCommand } = require("@aws-sdk/client-dynamodb");
const { controlledTransport, borrowedClient } = require("./transport.cjs");

const checks = [
  "native-pagination",
  "stable-aggregation",
  "empty-results",
  "inflight-cancellation",
  "preaborted-cancellation",
  "service-failure-propagation",
  "owned-transport-cleanup",
  "borrowed-client-ownership",
];
const expected = [
  { id: "a", name: "Aye" },
  { id: "b", name: "Bee" },
  { id: "c", name: "See" },
];

async function runChecks() {
  if (require("@aws-sdk/client-dynamodb/package.json").version !== "3.1161.0") {
    throw new Error("Run npm ci with the shipped lockfile; AWS SDK 3.1161.0 is required.");
  }
  const { scanTable } = require("./scanner.cjs");
  if (typeof scanTable !== "function") throw new Error("scanner.cjs must export scanTable.");
  const execute = (transport, extra = {}) => scanTable({
    tableName: "LocalInventory",
    requestHandler: transport.handler,
    ...extra,
  });
  const cases = [
    async () => {
      const transport = controlledTransport();
      await execute(transport);
      assert.deepEqual(transport.state.requests, [
        { input: { TableName: "LocalInventory" }, target: "DynamoDB_20120810.Scan", method: "POST" },
        { input: { TableName: "LocalInventory", ExclusiveStartKey: { pk: { S: "a" } } }, target: "DynamoDB_20120810.Scan", method: "POST" },
        { input: { TableName: "LocalInventory", ExclusiveStartKey: { pk: { S: "b" } } }, target: "DynamoDB_20120810.Scan", method: "POST" },
      ]);
    },
    async () => {
      const transport = controlledTransport();
      assert.deepEqual(await execute(transport), expected);
    },
    async () => {
      const transport = controlledTransport({ responses: [{}] });
      assert.deepEqual(await execute(transport), []);
      assert.equal(transport.state.requests.length, 1);
    },
    async () => {
      const controller = new AbortController();
      const transport = controlledTransport({
        delay: 30,
        onRequest: () => setImmediate(() => controller.abort()),
      });
      await assert.rejects(execute(transport, { signal: controller.signal }), { name: "AbortError" });
      assert.equal(transport.state.aborts, 1);
      assert.equal(transport.state.requests.length, 1);
      assert.equal(transport.state.pending, 0);
    },
    async () => {
      const controller = new AbortController();
      controller.abort();
      const transport = controlledTransport();
      await assert.rejects(execute(transport, { signal: controller.signal }), { name: "AbortError" });
      assert.equal(transport.state.requests.length, 0);
    },
    async () => {
      const transport = controlledTransport({ failAt: 1 });
      await assert.rejects(execute(transport), error => {
        assert.equal(error.name, "AccessDeniedException");
        assert.equal(error.message, "Local denial");
        assert.equal(error.$metadata.httpStatusCode, 400);
        assert.equal(error.$metadata.requestId, "local-request");
        return true;
      });
      assert.equal(transport.state.requests.length, 2);
    },
    async () => {
      for (const mode of ["success", "failure", "abort"]) {
        const controller = new AbortController();
        const transport = controlledTransport({
          failAt: mode === "failure" ? 0 : -1,
          delay: mode === "abort" ? 30 : 0,
          onRequest: mode === "abort" ? () => setImmediate(() => controller.abort()) : undefined,
        });
        // Inspect cleanup even if a candidate swallows the error; propagation has its own check.
        await execute(transport, { signal: controller.signal }).catch(() => undefined);
        assert.equal(transport.state.destroys, 1, `${mode}: owned transport must be destroyed exactly once`);
        assert.equal(transport.state.pending, 0);
        assert.ok(transport.state.bodies.every(body => body.readableEnded), `${mode}: SDK must consume response bodies`);
      }
    },
    async () => {
      const transport = controlledTransport();
      const client = borrowedClient(transport.handler);
      try {
        await execute(transport, { client });
        assert.equal(transport.state.destroys, 0, "borrowed client must remain caller-owned");
        await client.send(new ScanCommand({ TableName: "CallerStillWorks" }));
        assert.equal(transport.state.requests.at(-1).input.TableName, "CallerStillWorks");
      } finally {
        client.destroy();
      }
      assert.equal(transport.state.destroys, 1);
    },
  ];
  const failed = [];
  for (let index = 0; index < checks.length; index += 1) {
    try {
      await cases[index]();
      console.log(`CHECK ${checks[index]} passed`);
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
      failed.push(checks[index]);
      console.log(`CHECK ${checks[index]} failed: ${error.message}`);
    }
  }
  return failed;
}

module.exports = { checks, runChecks };
