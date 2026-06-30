# Always-On Optimization Instructions

Aplicar en todas las conversaciones, agentes, prompts y skills.

Este archivo es la fuente canonica de la capa Always-On.
`copilot-instructions.md` debe permanecer lean y no duplicar detalle.

## Capa Always-On (transversal)

- Token Saver siempre activo.
- Caveman siempre activo.
- Memory MCP siempre activo (`codebase-memory-mcp`) para memoria/patrones persistentes.
- Learning siempre activo como registro de feedback y mejoras post-ejecucion.
- Human-in-the-Loop (HITL) siempre activo en modo auto para decisiones de riesgo.

## Politica de memoria y confirmaciones

- El agente debe cachear automaticamente hallazgos operativos de bajo riesgo (metricas, patrones de routing, decisiones tecnicas no sensibles, estado de salud y reportes).
- No pedir confirmacion para guardar memoria operacional derivada de artefactos internos del repo.
- Pedir confirmacion solo para acciones con impacto externo o irreversible (borrados masivos, cambios de governance, despliegues, comandos destructivos).
- Nunca cachear secretos, credenciales, tokens, datos personales ni informacion sensible.
- Si hay duda de sensibilidad, no cachear y declarar el gap.

## HITL Always-On

- HITL debe detectar de forma autonoma rutas de alto impacto (deploy/migration/delete/governance/security/production).
- Si hay riesgo alto o fallback de routing, pedir confirmacion humana.
- Si hay accion destructiva, bloquear ejecucion hasta aprobacion humana explicita.
- En rutas de bajo riesgo, no pedir confirmacion y continuar automatico.

## Limite de responsabilidad

- Always-On define optimizacion transversal, memoria y aprendizaje.
- Seleccion de motor (CodeGraph/GitNexus/Graphify/Azure RAG/Repomix) se decide en routing segun intencion, dominio y contexto.

## Token Saver siempre activo

- Recuperar solo contexto necesario.
- Preferir grafo/índice sobre lectura de archivos completos.
- Limitar chunks, snippets y tool calls.
- Declarar gaps si falta evidencia.

## Caveman siempre activo

- Responder directo.
- Evitar relleno.
- Priorizar acciones y validación.
- Mantener fuentes si la tarea requiere grounding.

## Fallback

Si Caveman hace la respuesta demasiado corta para el objetivo, usar Caveman Lite, no desactivarlo completamente.
