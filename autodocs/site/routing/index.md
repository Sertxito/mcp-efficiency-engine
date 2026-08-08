# Routing

Reglas de orquestacion y decisiones de enrutado.

[Volver a AutoDocs](../index.md)

## Resumen

- total_pages: 26
- domains: prompts (19), routing (6), backend (1)

## Paginas

- [AGENTS.md — Enterprise Global Contract](report-agents-md.md) - onboarding profundo y con grounding máximo relevante, aunque tarde más. 2. En esa primera pasada se debe recuperar la mayor cantidad de contexto útil
- [Arquitectura de MCP Efficiency Engine](report-architecture-md.md) - Vista de arquitectura y flujo de agentes y motores.
- [Corporate Routing](report-corporate-routing-md.md) - Definir reglas corporativas para seleccionar agente y motor principal por tarea sin mezclar engines de forma innecesaria.
- [Decision Matrix](report-decision-matrix-md.md) - Matriz de decision rapida para resolver agente y motor por tipo de entrada.
- [Fallback Strategy](report-fallback-md.md) - Fallback: Graphify -> Azure RAG si faltan docs reales; Azure RAG -> Graphify si falta contexto tecnico; CodeGraph <-> GitNexus segun scope; si no hay fuente, gap.
- [Memory-first + Learning](report-router-md.md) - Clasifica intención y enruta a agente/motor según AGENTS.md y optimization-routing.md.
- [architecture-review.prompt](prompt-architecture-review-prompt-md.md) - Analiza arquitectura backend con foco en contratos, aislamiento y trazabilidad.
- [auto-route.prompt.md](prompt-auto-route-prompt-md.md) - Objetivo: enrutar una solicitud al agente y motor correctos con Always-On activo.
- [azure-rag.query.prompt.md](prompt-azure-rag-query-prompt-md.md) - Objetivo: responder consultas corporativas con rag-azure usando Azure RAG Builder.
- [backend.fix-bug.prompt.md](prompt-backend-fix-bug-prompt-md.md) - Objetivo: corregir bug de backend con cambio minimo y validacion real.
- [cavecrew.prompt.md](prompt-cavecrew-prompt-md.md) - Objetivo: orquestar subagentes por rol con salida compacta.
- [caveman-commit.prompt.md](prompt-caveman-commit-prompt-md.md) - Generar commit message en Conventional Commits.
- [caveman-compress.prompt.md](prompt-caveman-compress-prompt-md.md) - Objetivo: comprimir contenido sin perder decisiones tecnicas.
- [caveman-debug.prompt.md](prompt-caveman-debug-prompt-md.md) - Objetivo: resolver debugging con salida corta y accionable.
- [caveman-help.prompt.md](prompt-caveman-help-prompt-md.md) - Mostrar comandos caveman del repo y cuando usar cada uno.
- [caveman-review.prompt.md](prompt-caveman-review-prompt-md.md) - Hacer code review en formato caveman.
- [caveman-stats.prompt.md](prompt-caveman-stats-prompt-md.md) - Objetivo: mostrar estado rapido de eficiencia.
- [caveman.prompt.md](prompt-caveman-prompt-md.md) - Activar respuesta Caveman en este repo.
- [community.post.prompt.md](prompt-community-post-prompt-md.md) - Objetivo: generar contenido de comunidad basado en conocimiento real del repo.
- [dba.query-review.prompt.md](prompt-dba-query-review-prompt-md.md) - Objetivo: revisar consultas SQL y riesgos de rendimiento/seguridad.
- [dev.fix-bug.prompt.md](prompt-dev-fix-bug-prompt-md.md) - Objetivo: corregir bug con cambio minimo y validacion real.
- [frontend.code.prompt.md](prompt-frontend-code-prompt-md.md) - Objetivo: implementar o corregir codigo frontend con cambio minimo, preservando UX existente y validacion real.
- [project.kickoff-analysis.prompt.md](prompt-project-kickoff-analysis-prompt-md.md) - Objetivo: analizar un alcance funcional desde la raiz del repositorio, seleccionar el agente y motor correctos segun la necesidad real, y dejar un arranque operativo con evidencias, gaps y siguientes pasos.
- [rag.knowledge-answer.prompt.md](prompt-rag-knowledge-answer-prompt-md.md) - Objetivo: responder preguntas tecnicas con rag-local y Graphify.
- [token-saver-review.prompt.md](prompt-token-saver-review-prompt-md.md) - Objetivo: auditar uso de contexto y reducir coste sin perder grounding.
- [ux-ui.review.prompt.md](prompt-ux-ui-review-prompt-md.md) - Objetivo: revisar y gobernar UX/UI con foco en consistencia, accesibilidad y design intent.
