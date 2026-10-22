# Specialist acceptance

## What is being measured

The packaged `catalog/specialist-acceptance.json` defines representative tasks
for every runtime role and every technical guide. Each task has normal,
failure and boundary variants, concrete expected outcomes and an artifact-based
oracle. A scenario definition is **not** a successful specialist run.

Separate these levels:

1. **Mapping:** catalog references, routing and guide/skill selection exist.
2. **Harness regression:** unit/fixture tests verify selection, permissions,
   evidence processing and the ability of a checker to detect a seeded defect.
3. **Specialist acceptance:** an actual execution produces artifacts that pass
   meaningful checks and explicit technical review for the scenario.
4. **Operational acceptance:** the intended environment, workload and recovery
   conditions have separately approved, observed validation.

Only level 3 supports a claim about specialist behavior for the tested task.
No level implies every framework version, all possible work or a statistical
"most tasks" percentage. Extend the suite from real usage and regressions; count
the denominator and report untested work rather than extrapolating competence.

## Inspect and export

From a consuming project, using the current installed MCPEE version:

```powershell
mcpee evaluate --suite specialist-core
mcpee evaluate --suite specialist-core --json
mcpee evaluate --suite specialist-core --scenario node-bounded-operation --variant failure --json
```

The first two commands report all required trials and digests. Without results,
their status is `incomplete` and exit code is 2. Exporting a task returns 0; it
does not execute it. `--suite` does not require project initialization just to
inspect the suite and never invokes a model, installs dependencies or runs code.

## Run one trial

1. Prepare a disposable, version-pinned project with representative data, explicit
   conventions and meaningful tests or analytical counterexamples. Initialize
   MCPEE with the required capabilities. For an isolated specialist experiment,
   use `mcpee init --agents <scenario-agent>` in that disposable project, with
   the normal tool-install and initialization approvals. This deliberately
   selects the actor under test; it is not evidence of multi-role routing
   accuracy. Exercise ordinary routing separately with a normal project profile
   and record any wrong-role selection as a harness gap, not a specialist pass.
   Keep oracle/reviewer material separate
   from candidate code; do not supply a reference solution to the specialist.
2. Export the exact task for the scenario/variant. Execute that task unchanged
   through `mcpee run` or `mcpee_run`, with the normal context-transfer and
   action-specific approvals. Check that the routed agent is the required one;
   a trial executed by another agent cannot pass as this specialist.
3. Save the executor's exact response as a UTF-8 file without adding a trailing
   newline or other wrapper. Its bytes must match the recorded
   `copilot.response.received` content hash. Retain the run report and relevant
   local telemetry. The report records model/runtime/fixture declarations, not
   independently attested environment identity.
4. Review the diff and run meaningful checks using the existing
   `mcpee evaluate --run <spec.json>` mechanism. Its `task` must be the same exact
   exported task. Its `evidence` must include the response plus the candidate,
   tests and reviewed artifacts. All evidence is hashed before validation;
   later edits require another validation.
5. For code fixes, demonstrate that the regression fails on the original and
   passes on the candidate without weakening the oracle. For analytical roles,
   use a redacted evidence pack, counterexamples and a reviewer/checker that
   verifies claims against it; counting headings is not a meaningful oracle.
6. Obtain explicit review of correctness, regression quality and scope. Scores:
   0 = wrong/absent, 1 = partial or insufficient evidence, 2 = demonstrated.
   Every criterion must score 2 to accept a trial. Reviewer notes must address
   this scenario's outcomes and cite artifacts bound to validation.
7. Record the trial in a project-relative results manifest and inspect:

```powershell
mcpee evaluate --suite specialist-core --results acceptance-results.json --json
```

This command checks evidence; it does not execute or approve anything. A failed
trial gives exit 1, incomplete gives 2, all required accepted trials gives 0.
Blocked/missing work is not a pass. A safe refusal can satisfy a boundary task,
but the execution, response, checker and reviewer evidence are still required.

## Result manifest

Use the suite/catalog digests returned by suite inspection. This is an example,
not an accepted observation; replace IDs, hashes, paths and notes with real data.

