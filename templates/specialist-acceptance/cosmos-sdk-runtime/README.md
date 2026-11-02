# Cosmos SDK runtime behavior

This is a bounded local acceptance fixture for the pinned Azure Cosmos DB
JavaScript SDK. Use Node.js >=22 and npm. From a disposable copy of this whole
directory, run:

```text
npm ci
node run-oracle.cjs
```

The initial `solution.cjs` is deliberately incorrect. Repair only that file;
the checker and its local HTTP gateway are immutable. The gateway binds to
loopback on an ephemeral port and supplies controlled Cosmos-shaped HTTP
responses. It uses no emulator, cloud account, credentials, or external
service.

The checks execute SDK create/read/feed calls and verify the SDK's partition
key headers, continuation handling, request cancellation, its point-read 404
response contract, and propagation of a non-404 query error. The fixture tests SDK/client behavior against a
transport double only. It does **not** establish actual Cosmos DB partition
routing, request-unit charges, consistency guarantees, service retries,
transaction behavior, or account-level behavior. The request-charge header
check verifies SDK response mapping, not actual RU consumption.

All fixture files are enumerated in `oracle.json`. `solution.cjs` is the only
mutable file; the manifest, README, lockfile, checker, and runner are immutable.
