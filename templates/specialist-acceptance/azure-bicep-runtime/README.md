# Local Azure SDK and Bicep contracts

These are two **bounded, local native oracles**, not Azure deployment acceptance.
The shipped implementation is intentionally defective. Repair only the candidate
file for the selected oracle; the checker is immutable. No account, credential,
Azure CLI, provider action, or service endpoint is used.

## Preparation

Copy this entire directory to a unique disposable working directory. Restore
dependencies there with `npm ci --ignore-scripts --no-audit --no-fund`; never
install dependencies or write repaired controls into the shipped fixture.
Use Node.js 24+ and the checked-in lockfile. Strip inherited
`npm_config_allow_scripts` case-insensitively before invoking npm.

For Bicep, provide **Bicep CLI 0.39.26**, either on PATH or via the absolute
`MCPEE_BICEP_PATH` environment variable. Official release assets and SHA256 digests:
<https://github.com/Azure/bicep/releases/tag/v0.39.26>.
For Windows x64, download `bicep-win-x64.exe` into a unique local tools directory;
verify SHA256
`c8987f2e7a55012f52111124e494963e71815961a7f7a3a7767e188dfba7d74b`
before use. There is no global installation or automatic compiler download.
Missing/wrong compiler versions, dependency restore failures, malformed source,
and compilation errors are setup failures, **not** behavioral evidence.

## Azure engineering: `azure-sdk-runtime`

Run `node run-oracle.cjs azure` (60-second bound). The sole mutable file is
`azure-client.cjs`. All other runtime files are immutable for this oracle, including
`main.bicep`, both package files, `checks.cjs`, `run-oracle.cjs`, and this README.
No external helper is used. The pinned Azure Storage SDK runs its real request pipeline,
XML deserializer, retry policy, and async paging implementation against a
controlled in-memory `httpClient`. No HTTP request leaves the process.
Anonymous client construction needs no real or fake authentication credential.

Checks, in stable order:

- `azure-sdk-load`
- `azure-list-pagination`
- `azure-request-page-size`
- `azure-transient-retry`
- `azure-permanent-error-propagation`
- `azure-abort-propagation`

The candidate must consume all continuation pages in order, request page size 2,
preserve native transient retries, propagate permanent REST failures, and forward
an abort signal. Baseline assertions fail because it stops after the first page,
requests size 1, suppresses errors, and drops cancellation.

**Limitations:** this verifies client-side SDK behavior only. Azure authentication,
RBAC, service-side pagination/retry semantics, actual network cancellation,
availability, and live storage behavior remain unverified. It does not certify
cloud infrastructure or whole-guide Azure coverage.

SDK references:
<https://learn.microsoft.com/en-us/javascript/api/@azure/storage-blob/blobserviceclient>
and <https://learn.microsoft.com/en-us/javascript/api/@azure/core-rest-pipeline/httpclient>.

## Bicep engineering: `bicep-output-contract`

Run `node run-oracle.cjs bicep` (60-second bound). The sole mutable file is
`main.bicep`. All other runtime files are immutable for this oracle, including
`azure-client.cjs`, both package files, `checks.cjs`, `run-oracle.cjs`, and this README.
No external helper is used. `.gitignore` is repository housekeeping, not packaged
runtime evidence for either oracle.

The real pinned compiler executes `build main.bicep --stdout --no-restore`.
Assertions inspect its emitted ARM JSON, not the source text. The baseline
successfully compiles but emits incorrect storage security settings and a name
instead of the resource-ID output.

Checks, in stable order:

- `bicep-compile`
- `storage-https-only`
- `storage-tls12`
- `storage-no-public-blobs`
- `storage-deny-network-default`
- `storage-output-resource-id`
- `storage-parameter-wiring`

**Limitations:** this is a compiler-output contract, **not runtime Azure cloud
coverage**. It does not evaluate ARM expressions on a service, validate a
deployment, deploy resources, or verify policy, drift, resource state, role
assignments, private connectivity, or service behavior.
Compiler reference: <https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/bicep-cli#build>.

## Evidence protocol

The final stdout line is exactly one `MCPEE_ORACLE_RESULT` JSON object with all
stable check IDs on success, or one `MCPEE_ORACLE_FAILURE` JSON object listing
only actual failed assertion IDs on behavioral failure (exit 1).
Other errors print `MCPEE_ORACLE_SETUP_ERROR` to stderr, exit 1, and emit neither
evidence marker. No external helper module is imported: local imports are
`checks.cjs` and (Azure only) `azure-client.cjs`; SDK imports come exclusively from
the enumerated local manifest and lockfile. The Bicep subprocess clears inherited
`NODE_TEST_CONTEXT`.