```json
{
  "suite_id": "specialist-core",
  "suite_sha256": "<current suite digest>",
  "catalog_sha256": "<current catalog digest>",
  "trials": [
    {
      "scenario_id": "node-bounded-operation",
      "variant": "failure",
      "run_report": ".mcpee/reports/runs/<run-id>.json",
      "validation_id": "<evaluation-id>",
      "response": "acceptance/response.txt",
      "environment": {
        "model": "<observed model>",
        "runtime": "<actual Node version>",
        "fixture_revision": "<fixture commit or content manifest>"
      },
      "review": {
        "reviewer": "<review owner>",
        "ratings": [
          { "criterion": "correctness", "rating": 2, "note": "<outcome-by-outcome review>", "evidence": ["acceptance/candidate.cjs"] },
          { "criterion": "regression", "rating": 2, "note": "<initial failure and unchanged oracle evidence>", "evidence": ["acceptance/checks.cjs"] },
          { "criterion": "scope", "rating": 2, "note": "<actual permission, version and cleanup observations>", "evidence": ["acceptance/response.txt"] }
        ]
      }
    }
  ]
}
```

Use a new execution and validation per variant; do not recycle one successful
run to fill multiple cells. Invalid/unknown entries, reused reports, missing
review, stale artifacts and changed suite/catalog digests are explicit errors.
Missing trials remain `not-run`. No suite result is inferred from a green build,
asset-response literal assertions or another workflow's success.

Local reports, telemetry and review assertions are not tamper-proof or an
independent certification. Review still determines whether an automated checker
tests the required behavior rather than merely exiting zero. Preserve artifacts
and hashes when retaining evidence; telemetry retention may otherwise make a
trial unverifiable. Do not store sensitive data or credentials in fixture packs.

## Initial runnable fixture and remaining work

### Negative controls and audit acceptance

The separate `specialist-audit` suite has 14 technologies, each with a positive
defect probe, a valid-code counterexample and an insufficient-evidence fragment.
These are 42 static audit trials, not the 93 implementation trials above.

```powershell
mcpee evaluate --suite specialist-audit --json
mcpee evaluate --suite specialist-audit --scenario react-entry --variant negative --json
mcpee evaluate --suite specialist-audit --results audit-results.json --json
```

An export contains the exact neutral task and the source with an opaque path.
Do not expose the selected variant or reviewer oracle to the specialist. Preserve
the exact source at that path in the disposable project and execute the task
unchanged with normal approvals. Retain the response verbatim and SDK telemetry.
Exporting or inspecting never invokes a model.

The project-relative audit manifest has this shape (placeholders are not evidence):

```json
{
  "suite_id": "specialist-audit",
  "suite_sha256": "<current audit suite digest>",
  "catalog_sha256": "<current catalog digest>",
  "trials": [{
    "scenario_id": "react-entry",
    "variant": "insufficient",
    "session_id": "<actual SDK session>",
    "response": "responses/react-insufficient.txt",
    "review": {
      "reviewer": "<review owner>",
      "findings": [],
      "unknowns": [
        { "id": "hook-dependencies", "index": 0, "note": "<why this actual unknown requests the missing hook implementation>" },
        { "id": "request-cleanup", "index": 1, "note": "<why this actual unknown addresses request lifetime>" }
      ],
      "scope": { "rating": 2, "note": "<observed source-only scope and unrun checks>" }
    }
  }]
}
```

Classify **every** returned finding with `finding_id`, `verdict` (`supported`,
`unsupported` or `duplicate`), `expected_ids` and a source-based `note`. A supported
finding may map to multiple related oracle IDs; do not reuse a defect to inflate
detection. Additional supported positive-case findings use an empty mapping.
Unknown mappings use reviewer-only IDs from the selected control and zero-based
indices into actual response `unknowns`. Missing mappings fail; generic
"more context needed" does not satisfy a specific evidence gap without review.

