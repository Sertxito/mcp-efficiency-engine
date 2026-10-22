# Quality and evaluation

How MCPEE validates changes, reports quality gates and records evaluation
evidence. Validation is what lets MCPEE close a change safely: without a
declared workflow, post-change documentation refresh stays blocked.

- [Generated validation workflows](#generated-validation-workflows)
- [Write or adjust a workflow](#write-or-adjust-a-workflow)
- [Local evaluation checks](#local-evaluation-checks)
- [Quality gates and coverage](#quality-gates-and-coverage)
- [Agent asset evaluations](#agent-asset-evaluations)
- [Follow-up tasks and learning](#follow-up-tasks-and-learning)
- [Specifications and plans](#specifications-and-plans)

## Generated validation workflows

During `init`, MCPEE creates a validation spec for each catalog workflow from
the checks it finds, when the corresponding tool is invokable:

- npm scripts: `test:ci`, `test:unit:ci`, `test`, `lint`, `typecheck`, `check`
  or `build`. Declared CI test scripts take precedence over `test` to avoid
  starting watch mode;
- explicitly configured pytest setups;
- .NET solutions or standalone projects.

Discovery covers nested monorepo packages, skips dependency/build directories
and symbolic links, and records project-relative working directories and
evidence. It runs nothing during setup. Existing specs are preserved.

`init` creates no generated specs when:

- discovery finds more checks than the runner's 20-step limit (configure the
  workflows manually); or
- no supported check exists (typical for a new greenfield project). Add a test
  script and run `mcpee init` again, or write a workflow yourself.

Specs live in `.mcpee/workflows/<workflow-id>.json`.

## Write or adjust a workflow

A workflow is an ordered list of allowlisted local checks:

```json
{
  "workflow_id": "verify-node",
  "task": "Verify the local Node runtime",
  "evidence": ["docs/runtime-requirements.md"],
  "steps": [
    { "id": "node-version", "label": "Node version", "tool": "node", "args": ["--version"] }
  ]
}
```

Run it with:

```sh
mcpee workflow run --spec .mcpee/workflows/verify-node.json
```

- The runner uses no shell, restricts working directories to the project, runs
  steps in order and stops at the first failure unless
  `"continue_on_failure": true` is set.
- Only verified read-only invocations run without a prompt. Every other step
  requires interactive per-invocation approval and is blocked in
  non-interactive mode. Set `"requires_approval": true` to force a prompt.
- Each step may set `timeout_ms` from 1000 to 900000 (15 minutes), for example
  `300000` for a build. The default is 30000. Exceeding it is a failure.
- Before running checks, the workflow presents impact analysis for its
  evidence. State-changing steps are blocked unless all evidence is indexed and
  the preflight is ready.
- A checksummed report is written under `.mcpee/reports/workflows/`.
- `workflow run` does not invoke Copilot; use the generated workflow skills
  (`/mcpee-<workflow>` from `.github/skills/`) in Copilot for that.

The spec is executable configuration. Review its tools, arguments and working
directories: allowlisting a CLI does not make its arguments side-effect free.
Add `covers_technologies` to a step to declare which detected technologies it
validates (see [Quality gates](#quality-gates-and-coverage)).

## Local evaluation checks

`mcpee evaluate --run <spec.json>` executes declared checks from the tool
allowlist and records their actual exit status with checksummed evidence:

```json
{
  "task": "Verify the local Node runtime",
  "evidence": ["docs/runtime-requirements.md"],
  "checks": [
    { "label": "Node version", "tool": "node", "args": ["--version"] }
  ]
}
```

Checks accept the same `requires_approval` and `timeout_ms` options as
workflow steps. Reports record the effective timeout.

## Quality gates and coverage

| Command | Reports |
|---|---|
| `mcpee quality [--json] [--strict]` | Validation checks tagged to the detected stack, with project evidence and the latest recorded outcome. |
| `mcpee coverage [--json]` | Versioned minimum catalog mapping per detected technology: specialist, skill, workflows, technical guidance, pattern, scorecard, evaluation case, prompt and validation-discovery basis. |
| `mcpee skills health [--json]` | Workflow evaluation outcomes correlated with the skills assigned to those workflows, with sample sizes and pass/fail counts. |

Generated checks are tagged to a technology only when their source file is
direct evidence for it. `quality --strict` exits `0` when all detected
technologies have declared checks whose latest result passed, `1` on a
recorded failure, and `2` when coverage is missing, blocked or unrun. A pass
proves only that those commands passed, not that they enforce every convention
or quality attribute.

In `coverage`, `mapped` means the references exist; it is not a completeness,
quality, compatibility or release certification. In `skills health`, workflow
outcomes are proxies that cannot establish causality; skills without direct,
human-reviewed evaluations remain `no-direct-evidence` or `limited-evidence`.

For a human-readable view of gates and results, generate the validation HTML
described in [Observability](OBSERVABILITY.md#human-review-views).

## Agent asset evaluations

- `mcpee evaluate --case <id> --asset <id> --response <file>` runs the catalog
  case's literal smoke assertions locally. The result awaits review until a
  person supplies a complete scorecard with `--ratings <json> --reviewer <name>`;
  every criterion is rated 0-2 with evidence. Reports store the response hash
  and assertions, never the response content. Literal checks are not semantic
  grading, and human ratings are recorded as attestations.
- `mcpee evaluate --suite specialist-core` runs the
  [specialist acceptance suite](SPECIALIST-ACCEPTANCE.md): representative
  normal, failure and boundary tasks for every role and technical guide.
  Missing trials are reported as not run; accepted trials require matching
  execution/response evidence, fresh artifact-bound checks and full technical
  review.
- `mcpee evaluate --suite specialist-audit` tracks 42 paired static audit
  trials (seeded defects, valid alternatives and insufficient evidence) and
  reports missed defects, unsupported or duplicate findings, control alarm
  rates and acknowledged evidence gaps.

Catalog scorecards are review rubrics, not automatic grades. Evaluation cases
describe expected and forbidden behaviors; they do not prove that an automated
LLM grader ran.

## Follow-up tasks and learning

- Failed or blocked checks create pending follow-up tasks. Manage them with
  `mcpee tasks list|approve|reject|start|complete`. Completion requires an
  approved, started task plus a fully passing evaluation over the same evidence
  paths and matching check (`complete <task-id> --evaluation <id>`).
- `mcpee learn propose --evaluation <id> --kind pattern|insight --text <text>`
  accepts only passing evaluations. Repeated, identically evidenced passing
  workflow evaluations also create a review-only pattern proposal.
- `mcpee learn list`, `learn approve <id>` and `learn reject <id>` review
  proposals. Nothing enters durable memory until a person approves it, and
  approval rechecks the source checksums.

## Specifications and plans

- **Specifications** describe intended behavior. Brownfield proposals are
  extracted automatically; greenfield proposals come from your requirements.
  Commands: `mcpee specs discover`, `specs list [--all]`, `specs drift` and
  `specs ratify --slug <id> --reviewer <name> --confirm-sha256 <digest>`.
  Proposals are evidence, not approved requirements; test declarations and
  generated case candidates are not passing tests. See
  [Brownfield specification discovery](BROWNFIELD-SPECS.md).
- **Plans** organize delivery. `mcpee plan init --slug <id> --title <title>`
  creates a versionable draft under `.mcpee/planning/<id>/` with measurable
  acceptance criteria, linked evidence, delivery slices, dependencies,
  validation, risks, approvals and open decisions. It never overwrites existing
  files, and creation is not approval to implement or deploy.
  `mcpee plan list [--json]` inventories plans.
