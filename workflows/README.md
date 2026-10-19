# Initial project-lifecycle workflow blueprint

These documents describe workflow procedures. The catalog supplies executable
routing metadata and links each lifecycle procedure to a runtime workflow.
Routing loads only the selected workflow guidance and its role-specific skills.
No workflow implicitly creates tracker items, merges, or deploys; external and
state-changing actions remain explicitly approval-gated.

## Coverage map

| Lifecycle | Workflow | Lead roles | Candidate skills |
| --- | --- | --- | --- |
| Discovery and planning | `discover-and-plan` | Product owner, team lead, Scrum master | requirements discovery, backlog refinement |
| Current-state evidence | `forensic-assessment` | Forensic architect | system forensics, evidence and findings |
| Tracker | `create-or-update-work-items` | Project delivery manager | GitHub/ADO work items, backlog refinement |
| Design | `architecture-and-threat-review` | Principal architect, security architect | ADR, API contract, threat modeling |
| Build | `implement-and-review-feature` | Senior engineers, UX, team lead | backend change, frontend accessibility, API contract |
| Cross-stack contract | `cross-stack-feature-review` | Frontend/backend engineers, team lead | frontend change review, API contract, evidence and findings |
| Quality | `validate-change` | QA lead, test automation | test strategy, AI evaluation |
| Database change | `database-change-with-baseline` | Senior database engineer, SRE | database change operations, migration safety |
| Design gate | `design-and-accessibility-gate` | UX/accessibility, frontend, QA | design-system governance, accessibility review |
| Delivery | `build-and-promote` | DevOps, release manager | CI/CD review, deployment readiness |
| Deploy | `deploy-with-approval` | Platform, DevOps, release manager | deployment readiness, observability design |
| Operate | `observe-and-improve-service` | SRE, observability | observability design, incident response |
| Incident | `respond-to-incident` | Incident commander | incident response, observability design |
| Learning | `close-loop-and-learn` | Team lead, QA, technical writer | documentation sync, retrospective learning |
| Harness quality | `evaluate-agent-assets` | QA lead, team lead | test strategy, evidence and findings |

Every workflow follows the shared harness lifecycle: understand, analyze, plan,
execute, validate, document, observe, and learn. Not every stage means a write:
external or state-changing steps require explicit action-specific approval.

Use `../templates/agent-authoring/workflow.template.md` for new workflow
proposals. Each workflow should identify entry conditions, decision owners,
failure behavior, evidence, and approval gates; do not duplicate a reusable
skill's detailed procedure inside every workflow.
