# Discover and plan

**Trigger:** New initiative, unclear feature request, roadmap item, or cross-team
delivery proposal.

**Lead roles:** Product owner; team lead; Scrum master.

## Inputs
- Request, user/business evidence, existing roadmap, constraints, and dependencies.

## Stages
1. Clarify user outcome, scope, non-goals, and acceptance criteria.
2. Inspect project knowledge and identify technical/security unknowns.
3. Open the domain index printed by `mcpee init` or `mcpee sync`; no second
   discovery pass is required. For a greenfield project, write requirements
   first and synchronize them rather than inventing existing behavior.
   Review candidate boundaries, proposals, implementation observations and
   test-case catalogs. Use `mcpee specs drift` to check source freshness;
   distinguish observed product syntax, declared test automation and verified
   execution results. A candidate does not mean functionality or tests are
   missing. Neither syntax nor a test name proves approved requirements or
   a successful execution.
4. Draft work slices, dependencies, validation owners, and milestone assumptions.
5. Review scope and priority with the product owner and team.
6. When a durable project artifact is requested, create a specification and
   delivery-plan pair with `mcpee plan init --slug <id> --title <title>`.
   Keep both files in `.mcpee/planning/<id>/`; link evidence, acceptance
   criteria, owners, dependencies, validation, risks, and open decisions.
7. Complete behavior and acceptance criteria in the brownfield proposal, then
   ratify the exact reviewed file with `mcpee specs ratify`. A plan scaffold
   and a source inventory do not approve requirements.

## Outputs
Problem/acceptance brief, open decisions, and a reviewable delivery plan. The
CLI scaffolds durable draft files but does not imply approval or write to an
external tracker.
