"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { test } = require("node:test");
const { CosmosClient } = require("@azure/cosmos");
const solution = require("./solution.cjs");

const checkIds = [
  "write-partition-key-routing",
  "point-read-partition-key-routing",
  "continuation-pagination",
  "request-cancellation",
  "point-read-not-found-response",
  "query-error-propagation",
];

const containerResource = {
  id: "fixture-items",
  _rid: "fixture-items-rid",
  _self: "dbs/fixture-db/colls/fixture-items/",
  _etag: '"fixture-container"',
  _ts: 1,
  partitionKey: { paths: ["/tenantId"], kind: "Hash", version: 2 },
};

function response(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    connection: "close",
    "x-ms-activity-id": "fixture-activity",
    "x-ms-request-charge": "1.25",
    ...headers,
  });
  res.end(text);
}

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function partitionKeyOf(request) {
  const header = request.headers["x-ms-documentdb-partitionkey"];
  if (header === undefined) return undefined;
  try {
    return JSON.parse(header);
  } catch {
    return header;
  }
}

async function makeGateway() {
  const records = [];
  const waiters = [];
  let resolveSlowClose;
  const closedSlowRequest = new Promise(resolve => {
    resolveSlowClose = resolve;
  });
  const server = http.createServer((request, res) => {
    void (async () => {
      const body = await bodyOf(request);
      const url = new URL(request.url, "http://127.0.0.1");
      const record = {
        method: request.method,
        path: url.pathname,
        headers: request.headers,
        body,
        partitionKey: partitionKeyOf(request),
      };
      records.push(record);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (waiter.predicate(record)) {
          waiters.splice(index, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(record);
        }
      }

      if (request.method === "GET" && /\/dbs\/fixture-db\/colls\/fixture-items\/?$/.test(url.pathname)) {
        response(res, 200, containerResource);
        return;
      }

      const docsPath = "/dbs/fixture-db/colls/fixture-items/docs";
      if (request.method === "POST" && url.pathname === docsPath &&
          request.headers["x-ms-cosmos-is-query-plan-request"]?.toLowerCase() === "true") {
        response(res, 200, {
          partitionedQueryExecutionInfoVersion: 1,
          queryInfo: {
            distinctType: "None",
            groupByAliasToAggregateType: {},
            aggregates: [],
            orderBy: [],
            rewrittenQuery: "SELECT * FROM c",
          },
          queryRanges: [{
            min: "",
            max: "FF",
            isMinInclusive: true,
            isMaxInclusive: false,
          }],
        });
        return;
      }

      if (request.method === "POST" && url.pathname === docsPath &&
          request.headers["x-ms-documentdb-isquery"]?.toLowerCase() === "true") {
        const key = record.partitionKey?.[0];
        if (key === "error-tenant") {
          response(res, 400, { code: 400, message: "fixture query error" }, {
            "x-ms-activity-id": "fixture-query-error-activity",
          });
          return;
        }
        if (key === "slow-tenant") {
          const timer = setTimeout(() => response(res, 200, { Documents: [{ id: "slow" }] }), 350);
          res.once("close", () => {
            clearTimeout(timer);
            if (!res.writableEnded) resolveSlowClose(true);
          });
          return;
        }

        const continuation = request.headers["x-ms-continuation"];
        const page = continuation === "page-2" ? [{ id: "c", tenantId: "tenant-a" }]
          : [{ id: "a", tenantId: "tenant-a" }, { id: "b", tenantId: "tenant-a" }];
        response(res, 200, { Documents: page }, continuation === "page-2"
          ? {}
          : { "x-ms-continuation": "page-2" });
        return;
      }

      if (request.method === "POST" && url.pathname === docsPath) {
        const item = body;
        const expectedPartition = [item?.tenantId];
        if (JSON.stringify(record.partitionKey) !== JSON.stringify(expectedPartition)) {
          response(res, 400, { code: 400, message: "partition key does not match document" });
          return;
        }
        response(res, 201, item, { "x-ms-request-charge": "2.5" });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith(`${docsPath}/`)) {
        const id = decodeURIComponent(url.pathname.slice(docsPath.length + 1));
        if (JSON.stringify(record.partitionKey) !== JSON.stringify(["tenant-a"])) {
          response(res, 404, { code: 404, message: "item was not found in this partition" });
          return;
        }
        if (id === "missing") {
          response(res, 404, { code: 404, message: "item does not exist" }, {
            "x-ms-activity-id": "fixture-not-found-activity",
            "x-ms-request-charge": "1.0",
          });
          return;
        }
        response(res, 200, { id, tenantId: "tenant-a", value: "seeded" });
        return;
      }

      response(res, 404, { code: 404, message: `unexpected request ${request.method} ${url.pathname}` });
    })().catch(error => {
      if (!res.headersSent) response(res, 500, { code: 500, message: error.message });
      else res.destroy(error);
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const client = new CosmosClient({
    endpoint: `http://127.0.0.1:${address.port}`,
    key: Buffer.alloc(64, 1).toString("base64"),
    connectionPolicy: { enableEndpointDiscovery: false },
  });

  return {
    records,
    client,
    container: client.database("fixture-db").container("fixture-items"),
    waitForRequest(predicate) {
      const found = records.find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(new Error("timed out waiting for the local SDK request"));
          }, 3000),
        };
        waiters.push(waiter);
      });
    },
    closedSlowRequest,
    async close() {
      client.dispose();
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    },
  };
}

