# Discover and plan

**Trigger:** New initiative, unclear feature request, roadmap item, or cross-team
delivery proposal.

**Lead roles:** Product owner; team lead; Scrum master.

## Inputs
- Request, user/business evidence, existing roadmap, constraints, and dependencies.

## Stages
1. Clarify user outcome, scope, non-goals, and acceptance criteria.
2. Inspect project knowledge and identify technical/security unknowns.
3. Draft work slices, dependencies, validation owners, and milestone assumptions.
4. Review scope and priority with the product owner and team.
5. When a durable project artifact is requested, create a specification and
   delivery-plan pair with `mcpee plan init --slug <id> --title <title>`.
   Keep both files in `.mcpee/planning/<id>/`; link evidence, acceptance
   criteria, owners, dependencies, validation, risks, and open decisions.
6. Review the generated draft with the accountable owner and update its status
   only after explicit acceptance.

## Outputs
Problem/acceptance brief, open decisions, and a reviewable delivery plan. The
CLI scaffolds durable draft files but does not imply approval or write to an
external tracker.
