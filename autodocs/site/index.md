# AutoDocs

Wiki interna de MCP Efficiency Engine. El source of truth es el grafo
unificado y el Markdown es una proyeccion derivada para lectura humana.

## Resumen

- total_pages: 37
- generated_graph: autodocs/generated/unified-graph.json
- search_manifest: autodocs/generated/search-index.json
- validation_report: autodocs/generated/validation-report.md

## Entry Points

- [Specs](specs/index.md) - 11 paginas
- [Reports](reports/index.md) - 10 paginas
- [Observability](observability/index.md) - 6 paginas
- [Routing](routing/index.md) - 6 paginas

## Destacados

- [AGENTS.md — Enterprise Global Contract](routing/report-agents-md.md) - onboarding profundo y con grounding máximo relevante, aunque tarde más. 2. En esa primera pasada se debe recuperar la mayor cantidad de contexto útil
- [Context Policy](policies/policy-context-policy-md.md) - Usar solo el contexto necesario para resolver la tarea con evidencia trazable y sin retrieval redundante.
- [architecture spec](specs/spec-architecture-spec-md.md) - Definir la arquitectura operativa del repo y el contrato entre orquestacion, agentes, motores de contexto y observabilidad.
- [Evaluation](observability/report-evaluation-md.md) - Evalua inputs esperados vs agente/motor real y perfil de optimizacion aplicado.
- [AutoDocs](reports/report-autodocs-readme-md.md) - AutoDocs es la wiki interna nativa de `mcp-efficiency-engine`.

## Secciones

| section | description | pages |
|---|---|---|
| [Capabilities](capabilities/index.md) | Capacidades operativas e integraciones disponibles en el motor. | 0 |
| [Agents](agents/index.md) | Agentes y sus responsabilidades dentro del sistema. | 0 |
| [Skills](skills/index.md) | Skills, comandos y utilidades operativas consumibles por agentes. | 0 |
| [Routing](routing/index.md) | Reglas de orquestacion y decisiones de enrutado. | 6 |
| [Domains](domains/index.md) | Dominios funcionales servidos por MCP Efficiency Engine. | 0 |
| [Policies](policies/index.md) | Politicas y contratos operativos del repositorio. | 4 |
| [Specs](specs/index.md) | Especificaciones tecnicas y contratos declarativos. | 11 |
| [Observability](observability/index.md) | Telemetria, metricas y reportes del sistema. | 6 |
| [Reports](reports/index.md) | Reportes generados y artefactos de analisis. | 10 |
| [Misc](misc/index.md) | Contenido no clasificado o pendiente de taxonomy. | 0 |