async function withGateway(action) {
  const gateway = await makeGateway();
  try {
    await action(gateway);
  } finally {
    await gateway.close();
  }
}

function findRecord(gateway, predicate) {
  const record = gateway.records.find(predicate);
  assert.ok(record, `expected a matching SDK request; observed ${gateway.records.map(
    item => `${item.method} ${item.path}`,
  ).join(", ")}`);
  return record;
}

test(checkIds[0], async () => {
  await withGateway(async gateway => {
    const item = { id: "doc-1", tenantId: "tenant-a", value: "written" };
    const result = await solution.createItem(gateway.container, item);
    assert.equal(result.resource.id, "doc-1");
    assert.equal(result.requestCharge, 2.5, "SDK maps the controlled response charge header");
    const write = findRecord(gateway, record => record.method === "POST" && record.body?.id === "doc-1");
    assert.deepEqual(write.partitionKey, ["tenant-a"]);
  });
});

test(checkIds[1], async () => {
  await withGateway(async gateway => {
    const result = await solution.readItem(gateway.container, "doc-1", "tenant-a");
    assert.equal(result.resource.id, "doc-1");
    const read = findRecord(gateway, record => record.method === "GET" &&
      record.path.endsWith("/docs/doc-1"));
    assert.deepEqual(read.partitionKey, ["tenant-a"]);
  });
});

test(checkIds[2], async () => {
  await withGateway(async gateway => {
    const items = await solution.readItems(gateway.container, {
      partitionKey: "tenant-a",
      maxItemCount: 2,
    });
    assert.deepEqual(items.map(item => item.id), ["a", "b", "c"]);
    const pages = gateway.records.filter(record => record.method === "POST" &&
      record.path.endsWith("/docs") &&
      record.headers["x-ms-documentdb-isquery"]?.toLowerCase() === "true" &&
      record.headers["x-ms-cosmos-is-query-plan-request"] === undefined);
    assert.equal(pages.length, 2, "SDK must make a request for each continuation page");
    assert.deepEqual(pages[0].partitionKey, ["tenant-a"]);
    assert.equal(pages[0].headers["x-ms-max-item-count"], "2");
    assert.equal(pages[1].headers["x-ms-continuation"], "page-2");
  });
});

test(checkIds[3], async () => {
  await withGateway(async gateway => {
    const controller = new AbortController();
    const pending = solution.readItems(gateway.container, {
      partitionKey: "slow-tenant",
      maxItemCount: 1,
      signal: controller.signal,
    });
    await gateway.waitForRequest(record => record.method === "POST" &&
      record.path.endsWith("/docs") &&
      record.headers["x-ms-documentdb-isquery"]?.toLowerCase() === "true" &&
      record.partitionKey?.[0] === "slow-tenant");
    controller.abort(new Error("fixture cancellation"));
    await assert.rejects(pending);
    assert.equal(await Promise.race([
      gateway.closedSlowRequest,
      new Promise(resolve => setTimeout(() => resolve(false), 1000)),
    ]), true, "cancellation must close the local HTTP response");
  });
});

test(checkIds[4], async () => {
  await withGateway(async gateway => {
    const result = await solution.readItem(gateway.container, "missing", "tenant-a");
    assert.equal(result.statusCode, 404);
    assert.equal(result.activityId, "fixture-not-found-activity");
  });
});

test(checkIds[5], async () => {
  await withGateway(async gateway => {
    await assert.rejects(
      solution.readItems(gateway.container, { partitionKey: "error-tenant" }),
      error => error.code === 400 && error.activityId === "fixture-query-error-activity",
    );
  });
});
