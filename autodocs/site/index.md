# AutoDocs

Wiki interna de MCP Efficiency Engine. El source of truth es el grafo
unificado y el Markdown es una proyeccion derivada para lectura humana.

## Resumen

- total_pages: 250
- generated_graph: autodocs/generated/unified-graph.json
- search_manifest: autodocs/generated/search-index.json
- validation_report: autodocs/generated/validation-report.md

## Entry Points

- [Reports](reports/index.md) - 174 paginas
- [Routing](routing/index.md) - 26 paginas
- [Observability](observability/index.md) - 18 paginas
- [Specs](specs/index.md) - 13 paginas

## Destacados

- [AGENTS.md — Enterprise Global Contract](routing/report-agents-md.md) - onboarding profundo y con grounding máximo relevante, aunque tarde más. 2. En esa primera pasada se debe recuperar la mayor cantidad de contexto útil
- [Backend Architect](agents/agent-backend-architect-md.md) - Analiza arquitectura backend y propone mejoras trazables sin romper contratos.
- [Skill: Architecture Review](skills/skill-architecture-review-md.md) - Skill operativa del boost backend.
- [Context Policy](policies/policy-context-policy-md.md) - Usar solo el contexto necesario para resolver la tarea con evidencia trazable y sin retrieval redundante.
- [Spec: Clean Architecture](specs/spec-clean-architecture-md.md) - Las reglas de dependencias deben apuntar hacia adentro y preservar aislamiento de dominio.
- [Chat Token Usage Report](observability/report-chat-token-usage-report-md.md) - Contenido report en observability/evals/chat-token-usage-report.md.
- ["[BUG] "](reports/report-bug-md.md) - Contenido report en .github/ISSUE_TEMPLATE/bug.md.

## Secciones

| section | description | pages |
|---|---|---|
| [Capabilities](capabilities/index.md) | Capacidades operativas e integraciones disponibles en el motor. | 1 |
| [Agents](agents/index.md) | Agentes y sus responsabilidades dentro del sistema. | 1 |
| [Skills](skills/index.md) | Skills, comandos y utilidades operativas consumibles por agentes. | 11 |
| [Routing](routing/index.md) | Reglas de orquestacion y decisiones de enrutado. | 26 |
| [Policies](policies/index.md) | Politicas y contratos operativos del repositorio. | 6 |
| [Specs](specs/index.md) | Especificaciones tecnicas y contratos declarativos. | 13 |
| [Observability](observability/index.md) | Telemetria, metricas y reportes del sistema. | 18 |
| [Reports](reports/index.md) | Reportes generados y artefactos de analisis. | 174 |
