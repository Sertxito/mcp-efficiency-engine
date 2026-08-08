# Backend Architecture Review

Capability backend.architecture.review del boost backend. Provider needs: code-navigation, dependency-analysis, knowledge-graph, project-memory

## Contexto

- kind: capability
- domain: backend
- section: capabilities
- provider: repo-content
- checksum: f5a0dabed107577fa02a82b7411823c92be15c837b4702e4e3eee3a6769b7703
- owner: backend
- tags: capability, backend, backend

## Navegacion

- section_index: [capabilities](index.md)
- wiki_home: [autodocs](../index.md)

## Fuentes

- [boosts/backend/mcpee.json](../../boosts/backend/mcpee.json)

## Relaciones

| relation_type | target |
|---|---|
| references | [Backend Architect](../agents/agent-backend-architect-md.md) |
| references | [Skill: Architecture Review](../skills/skill-architecture-review-md.md) |
| references | [Skill: Dependency Analysis](../skills/skill-dependency-analysis-md.md) |
| references | [Spec: Clean Architecture](../specs/spec-clean-architecture-md.md) |
| references | [Spec: Observability](../specs/spec-observability-md.md) |
| references | [architecture-review.prompt](../routing/prompt-architecture-review-prompt-md.md) |
| references | [architecture-review.cases](../observability/report-evals-architecture-review-cases-json.md) |

## Datos tecnicos

<details>
<summary>Ver payload normalizado</summary>

```json
{
  "title": "Backend Architecture Review",
  "slug": "capability-backend-backend-architecture-review",
  "kind": "capability",
  "section": "capabilities",
  "domain": "backend",
  "summary": "Capability backend.architecture.review del boost backend. Provider needs: code-navigation, dependency-analysis, knowledge-graph, project-memory",
  "owner": "backend",
  "source_refs": [
    "boosts/backend/mcpee.json"
  ],
  "tags": [
    "capability",
    "backend",
    "backend"
  ],
  "relations": [
    {
      "target": "boosts/backend/agents/backend-architect.md",
      "type": "references"
    },
    {
      "target": "boosts/backend/skills/architecture-review.md",
      "type": "references"
    },
    {
      "target": "boosts/backend/skills/dependency-analysis.md",
      "type": "references"
    },
    {
      "target": "boosts/backend/specs/clean-architecture.md",
      "type": "references"
    },
    {
      "target": "boosts/backend/specs/observability.md",
      "type": "references"
    },
    {
      "target": "boosts/backend/prompts/architecture-review.prompt.md",
      "type": "references"
    },
    {
      "target": "boosts/backend/evals/architecture-review.cases.json",
      "type": "references"
    }
  ]
}
```
</details>
