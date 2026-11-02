"use strict";

const { Readable } = require("node:stream");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

const row = (id, name) => ({ pk: { S: id }, name: { S: name } });
const pages = [
  { Items: [row("b", "Bee"), row("a", "Aye")], LastEvaluatedKey: { pk: { S: "a" } } },
  { Items: [], LastEvaluatedKey: { pk: { S: "b" } } },
  { Items: [row("b", "Duplicate"), row("c", "See")] },
];

function controlledTransport({ responses = pages, failAt = -1, onRequest, delay = 0 } = {}) {
  const state = { requests: [], aborts: 0, destroys: 0, pending: 0, bodies: [] };
  const handler = {
    metadata: { handlerProtocol: "http/1.1" },
    destroy() { state.destroys += 1; },
    async handle(request, { abortSignal } = {}) {
      if (abortSignal?.aborted) {
        state.aborts += 1;
        throw Object.assign(new Error("Local request aborted"), { name: "AbortError" });
      }
      const input = JSON.parse(request.body);
      state.requests.push({ input, target: request.headers["x-amz-target"], method: request.method });
      const index = state.requests.length - 1;
      state.pending += 1;
      try {
        await new Promise((resolve, reject) => {
          let timer;
          const cleanup = () => {
            clearTimeout(timer);
            abortSignal?.removeEventListener("abort", abort);
          };
          const abort = () => {
            state.aborts += 1;
            cleanup();
            reject(Object.assign(new Error("Local request aborted"), { name: "AbortError" }));
          };
          abortSignal?.addEventListener("abort", abort, { once: true });
          timer = setTimeout(() => { cleanup(); resolve(); }, delay);
          onRequest?.(index);
        });
        const failure = index === failAt;
        const payload = failure
          ? { __type: "com.amazonaws.dynamodb.v20120810#AccessDeniedException", message: "Local denial" }
          : responses[index] || { Items: [] };
        const body = Readable.from([Buffer.from(JSON.stringify(payload))]);
        state.bodies.push(body);
        return {
          response: {
            statusCode: failure ? 400 : 200,
            headers: { "content-type": "application/x-amz-json-1.0", "x-amzn-requestid": "local-request" },
            body,
          },
        };
      } finally {
        state.pending -= 1;
      }
    },
  };
  return { handler, state };
}

function borrowedClient(handler) {
  return new DynamoDBClient({
    region: "us-east-1",
    credentials: { accessKeyId: "LOCAL_ONLY", secretAccessKey: "LOCAL_ONLY" },
    endpoint: "http://127.0.0.1:1",
    requestHandler: handler,
    maxAttempts: 1,
  });
}

module.exports = { controlledTransport, borrowedClient };
