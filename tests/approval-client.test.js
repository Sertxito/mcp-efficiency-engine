"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const { requestApprovalFromHost } = require("../packages/cli/src/cli");

async function withBroker(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const environment = {
    MCPEE_APPROVAL_BROKER_URL: `http://127.0.0.1:${server.address().port}/approve`,
    MCPEE_APPROVAL_BROKER_TOKEN: "synthetic-test-token",
  };
  try { await run(environment); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test("host approval uses direct loopback HTTP with an explicit human-wait deadline", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("fetch headers deadline must not govern human approval"); });
  const timeout = t.mock.method(AbortSignal, "timeout", milliseconds => {
    assert.equal(milliseconds, 600_000);
    return new AbortController().signal;
  });
  await withBroker((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/approve");
    assert.equal(request.headers.authorization, "Bearer synthetic-test-token");
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      assert.deepEqual(JSON.parse(body), { kind: "maintenance", details: { action: "fixture-test" } });
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"approved":true}');
      }, 20);
    });
  }, async environment => {
    assert.equal(await requestApprovalFromHost("maintenance", { action: "fixture-test" }, environment), true);
  });
  assert.equal(timeout.mock.callCount(), 1);
});

test("host approval preserves denial and fails explicitly on HTTP, shape and oversized responses", async () => {
  for (const sample of [
    { status: 200, body: '{"approved":false}', result: false },
    { status: 403, body: '{"approved":false}', error: /HTTP 403/ },
    { status: 200, body: '{"approved":"yes"}', error: /invalid decision/ },
    { status: 200, body: "{", error: /JSON/ },
    { status: 200, body: "x".repeat(65537), error: /exceeds 65536 bytes/ },
  ]) {
    await withBroker((_request, response) => {
      response.writeHead(sample.status);
      response.end(sample.body);
    }, async environment => {
      const decision = requestApprovalFromHost("maintenance", {}, environment);
      if (sample.error) await assert.rejects(decision, sample.error);
      else assert.equal(await decision, sample.result);
    });
  }
});

test("host approval has no implicit success fallback and rejects non-loopback or incomplete configuration", async () => {
  assert.equal(await requestApprovalFromHost("maintenance", {}, {}), null);
  await assert.rejects(requestApprovalFromHost("maintenance", {}, {
    MCPEE_APPROVAL_BROKER_URL: "http://127.0.0.1:1234/approve",
  }), /incompletely configured/);
  for (const url of ["https://127.0.0.1/approve", "http://example.com/approve",
    "http://user:password@127.0.0.1/approve", "http://127.0.0.1/approve?redirect=1"]) {
    await assert.rejects(requestApprovalFromHost("maintenance", {}, {
      MCPEE_APPROVAL_BROKER_URL: url, MCPEE_APPROVAL_BROKER_TOKEN: "synthetic",
    }), /authenticated loopback/);
  }
});

test("host approvals use separate connections rather than reusing idle sockets", async () => {
  const sockets = new Set();
  await withBroker((request, response) => {
    sockets.add(request.socket);
    request.resume();
    request.on("end", () => response.end('{"approved":true}'));
  }, async environment => {
    assert.equal(await requestApprovalFromHost("maintenance", {}, environment), true);
    assert.equal(await requestApprovalFromHost("maintenance", {}, environment), true);
  });
  assert.equal(sockets.size, 2);
});

test("host approval fails on connection reset and deadline abort without approving", async t => {
  await withBroker(request => request.socket.destroy(), async environment => {
    await assert.rejects(requestApprovalFromHost("maintenance", {}, environment), /socket hang up|ECONNRESET/);
  });
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => controller.signal);
  await withBroker(request => {
    request.resume();
    controller.abort(new Error("synthetic approval deadline"));
  }, async environment => {
    await assert.rejects(requestApprovalFromHost("maintenance", {}, environment), error =>
      error.name === "AbortError");
  });
});
