"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const definitions = {
  azure: {
    id: "azure-sdk-runtime",
    checks: [
      "azure-sdk-load",
      "azure-list-pagination",
      "azure-request-page-size",
      "azure-transient-retry",
      "azure-permanent-error-propagation",
      "azure-abort-propagation",
    ],
  },
  bicep: {
    id: "bicep-output-contract",
    checks: [
      "bicep-compile",
      "storage-https-only",
      "storage-tls12",
      "storage-no-public-blobs",
      "storage-deny-network-default",
      "storage-output-resource-id",
      "storage-parameter-wiring",
    ],
  },
};

function response(request, status, body, contentType = "application/xml") {
  const { createHttpHeaders } = require("@azure/core-rest-pipeline");
  const headers = createHttpHeaders({
    "content-type": contentType,
    "x-ms-request-id": "mcpee-controlled-transport",
    "retry-after-ms": "1",
  });
  // Storage's public httpClient option accepts legacy HttpHeadersLike responses.
  headers.toJson = () => headers.toJSON();
  return {
    request, status,
    headers,
    bodyAsText: body,
  };
}

function containers(names, nextMarker = "") {
  return `<?xml version="1.0" encoding="utf-8"?>
<EnumerationResults ServiceEndpoint="https://mcpee.invalid/">
<Containers>${names.map(name => `<Container><Name>${name}</Name><Properties><Last-Modified>Mon, 01 Jan 2024 00:00:00 GMT</Last-Modified><Etag>mcpee</Etag></Properties></Container>`).join("")}</Containers>
<NextMarker>${nextMarker}</NextMarker></EnumerationResults>`;
}

async function azureChecks(check) {
  const { BlobServiceClient } = require("@azure/storage-blob");
  const { listContainerNames } = require("./azure-client.cjs");
  const client = sendRequest => new BlobServiceClient("https://mcpee.invalid", undefined, {
    httpClient: { sendRequest },
    retryOptions: { maxTries: 3, retryDelayInMs: 1, maxRetryDelayInMs: 1 },
  });
  const probe = client(async request => response(request, 200, containers(["transport-probe"])));
  const probePage = await probe.listContainers().byPage({ maxPageSize: 2 }).next();
  assert.deepEqual(probePage.value.containerItems.map(item => item.name), ["transport-probe"],
    "SDK transport/deserializer setup must work independently of the candidate");
  await check("azure-sdk-load", () => assert.equal(typeof BlobServiceClient, "function"));

  const requests = [];
  const paginated = client(async request => {
    requests.push(request);
    const url = new URL(request.url);
    return response(request, 200, url.searchParams.get("marker") === "next-page"
      ? containers(["gamma"])
      : containers(["alpha", "beta"], "next-page"));
  });
  const names = await listContainerNames(paginated, new AbortController().signal);
  await check("azure-list-pagination", () => {
    assert.deepEqual(names, ["alpha", "beta", "gamma"]);
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[1].url).searchParams.get("marker"), "next-page");
  });
  await check("azure-request-page-size", () => {
    assert.ok(requests.length > 0);
    for (const request of requests) {
      assert.equal(request.method, "GET");
      assert.equal(new URL(request.url).hostname, "mcpee.invalid");
      assert.equal(new URL(request.url).searchParams.get("comp"), "list");
      assert.equal(new URL(request.url).searchParams.get("maxresults"), "2");
    }
  });

  let attempts = 0;
  const transient = client(async request => {
    attempts += 1;
    return attempts === 1
      ? response(request, 503, "<Error><Code>ServerBusy</Code><Message>Controlled transient failure</Message></Error>")
      : response(request, 200, containers(["recovered"]));
  });
  await check("azure-transient-retry", async () => {
    assert.deepEqual(await listContainerNames(transient), ["recovered"]);
    assert.equal(attempts, 2);
  });

  let permanentAttempts = 0;
  const forbidden = client(async request => {
    permanentAttempts += 1;
    return response(request, 403, "<Error><Code>AuthorizationFailure</Code><Message>Controlled denial</Message></Error>");
  });
  await check("azure-permanent-error-propagation", async () => {
    await assert.rejects(() => listContainerNames(forbidden), error =>
      error.name === "RestError" && error.statusCode === 403 && error.code === "AuthorizationFailure");
    assert.equal(permanentAttempts, 1);
  });

  const controller = new AbortController();
  controller.abort();
  let uncancelledRequests = 0;
  const cancellable = client(async request => {
    if (request.abortSignal?.aborted) {
      const error = new Error("Controlled cancellation");
      error.name = "AbortError";
      throw error;
    }
    uncancelledRequests += 1;
    return response(request, 200, containers(["should-not-arrive"]));
  });
  await check("azure-abort-propagation", async () => {
    await assert.rejects(() => listContainerNames(cancellable, controller.signal), { name: "AbortError" });
    assert.equal(uncancelledRequests, 0);
  });
}

async function bicepChecks(check) {
  const executable = process.env.MCPEE_BICEP_PATH || "bicep";
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "node_test_context") delete env[key];
  }
  const version = spawnSync(executable, ["--version"], { env, encoding: "utf8", timeout: 15000 });
  if (version.error || version.status !== 0 || !/^Bicep CLI version 0\.39\.26\b/.test(version.stdout || "")) {
    throw new Error(`Bicep 0.39.26 is required (MCPEE_BICEP_PATH): ${version.error?.message || version.stdout || version.stderr}`);
  }
  const built = spawnSync(executable, ["build", "main.bicep", "--stdout", "--no-restore"], {
    cwd: __dirname, env, encoding: "utf8", timeout: 30000,
  });
  if (built.error || built.status !== 0) {
    throw new Error(`Bicep compilation failed: ${built.error?.message || built.stderr}`);
  }
  const template = JSON.parse(built.stdout);
  const resources = Array.isArray(template.resources) ? template.resources : Object.values(template.resources || {});
  const storage = resources.find(item => item.type === "Microsoft.Storage/storageAccounts");
  await check("bicep-compile", () => {
    assert.ok(template.$schema);
    assert.ok(storage, "compiled storage resource is required");
  });
  await check("storage-https-only", () => assert.equal(storage?.properties?.supportsHttpsTrafficOnly, true));
  await check("storage-tls12", () => assert.equal(storage?.properties?.minimumTlsVersion, "TLS1_2"));
  await check("storage-no-public-blobs", () => assert.equal(storage?.properties?.allowBlobPublicAccess, false));
  await check("storage-deny-network-default", () => {
    assert.equal(storage?.properties?.networkAcls?.defaultAction, "Deny");
    assert.equal(storage?.properties?.networkAcls?.bypass, "None");
  });
  await check("storage-output-resource-id", () => assert.equal(
    template.outputs?.storageId?.value,
    "[resourceId('Microsoft.Storage/storageAccounts', parameters('accountName'))]",
  ));
  await check("storage-parameter-wiring", () => {
    assert.equal(storage?.location, "[parameters('location')]");
    assert.equal(storage?.name, "[parameters('accountName')]");
    assert.equal(template.parameters?.location?.type, "string");
    assert.equal(template.parameters?.accountName?.type, "string");
  });
}

async function runChecks(mode) {
  const failures = [];
  const seen = [];
  const check = async (id, action) => {
    seen.push(id);
    try {
      await action();
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
      failures.push(id);
      process.stderr.write(`${id}: ${error.message}\n`);
    }
  };
  if (mode === "azure") await azureChecks(check);
  else await bicepChecks(check);
  assert.deepEqual(seen, definitions[mode].checks, "immutable checker must execute every declared check");
  return failures;
}

module.exports = { definitions, runChecks };
