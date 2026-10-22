# Original boost capability coverage

This document records the engineering capability comparison against the original
boost repositories, reviewed on 2026-10-20. It maps reusable knowledge to current
MCPEE assets, not one new agent per original filename. Similar frameworks,
duplicate skills and translated variants share procedures.

The review covered authored instructions, roles, skills, workflows/playbooks,
patterns, templates and helper contracts in `boost_backend`, `boost_frontend`,
`boost_DBA`, `boost_cloud`, `boost_architect-forensics-expert`,
`boost_design-UX-with-Intent` and the applicability of `boost_sertxIA`.
Dependencies, credentials, caches, generated output and unrelated application
code were not imported. Source locations below are original repository-relative
provenance, not files that consumers must install.

## Meaning of coverage

- **Enriched:** an existing asset gained concrete missing procedure or gates.
- **Added:** a distinct missing procedure or scoped guide is now cataloged.
- **Retained:** already represented by an existing role/procedure; do not duplicate.
- **Excluded/adapted:** not an engineering capability, redundant, unsafe to copy,
  or dependent on an integration that MCPEE does not bundle.

These states describe authored and wired coverage. They do not certify
specialist competence, full equivalence of every original example, tool
availability, a live system, production recovery or every framework version.
Catalog validation and tests verify references, activation and explicit output
contracts; literal response checks still require human review.
The [specialist acceptance protocol](SPECIALIST-ACCEPTANCE.md) separately tracks
actual scenario executions and artifact-based validation. Recovery of an asset
does not mark its specialist acceptance trials as passed.

## Recovery matrix