Passing a control requires no corrective findings. A finding in a control fails
even if the reviewer disputes the oracle: investigate the fixture. Passing a
positive case requires detection of every seeded defect with no unsupported or
duplicate findings. All trials require full scope rating (2); wrong actor/task,
changed source/response, reused sessions, stale digests or missing telemetry are
explicit errors. Mutations, non-read-only tool authorization attempts and failed
execution fail the trial. A denied action is not evidence of scope compliance.
The reader validates provenance against local records, not tamper-proof execution
or an independent semantic judgment.

Successful SDK completion telemetry records `changed_paths`, including an empty
array. Older executions that omitted that field require an explicit
`execution_record` path in the trial: preserve the original SDK result with
`session_id`, `agent`, `task_sha256`, `response_sha256`, `source_sha256`,
`suite_sha256`, `catalog_sha256` and actual `changed_paths`. The reader binds
these to the current task/source/response; a missing field is never interpreted
as no changes. Such local records remain non-attested evidence.

For large logs, preserve full original JSONL snapshots and their hashes outside
the bounded reader input. A verbatim-line excerpt may retain execution start/
completion, response-hash events and **all** tool/permission attempt events
(including SDK tool starts and denied permissions). Record the selection and
original/excerpt counts; never omit an attempted action to obtain a passing
scope rating. The reader's 32 MiB limit is an explicit boundary, not permission
to silently truncate evidence.

Fixture review must also check that the positive oracle is supportable. A value
named password is not proof it contains a secret without source/context. Missing
restore evidence alone belongs in unknowns; an explicit assertion of verified
recovery contradicted by supplied evidence is a finding about that assertion,
not proof of a failed recovery capability. Keep honestly unverified scope valid.
If prompt and oracle disagree, retain the failed attempt, correct the contract
and rerun against one coherent revision rather than silently changing the grade.

Report the denominators as well as the rates:

- `seeded_defect_recall`: mapped seeded defects / seeded defects in reviewed
  positive cases, **not** general audit recall.
- `unsupported_finding_share`: unsupported findings / all reviewed findings;
  duplicates are counted separately.
- `control_alarm_rate`: control cases containing findings / reviewed control
  cases. Do not confuse two findings in one case with two failed cases.
- Required/acknowledged evidence gaps measure safe abstention independently of
  defect detection. Missing trials remain `not-run`; zero denominators yield
  `null`, not 100% precision or zero false-positive risk.

These paired cases prevent an always-silent reviewer from appearing competent
and prevent a reviewer that always flags a familiar pattern from passing.
They are deterministic fixture contracts, not a random sample of real projects
and not a statistical population estimate. Add counterexamples from actual
regressions and independently review claims before expanding the confidence scope.

### Auditing an existing project

The technical baseline also applies to takeover and entry audits: inspect pinned
versions, actual source, configuration, tests, data boundaries and operational
evidence before judging a practice. A convention can select a valid alternative,
but does not make unsafe lifetime, ownership or authorization behavior correct.
Report source/line, observed defect, consequence, prerequisites, confidence and
the smallest compatible correction; distinguish missing evidence from a defect.
Do not prescribe a blanket rewrite or call every guideline deviation a bug.

Every role has an owned routable workflow, including business, frontend, data
and AI when installed alone. Review-only intent does not authorize the execution
steps of a delivery workflow; record those stages as not performed where relevant.

The fixture kit includes a synthetic audit probe for every technical guide.
Review against hidden known defects and negative/counterevidence cases, not a
checklist of names. These review-only probes complement but do not replace the
normal/failure/boundary artifact trials or a representative real project audit.

The [fixture kit](../templates/specialist-acceptance/README.md) includes a seeded
Node concurrency/cancellation defect and deterministic behavioral checks. The
repository tests establish that the checker rejects the defective implementation
and accepts a control implementation. Those are **checker regression tests**,
not an actual Copilot specialist run.

The remaining scenarios deliberately specify their fixture, oracle and missing-
evidence behavior instead of pretending that SQL/cloud/browser/.NET checks ran.
Build/adopt representative pinned fixtures, run the real specialists with
approval, review outcomes and fix any gaps revealed. Until those observations
exist, the suite must report incomplete, including for roles with rich guidance.
