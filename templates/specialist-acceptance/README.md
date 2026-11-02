# Specialist acceptance fixtures

These are evaluation inputs, not application helpers or activated skills.
The complete scenario contract is in `catalog/specialist-acceptance.json` in the
installed MCPEE package. See the [acceptance protocol](../../docs/SPECIALIST-ACCEPTANCE.md).

## Node bounded operation

Copy `node-bounded-operation` into a disposable project with a supported Node.js
runtime. Do not edit the packaged fixture in place.

- `worker.cjs` deliberately ignores concurrency and cancellation.
- `checks.cjs` tests output order, actual bounded parallelism, failure propagation,
  stop-scheduling behavior, cancellation, invalid limits and abort-listener cleanup.
- Run `node --test checks.cjs` from the copied directory. The initial version
  **must fail**. After the specialist repairs only the implementation, it must
  pass unchanged; preserve the initial failure and candidate diff as evidence.
- No dependencies, credentials, model calls, network or live systems are needed
  to run these checks. Running the specialist itself is a separate approved
  Copilot operation.

The worker receives `(item, index, signal)` and must cooperate with cancellation.
The implementation must not pretend it can forcibly stop arbitrary worker code.
Review cleanup and failure behavior as well as the checks. This small fixture
does not establish general Node competency or cover server/stream/package work.
The suite's other scenarios need suitable pinned project fixtures and meaningful
checks; absent fixtures/tools are recorded as not run, never simulated passes.

Automatic acceptance is available for this bounded behavior oracle: keep the
unchanged failing baseline separate from the repaired candidate and run both
with the exported JSON evaluation specs. The reader verifies the exact packaged
checker, completed ten-test TAP results, explicit outcome-to-test mappings,
current evidence hashes and recorded scope. It does not require a human rating
for those checks or invent one.
See the acceptance protocol for `automatic_review` and its limits.

## Native technology runtime inventory

`mcpee evaluate --suite technology-runtime --json` inventories every technical
guide, reporting executable native fixtures separately from missing fixtures
and from the static probes below. Export exact baseline/candidate evaluation
specs using `--scenario <oracle-id> --variant baseline|candidate`; run them in
separate disposable copies using ordinary evaluation approvals. See the
[acceptance protocol](../../docs/SPECIALIST-ACCEPTANCE.md#inspect-and-export)
for the results manifest and evidence rules.

The [Python resource-lifetime fixture](python-resource-lifetime/README.md)
executes seven native asyncio tests with Python >=3.11. It tests cancellation,
bounded admission, error propagation, ordered results and owned-resource cleanup.
It does not prove real filesystem behavior, package installation, typing,
multiple Python versions or every broad Python specialist outcome.

The [SQL result-semantics fixture](sql-result-semantics/README.md) runs seven
real SQLite checks for nullable anti-joins, outer joins, duplicate order amounts
and keyset pagination. It is not SQL Server plan/performance or migration
acceptance and does not replace that specialist scenario.

The [frontend runtime fixtures](frontend-runtime/README.md) compile actual
TypeScript and execute pinned Angular, React and Vue framework APIs, DOM
integration, lifecycle/request cleanup and server rendering. Their local
dependency manifests and locks are part of immutable evaluation evidence.
They do not replace real-browser, accessibility, hydration or production checks.

The [.NET API/data fixture](dotnet-api-data-change/README.md) runs native
ASP.NET/EF Core checks against SQLite for HTTP contracts, scoped DI, relational
queries, cancellation, controlled overlapping writes and failure recovery.
It is not a production database, load test or SQL Server acceptance.

The [Terraform local-lifecycle fixture](terraform-local-lifecycle/README.md)
runs nine native Terraform 1.14.0 checks using only the built-in `terraform_data`
provider. It detects unstable resource identities and unintended replacements,
and verifies outputs, empty input and input validation without cloud resources
or credentials. Remote backends, real providers and deployments remain untested.

Successful baseline/candidate pairs are `checked-fixture`, never general
specialist acceptance. Missing runtime tools and missing native fixtures remain
visible gaps; the inventory does not run or install anything.

The [pipeline native-tool fixture](pipeline-runtime/README.md) runs checksum-pinned
actionlint over real GitHub Actions YAML, graph and expression contracts, plus
linter-known script interpolation hazards. It is **static native-tool validation**,
not a remote CI execution, expression evaluator, artifact transfer or release gate.

The [AWS SDK fixture](aws-sdk-runtime/README.md) executes the actual pinned SDK
against controlled transport for pagination, stable aggregation, cancellation,
error propagation and owned/borrowed client cleanup. No AWS service, IAM or
deployed workload was verified.

The [Azure/Bicep fixtures](azure-bicep-runtime/README.md) execute pinned Azure
Storage SDK paging/retry/error/cancellation over controlled transport, and the
actual Bicep compiler with emitted ARM storage-setting/output assertions.
These are separate local contracts, not actual Azure service or deployment
acceptance. Preserve the other oracle's candidate file when evaluating either.

The [Cosmos SDK fixture](cosmos-sdk-runtime/README.md) runs pinned SDK requests
against controlled loopback HTTP for partition-key routing, continuation,
cancellation and response/error handling. It does not validate Cosmos service
partition placement, RU charges, consistency, an emulator or production behavior.

## Technology entry-audit probes

`audit-fixtures.json` contains one small synthetic probe per technical guide,
including C#/EF, Python, Node/TypeScript, Angular, React, Vue, SQL/Cosmos,
Bicep/Terraform, pipelines and Azure/AWS configuration/evidence.

For each case, give the specialist only `context`, `source` and its source path,
with its applicable guide/skills. Keep `expected` outside the specialist's
workspace/context: it is a reviewer oracle, not task input. Request actionable
findings with exact lines, consequence, correction, confidence and unrun checks.
Use the normal approvals before sending even a synthetic task to Copilot.

Review whether each known defect was correctly detected and supported, whether
corrections preserve version/behavior, and whether extra findings are justified.
Count missed defects and unsupported findings separately; mentioning an expected
keyword is not a pass. One tiny audit probe is not proof of implementation,
runtime performance or broad audit competence. Never run these fragments against
real accounts/databases, install them as application code or infer actual cloud
access from a review of synthetic configuration.

## Paired negative controls

`audit-controls.json` pairs each entry probe with two reviewer-only controls:

- **negative:** a valid alternative that resembles the defect but must not trigger
  a corrective finding (for example a copied array sorted locally, or `NOT IN`
  over an enforced non-null column);
- **insufficient:** a fragment whose helper/ownership/authority is unavailable.
  The specialist must identify the specific evidence gaps without inventing bugs.

Use `mcpee evaluate --suite specialist-audit` to inspect all 42 required trials.
Export a task with `--scenario <id> --variant positive|negative|insufficient`.
The exported task uses an opaque source path and does not reveal the variant,
oracle, counterevidence or required unknowns to the specialist. Write the exact
source from the selected fixture to that path in a disposable project. Transfer
approval and read-only execution remain separate from exporting a task.

Keep the control file and review material outside that project's indexed sources.
Review actual reasoning and corrections, not keyword presence. A valid alternative
is not necessarily the only good implementation. If an unexpected real defect
exists in a control, fail and repair the fixture rather than misclassify the
specialist's correct finding as a false positive.

The suite report records separate denominators for missed seeded defects,
unsupported findings, duplicates, control cases with findings and acknowledged
evidence gaps. Missing trials do not count as clean results; a specialist that
always returns no findings fails the positive cases. See the acceptance protocol
for the result manifest and evidence rules.