| Original capability / representative source | Disposition | Current destination and recovered behavior |
|---|---|---|
| Backend C# conventions and APIs: `boost_backend/instructions/csharp.instructions.md`, `aspnet-rest-apis.instructions.md` | Enriched | [C#/.NET instructions](../instructions/backend/dotnet-csharp.md), [backend change](../skills/backend-change/SKILL.md): nullable/contracts, naming, cancellation/DI, ORM SQL, Problem Details, tenant authorization and failure evidence. |
| Async, data access, database-first and design review: `boost_backend/skills/csharp-async/`, `data-access-review/`, `database-first-review/`, `dotnet-design-pattern-review/` | Enriched | [Backend change](../skills/backend-change/SKILL.md): schema/generated ownership, transactions/concurrency, bounded retries, data projections and proportionate architectural patterns. |
| Test framework variants: `boost_backend/skills/csharp-mstest/`, `csharp-nunit/`, `csharp-tunit/`, `csharp-xunit/`, `testing-review/`, `test-impact-analysis/` | Enriched | [Test strategy](../skills/test-strategy/SKILL.md): installed runner/version, async/resource cases, real integration boundaries, risk-based selection, seeds/oracles, optional bounded fuzz/mutation checks and owned flake quarantine. No automatic testing-stack replacement. |
| Python/.NET MCP and package authoring: `boost_backend/instructions/python-mcp-server.instructions.md`, `csharp-mcp-server.instructions.md`, `skills/dotnet-mcp-builder/` | Enriched | [MCP/package authoring](../skills/backend-mcp-package-authoring/SKILL.md): typed runtime schemas, stdio-safe logs, capability negotiation, progress/cancellation, lifecycle/HTTP security and real built-artifact/client compatibility checks. |
| Legacy/runtime/desktop .NET: `boost_backend/instructions/dotnet-framework.instructions.md`, `dotnet-upgrade.instructions.md`, `dotnet-wpf.instructions.md`, `dotnet-maui.instructions.md`, `csharp-razorpages.instructions.md` | Enriched | [Legacy runtime](../skills/dotnet-legacy-runtime/SKILL.md): supported upgrade slice, OS/container/native dependencies, DST and UI lifecycle/binding/thread-affinity or encoding checks when relevant. |
| Containers and dependencies: `boost_backend/instructions/containerization-docker-best-practices.instructions.md`, backend/cloud dependency-review skills | Enriched | [Backend change](../skills/backend-change/SKILL.md), [dependency analysis](../skills/dependency-analysis/SKILL.md), [CI/CD review](../skills/ci-cd-review/SKILL.md): image/context/secrets/shutdown checks, resolved provenance, license and platform artifacts. |
| Angular/React/TypeScript: `boost_frontend/instructions/angular.instructions.md`, `react.instructions.md`, `typescript.instructions.md` | Retained | Separate [Angular](../instructions/frontend/angular.md), [React](../instructions/frontend/react.md), [JS/TS](../instructions/backend/typescript.md) guides preserve version-aware state, ownership, cleanup, accessibility and build/test contracts. |
| Microfrontend boundaries and migration: `boost_frontend/agents/microfrontend-architect.agent.md`, `migration-modernization.agent.md` | Enriched | [Frontend modernization](../skills/frontend-modernization-review/SKILL.md): shell/remotes, auth/routes, shared-version contracts, independently deployed combinations, failures and reversible migration versus simpler alternatives. |
| Browser performance: `boost_frontend/instructions/performance.instructions.md`, `skills/performance-core-web-vitals/`, backend `skills/performance-analysis/` | Enriched | [Frontend performance](../skills/frontend-observability-performance/SKILL.md), [performance investigation](../skills/performance-investigation/SKILL.md): LCP/INP/CLS, route/bundle budgets, comparable field/lab evidence, waterfall and memoization pitfalls. |
| UI testing/accessibility: `boost_frontend/skills/frontend-testing-strategy/`, UX `skills/aria-accessibility-patterns/` | Enriched | [Test strategy](../skills/test-strategy/SKILL.md), [accessibility review](../skills/frontend-accessibility-review/SKILL.md): real keyboard/focus/announcement patterns, manual versus automated evidence and expiry-owned flakes. |
| Design tokens/style/components: `boost_design-UX-with-Intent/skills/design-system-generator/`, `css-scss-best-practices/`, `storybook-component-documentation/` | Enriched | [Design governance](../skills/design-system-governance/SKILL.md): primitive/semantic/component tokens, generated outputs, local selectors, themes, documented states and reviewed visual baselines. |
| Vue component styling: `boost_design-UX-with-Intent/skills/vue-component-styling/` | Added | [Vue instructions](../instructions/frontend/vue.md), Vue/Nuxt dependency and SFC detection, frontend role, explicit globs, coverage mapping and JS/TS guidance. Additional version-aware Vue practices are new guidance, not a claim that the original styling skill certified all Vue behavior. |
| Design-to-code and visual evidence: UX `skills/functional-to-ux-spec/`, `ux-audit/`, design/Figma agents | Enriched | [UX evidence](../skills/ux-design-evidence/SKILL.md): approved revision-to-component/journey map, fixtures, labeled redacted captures and browser/design-access limits. No bundled design-service connector. |
| SQL bottleneck analysis: `boost_DBA/agents/performance-bottleneck-analyzer.agent.md`, `skills/performance-diagnostics/` | Added | [SQL diagnosis](../skills/sql-performance-diagnosis/SKILL.md): source-first query/schema, versioned DMVs/Query Store, waits/blocking windows, cardinality/CPU/reads correlation and falsifiable causes. |
| SQL query optimization: `boost_DBA/skills/query-optimization/`, `instructions/query-optimization.instructions.md`, `sql-dba.instructions.md` | Enriched | [SQL diagnosis](../skills/sql-performance-diagnosis/SKILL.md), [database operations](../skills/database-change-operations/SKILL.md): parameter/workload distributions, sargability/RBAR, measured index cost, functional golden-result comparison and staged rollout/recovery. |
| SQL helper pipeline: `boost_DBA/scripts/query-optimization/01-capture-baseline.sql`, `02-index-recommendations.sql`, `03-golden-file-regression.ps1`, `04-staged-rollout.ps1` | Adapted | Preserve capture -> recommendation -> correctness -> staged rollout gates in [SQL diagnosis](../skills/sql-performance-diagnosis/SKILL.md); do not bundle or execute environment-bound SQL/PowerShell. Verify any project collector, target and approval explicitly. |
| HA, recovery, jobs and capacity: `boost_DBA/skills/high-availability/`, `jobs-automation/`, `proactive-maintenance/` | Enriched | [Database reliability](../skills/database-operations-reliability/SKILL.md): overlap locks, DST/missed runs, replay, maintenance windows, capacity/headroom/lag and dated recovery evidence. |
| Restore/failover testing: DBA `skills/high-availability/`, architect `patterns/cloud-smells.md` | Added | [Recovery rehearsal](../skills/recovery-rehearsal/SKILL.md): isolated approved restore/PITR/failover scenario, independent measured RTO/RPO, application integrity, side-effect isolation, cleanup/failback and next owner/date. |
| Masking and fixtures: `boost_DBA/skills/sql-anonymization/`, `test-data-generation/` | Enriched | [Test-data protection](../skills/database-test-data-protection/SKILL.md): synthetic referential edge cases, classification, re-identification limits, authorized access/retention/deletion and audit. |
| Data/DB platform migrations and operations: DBA migration, job and cross-platform capabilities | Retained/enriched | [Platform migration](../skills/database-platform-migration/SKILL.md), [migration safety](../skills/database-migration-safety/SKILL.md), [data pipelines](../skills/data-pipeline-quality/SKILL.md): compatibility, reconciliation, staged replay/backfill and recovery gates. |
| Cloud architecture, native services and reliability: `boost_cloud/skills/aws-well-architected-review/`, principal cloud architects | Enriched | [Cloud review](../skills/cloud-review/SKILL.md), [cloud diagnostics](../skills/cloud-resource-diagnostics/SKILL.md), [planning](../skills/cloud-architecture-planning/SKILL.md): failure domains, retry/DLQ/replay, quotas/concurrency, identity/network and dated capacity/restore evidence. Provider SDK/API recipes remain version-checked on demand. |
| Bicep/Terraform/pipelines: `boost_cloud/instructions/bicep-code-best-practices.instructions.md`, `terraform.instructions.md`, pipeline specialists | Retained/enriched | Separate [Bicep](../instructions/delivery/bicep.md), [Terraform](../instructions/delivery/terraform.md), [pipeline](../instructions/delivery/yaml-pipelines.md) instructions and [CI/CD review](../skills/ci-cd-review/SKILL.md): scoped plans, state/secrets, supported pins and authorization. |
| Deployment preflight/hardening: `boost_cloud/skills/azure-deployment-preflight/`, `github-actions-hardening/`, release skills | Enriched | [Cloud preflight](../skills/cloud-release-cost-preflight/SKILL.md), [deployment readiness](../skills/deployment-readiness/SKILL.md): target/capacity/cost/role evidence, immutable artifact/SBOM/provenance, canary/control/abort windows and owned flag expiry. |
| Forensic takeover and cloud smells: `boost_architect-forensics-expert/.github/copilot-instructions.md`, reverse-engineering skills, `patterns/cloud-smells.md`, `playbooks/takeover-project.md` | Enriched | [System forensics](../skills/system-forensics/SKILL.md), [due diligence](../skills/technical-due-diligence/SKILL.md): source-to-journey map, exposure/drift/log/cost/recovery candidates, fact/hypothesis, root cause, blast radius, severity/confidence, owner and incremental verification. |
| Architecture challenge, debt, security/AI forensics and legacy recovery: architect roles/playbooks/scorecards | Retained | Existing [architecture challenge](../skills/architecture-challenge/SKILL.md), [debt assessment](../skills/technical-debt-assessment/SKILL.md), [threat modeling](../skills/threat-modeling/SKILL.md), [AI platform audit](../skills/ai-platform-audit/SKILL.md), [legacy analysis](../skills/legacy-analysis/SKILL.md), role handoffs and evidence rubrics. No unsupported maturity or investment guarantees. |
| Editorial/social tooling: `boost_sertxIA` | Excluded | Content research, channel formatting and upload/post workflows are outside the engineering harness scope. They must not acquire publishing credentials or execute external side effects through technical roles. |

