# AWS SDK runtime oracle

Guide: `aws-engineering`. Oracle ID: `aws-sdk-runtime`.

This fixture executes the actual pinned AWS SDK for JavaScript v3 DynamoDB
client, JSON protocol serializer/deserializer, and native `paginateScan`
semantics against a controlled in-memory HTTP transport. It is **not AWS IAM,
AWS service, or production validation**. No real accounts, credentials,
deployment, sockets, or AWS access are needed. `LOCAL_ONLY` signing values are
dummy inputs, not credentials. The request handler is supplied locally.

Copy this directory to an isolated workspace. With Node.js >=24, install via
`npm ci --ignore-scripts --no-audit --no-fund`, then run exactly:

```text
node run-oracle.cjs
```

Use tool `node`, args `["run-oracle.cjs"]`, timeout `60000` milliseconds.
Dependency installation is a separate setup operation, not acceptance.

Only `scanner.cjs` is mutable. Repair `scanTable({ tableName, signal,
requestHandler, client })` to exhaust native SDK pagination (including empty
continuation pages), return `{ id, name }` rows sorted by ID, retain the first
row for duplicate IDs, forward cancellation, preserve SDK failures, and destroy
only internally created clients in `finally`. Caller-supplied clients remain
caller-owned. Never replace the injected transport with a real network handler.

Immutable inventory (including **every imported local helper**):
`package.json`, `package-lock.json`, `run-oracle.cjs`, `checks.cjs`,
`transport.cjs`, `README.md`. `node_modules` is generated only in disposable
copies and is not part of the fixture inventory.

The shipped implementation is intentionally defective. It executes real SDK
requests before failing behavioral assertions. The repository test supplies a
test-only repaired control without changing the checker, then verifies
semantic mutations fail the same immutable checker.

Check IDs, in order:

- `native-pagination`
- `stable-aggregation`
- `empty-results`
- `inflight-cancellation`
- `preaborted-cancellation`
- `service-failure-propagation`
- `owned-transport-cleanup`
- `borrowed-client-ownership`

Success emits `MCPEE_ORACLE_RESULT` with schema version 1 and all check IDs.
Behavioral assertion failures emit `MCPEE_ORACLE_FAILURE` with only known
failing check IDs and exit 1. Missing dependencies, syntax/import failures,
unexpected execution failures, and setup errors emit no acceptance marker.
The controlled handler observes serialized SDK requests, implements
AbortSignal handling and transport disposal, and returns real JSON response
streams for SDK deserialization. It does not emulate all AWS retry,
authentication, network pooling, IAM, or service-side behavior.
