# AutoDocs

Wiki interna de MCP Efficiency Engine. El source of truth es el grafo
unificado y el Markdown es una proyeccion derivada para lectura humana.

## Resumen

- total_pages: 71
- generated_graph: autodocs/generated/unified-graph.json
- search_manifest: autodocs/generated/search-index.json
- validation_report: autodocs/generated/validation-report.md

## Entry Points

- [Skills](skills/index.md) - 22 paginas
- [Agents](agents/index.md) - 12 paginas
- [Specs](specs/index.md) - 11 paginas
- [Reports](reports/index.md) - 9 paginas

## Destacados

- [AGENTS.md — Enterprise Global Contract](routing/report-agents-md.md) - 2. En cada tarea, exponer evidencia minima de ejecucion: boost/agente/skill, motor, fallback (si aplica), validacion. 3. Cuando la tarea afecte a un proyecto concreto, persistir trazabilidad en `projects/<nombre-proyecto>/analysis_mcpee/`.
- [Mission](agents/agent-github-repository-manager-agent-md.md) - name: GitHub Repository Manager description: Automatización completa del repositorio mediante GitHub MCP. Control total de branches, PRs, issues, releases y sincronización multi-repo.
- [Azure RAG Enterprise Skill](skills/skill-azure-rag-enterprise.md) - Answer corporate-document questions with grounding and mandatory evidence.
- [Context Policy](policies/policy-context-policy-md.md) - Usar solo el contexto necesario para resolver la tarea con evidencia trazable y sin retrieval redundante.
- [architecture spec](specs/spec-architecture-spec-md.md) - Definir la arquitectura operativa del repo y el contrato entre orquestacion, agentes, motores de contexto y observabilidad.
- [Evaluation](observability/report-evaluation-md.md) - Evalua inputs esperados vs agente/motor real y perfil de optimizacion aplicado.
- [AutoDocs](reports/report-autodocs-readme-md.md) - AutoDocs es la wiki interna nativa de `mcp-efficiency-engine`.

## Secciones

| section | description | pages |
|---|---|---|
| [Capabilities](capabilities/index.md) | Capacidades operativas e integraciones disponibles en el motor. | 0 |
| [Agents](agents/index.md) | Agentes y sus responsabilidades dentro del sistema. | 12 |
| [Skills](skills/index.md) | Skills, comandos y utilidades operativas consumibles por agentes. | 22 |
| [Routing](routing/index.md) | Reglas de orquestacion y decisiones de enrutado. | 7 |
| [Projects](projects/index.md) | Proyectos o dominios servidos por MCP Efficiency Engine. | 0 |
| [Policies](policies/index.md) | Politicas y contratos operativos del repositorio. | 4 |
| [Specs](specs/index.md) | Especificaciones tecnicas y contratos declarativos. | 11 |
| [Observability](observability/index.md) | Telemetria, metricas y reportes del sistema. | 6 |
| [Reports](reports/index.md) | Reportes generados y artefactos de analisis. | 9 |
| [Misc](misc/index.md) | Contenido no clasificado o pendiente de taxonomy. | 0 |