## Deliberate adaptations

- Do not restore model pins or tool allowlists from old agent frontmatter.
  Current runtime capabilities and exact approvals remain authoritative.
- Do not copy old workspace truth-folder/preflight script names as mandatory
  dependencies. Check that the project's actual evidence and collectors exist;
  report missing artifacts instead of simulating their results.
- Do not replace target framework/provider versions with "latest". Check the
  repository's supported range and current official documentation.
- Do not duplicate the same policy inside each language role. Global policies
  remain catalog-backed; stack instructions and skills cannot relax them.
- Do not transplant external MCP/Figma/browser/cloud helpers or old SQL rollout
  scripts as automatically executable tools. A procedure, registered capability,
  installed executable and observed result are four different things.
- Copying every generated example, locale, test-framework variant or provider
  recipe would add maintenance/context cost without distinct harness behavior.
  Keep reusable decision, safety and verification contracts in shared assets.

## Validation and limits

The new procedures are wired to roles, workflow/routing contracts, coverage and
explicit evaluation cases. Tests cover activation, generated source bodies,
version/scoping metadata, shared policies, blocked/missing-evidence responses
and human-review requirements. Package checks inspect installed artifacts and
preservation of user-owned files.

No original helper, live SQL diagnostic, restore/failover, cloud mutation,
load test, production profile or remote design operation is executed by this
recovery. Such operations need a real project, installed tools, appropriate
access and approval, representative evidence and their own validation.
Vue source ingestion and code chunking preserve source evidence; they do not
add a Vue compiler, certify SFC semantic analysis or extend the external
CodeGraph engine's supported languages.
