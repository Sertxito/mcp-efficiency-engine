# Routing

Reglas de orquestacion y decisiones de enrutado.

[Volver a AutoDocs](../index.md)

## Resumen

- total_pages: 6
- domains: routing (6)

## Paginas

- [AGENTS.md — Enterprise Global Contract](report-agents-md.md) - onboarding profundo y con grounding máximo relevante, aunque tarde más. 2. En esa primera pasada se debe recuperar la mayor cantidad de contexto útil
- [Arquitectura de MCP Efficiency Engine](report-architecture-md.md) - Vista de arquitectura y flujo de agentes y motores.
- [Corporate Routing](report-corporate-routing-md.md) - Definir reglas corporativas para seleccionar agente y motor principal por tarea sin mezclar engines de forma innecesaria.
- [Decision Matrix](report-decision-matrix-md.md) - Matriz de decision rapida para resolver agente y motor por tipo de entrada.
- [Fallback Strategy](report-fallback-md.md) - Fallback: Graphify -> Azure RAG si faltan docs reales; Azure RAG -> Graphify si falta contexto tecnico; CodeGraph <-> GitNexus segun scope; si no hay fuente, gap.
- [Memory-first + Learning](report-router-md.md) - Clasifica intención y enruta a agente/motor según AGENTS.md y optimization-routing.md.
