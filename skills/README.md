# Initial shared-skill blueprint

These detailed on-demand procedures are registered in the central catalog and
assigned to the runtime specialist roles that need them. Routing loads the
selected workflow and role skills into the execution plan; it does not inject
every skill into every task. Every skill must produce evidence or a reviewable
proposal, never an unverified claim.

## Starter set

- `requirements-discovery`: identify actors, outcome, constraints, and unknowns.
- `backlog-refinement`: prepare small, testable task proposals.
- `github-ado-work-items`: draft and, after approval, synchronize issues/work items.
- `architecture-decision-record`: compare options and record decisions.
- `system-forensics`: reconstruct actual architecture and runtime paths from evidence.
- `evidence-and-findings`: standardize facts, hypotheses, confidence, impacts, and checks.
- `cloud-architecture-planning`: compare cloud options, capacity, cost, and migration.
- `api-contract-review`: examine consumers, compatibility, errors, auth, and versioning.
- `frontend-change-review`: review UI behavior, state coverage, risk, and regressions.
- `design-system-governance`: preserve tokens, component reuse, and design consistency.
- `frontend-accessibility-review`: combine automated and manual accessibility evidence.
- `backend-change`: implement a focused service change with regression coverage.
- `database-migration-safety`: design additive migration and recovery steps.
- `database-change-operations`: baseline, dependency, staged rollout, and monitoring.
- `data-pipeline-quality`: define lineage, quality, replay, and failure checks.
- `ai-feature-evaluation`: evaluate grounding, tool authority, quality, and fallback.
- `application-insights-instrumentation`: instrument Azure applications with privacy-safe, verified telemetry.
- `backend-mcp-package-authoring`: build MCP servers and Python packages with tested protocol and artifact contracts.
- `cloud-resource-diagnostics` and `cloud-release-cost-preflight`: inspect provider resources safely and verify release, quota, role, and pricing prerequisites.
- `context-budgeting`: reduce task context without losing evidence, constraints, or safety boundaries.
- `database-test-data-protection`, `database-operations-reliability`, and `database-platform-migration`: protect fixtures, assess operational reliability, and validate cross-engine changes.
- `dotnet-legacy-runtime`: assess time-zone correctness and legacy ASP.NET Framework hosting constraints.
- `frontend-modernization-review` and `frontend-observability-performance`: review framework production readiness, modernization choices, user signals, and Core Web Vitals.
- `ux-design-evidence`: connect approved design sources to UX specs, component inventories, and redacted visual evidence.
- `test-strategy`: select proportionate validation and report gaps.
- `threat-modeling`: trace boundaries, abuse cases, and mitigations.
- `ci-cd-review`: assess pipeline integrity and promotion controls.
- `deployment-readiness`: prepare gated rollout and rollback evidence.
- `observability-design`: define signals, alerts, and privacy constraints.
- `incident-response`: coordinate evidence-led triage and recovery.
- `documentation-sync`: update docs only from verified behavior.
- `retrospective-learning`: turn evaluated outcomes into approved proposals.

Keep each `SKILL.md` focused, keyword-discoverable, and below 500 lines. Add
references only when needed; avoid duplicating shared policy or role authority.
Prefer extending an existing skill over creating a near-duplicate: accessibility
review and broad frontend change review are complementary; schema migration and
database operational change are related but cover different risks.

Use `../templates/agent-authoring/skill/SKILL.template.md` for new skills and
the kit's patterns when a procedure needs a standard finding, decision, task,
vertical-slice, test-plan, or handoff artifact. Skills may bundle `references/`,
`assets/`, `scripts/`, and `evals/` only when they add concrete value; keep
deterministic checks executable and do not imply optional tools are configured.
