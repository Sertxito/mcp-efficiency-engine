# AGENTS.md — Enterprise Global Contract v6

## Routing base

| Intención | Fuente | Agente | Motor |
|---|---|---|---|
| Bug/fix/refactor/test | Código repo único | dev-agent | CodeGraph |
| Legacy/migración/multi-repo | Código legacy | legacy-agent | GitNexus |
| SQL/schema/procedure | SQL/docs técnicas | dba-agent | Graphify |
| Knowledge local/docs técnicas | Docs locales | rag-local-agent | Graphify |
| Contratos/SLA/SharePoint/políticas | Docs corporativos | rag-azure-agent | Azure RAG Builder |
| IoT/edge/telemetría | Código + docs | iot-agent | GitNexus/CodeGraph + Graphify |
| Formación/posts/storytelling | Knowledge generado | community-manager-agent | Graphify |
| Exportar contexto | Repo/docs | snapshot-agent | Repomix |

## Optimización obligatoria

- Aplicar Token Saver antes de cualquier retrieval amplio.
- Aplicar Caveman Mode en loops de debug/coding, salvo que el usuario pida detalle.
- No sacrificar citas/fuentes por ahorrar tokens cuando la tarea requiere grounding.

## Reglas

- No usar todos los motores a la vez.
- No usar Azure RAG Builder para modificar código.
- No usar CodeGraph para buscar contratos.
- No usar Repomix como contexto vivo.
- Si no hay grounding suficiente, declarar gap.

## Always-On Optimization

Caveman Mode y Token Saver están siempre activos para todos los agentes.

### Token Saver

Aplicar antes de cualquier consulta a CodeGraph, GitNexus, Graphify, Azure RAG Builder o Repomix.

### Caveman

Aplicar a toda respuesta. Por defecto usar Caveman Lite/Full según tarea.

### Excepción

No eliminar explicación necesaria, fuentes, validación ni contexto crítico. Si hace falta más detalle, cambiar intensidad, no desactivar la optimización.

## v10 Extension — Memory-first + Learning

All agents MUST:

1. Select memory BEFORE using any tool
2. Use cross-memory when multiple domains are involved
3. Prefer memories over raw retrieval
4. Use previous successful patterns if available (learning)
5. Register execution feedback

Execution order:

Memory → Reasoning → Tool (if needed) → Learning
