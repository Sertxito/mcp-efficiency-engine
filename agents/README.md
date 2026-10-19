# Initial project-agent blueprint

This directory holds detailed role blueprints; `catalog/catalog.json` is the
runtime source of routing and adoption. Each applicable blueprint is linked to
a runtime specialist as primary or supporting guidance. Routed plans carry
those role procedures and the specialist's relevant reusable patterns; related
profiles are combined under one runtime role where their responsibilities
overlap, rather than creating an agent for every title.

## Role coverage

| Area | Starter roles |
| --- | --- |
| Leadership and product | Team lead, Scrum master, product owner, project delivery manager |
| Architecture and trust | Forensic architect, principal architect, security architect, application security engineer |
| Engineering | Senior frontend, backend, data, AI, and database engineers; UX/accessibility |
| Quality | QA lead, test automation engineer |
| Delivery | DevOps engineer, platform engineer, release manager |
| Production | SRE, observability engineer, incident commander |
| Knowledge | Technical writer |

The set describes responsibilities, not seniority-based authority. The team
lead coordinates technical work; the product owner owns product priorities;
the Scrum master facilitates the process. None silently assumes the others'
decision rights. Domain reviews (frontend, backend/API, cloud, database, and
design-system) are skills of the owning engineering roles, not duplicate
reviewer agents.

## Role-to-skill map

The runtime catalog adopts these role-specific skills through the broader
runtime specialists shown above. Each skill's `used_by` list is validated
against the corresponding agent assignments; the generated route carries the
selected procedures rather than loading every skill.

| Role | Candidate shared skills |
| --- | --- |
| Forensic architect | `system-forensics`, `evidence-and-findings`, `architecture-decision-record` |
| Team lead | `backlog-refinement`, `test-strategy`, `evidence-and-findings`, `retrospective-learning` |
| Scrum master | `backlog-refinement`, `github-ado-work-items`, `retrospective-learning` |
| Product owner | `requirements-discovery`, `backlog-refinement`, `github-ado-work-items` |
| Project delivery manager | `backlog-refinement`, `github-ado-work-items` |
| Principal architect | `system-forensics`, `cloud-architecture-planning`, `architecture-decision-record`, `api-contract-review`, `threat-modeling` |
| Security architect | `threat-modeling`, `api-contract-review`, `ci-cd-review` |
| Senior frontend engineer | `frontend-change-review`, `design-system-governance`, `frontend-accessibility-review`, `api-contract-review`, `test-strategy` |
| Senior backend engineer | `backend-change`, `api-contract-review`, `database-migration-safety`, `test-strategy` |
| Senior data engineer | `data-pipeline-quality`, `database-change-operations`, `observability-design` |
| Senior AI engineer | `ai-feature-evaluation`, `threat-modeling`, `test-strategy` |
| Senior database engineer | `database-change-operations`, `database-migration-safety`, `api-contract-review`, `test-strategy` |
| UX/accessibility engineer | `requirements-discovery`, `design-system-governance`, `frontend-accessibility-review` |
| QA lead | `test-strategy`, `frontend-accessibility-review`, `ai-feature-evaluation`, `evidence-and-findings` |
| Test automation engineer | `test-strategy`, `backend-change`, `frontend-change-review` |
| Application security engineer | `threat-modeling`, `api-contract-review`, `ci-cd-review`, `evidence-and-findings` |
| DevOps engineer | `ci-cd-review`, `deployment-readiness`, `observability-design`, `evidence-and-findings` |
| Platform engineer | `cloud-architecture-planning`, `deployment-readiness`, `observability-design`, `threat-modeling` |
| Release manager | `deployment-readiness`, `ci-cd-review`, `observability-design`, `evidence-and-findings` |
| SRE | `observability-design`, `incident-response`, `database-change-operations`, `retrospective-learning` |
| Observability engineer | `observability-design`, `incident-response` |
| Incident commander | `incident-response`, `observability-design`, `evidence-and-findings`, `retrospective-learning` |
| Technical writer | `documentation-sync`, `requirements-discovery`, `incident-response`, `evidence-and-findings` |

## Common contract

Every profile owns a narrow decision area, states the evidence it needs and
returns, and names the next role when work crosses a boundary. Agents propose
changes; only the user or explicitly authorized workflow approves external or
state-changing actions. Creating/updating GitHub Issues or Azure DevOps work
items, merging, releasing, deploying, changing production, and transmitting
project data require explicit approval for the specific action.

For non-trivial findings use the shared report vocabulary: **observed fact**,
**hypothesis**, **recommendation**, **evidence**, **confidence**, **business
impact**, **technical impact**, **priority**, **validation**, and **unknowns**.
Only include fields that apply, but never merge a hypothesis into a fact.

The profiles assume local-first evidence, impact analysis before changes,
proportionate validation, source-linked claims, and explicit reporting of
uncertainty. They do not assume that a GitHub, Azure DevOps, cloud, or
observability integration is configured.

## Authoring and adoption

Use the reusable source-asset templates and patterns in
`../templates/agent-authoring/` when adding or revising a role. In particular,
preserve the role boundary, least-privilege tool access, evidence contract, and
handoff. Do not copy a workflow into every agent profile.

1. Refine the role boundaries and project-specific evidence expectations.
2. Select shared skills from `../skills/` and workflows from `../workflows/`.
3. Evaluate representative success, failure, ambiguity, and approval-required cases.
4. Add only reviewed role IDs and relationships to `../catalog/catalog.json`.
5. Validate routing and references before rendering profiles for a project.

Profiles not listed in a catalog primary/supporting source mapping remain
design sources for maintainers, not active Copilot custom agents.
