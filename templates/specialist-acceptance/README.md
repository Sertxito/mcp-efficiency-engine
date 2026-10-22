# Specialist acceptance fixtures

These are evaluation inputs, not application helpers or activated skills.
The complete scenario contract is in `catalog/specialist-acceptance.json` in the
installed MCPEE package. See the [acceptance protocol](../../docs/SPECIALIST-ACCEPTANCE.md).

## Node bounded operation

Copy `node-bounded-operation` into a disposable project with a supported Node.js
runtime. Do not edit the packaged fixture in place.

- `worker.cjs` deliberately ignores concurrency and cancellation.
- `checks.cjs` tests output order, actual bounded parallelism, failure propagation,
  stop-scheduling behavior, cancellation and invalid limits.
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
