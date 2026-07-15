# Token Saver

## Definición

Token Saver es la política de optimización de contexto, coste y retrieval.

En este repo también se expone como runtime MCP local vía `token-saver-mcp`.

```txt
Token Saver = infra / data layer
```

## Objetivo

Reducir:

- ficheros leídos,
- chunks recuperados,
- tool calls,
- tokens inútiles,
- contexto duplicado.

## Reglas generales

1. Consultar primero grafo/índice, no ficheros completos.
2. Preferir símbolos, call paths, snippets y nodos concretos.
3. Limitar top-k en RAG enterprise.
4. Evitar combinar motores salvo caso mixto justificado.
5. Usar Repomix solo para snapshots con scope claro.
6. Declarar gaps en vez de recuperar “todo”.

## Por motor

### CodeGraph

- Preguntar por símbolo, callers, callees, endpoint o blast radius.
- Evitar leer archivos completos.

### GitNexus

- Usar para impacto multi-repo o legacy.
- Pedir flows o dependencias concretas.

### Graphify

- Consultar `graph.json` o `GRAPH_REPORT.md` por tema/nodo.
- No cargar todo el grafo en conversación.

### Azure RAG Builder

- Recuperar documentos reales con top-k limitado.
- Pedir citas/fuentes.
- No usar para código vivo.

### Repomix

- Scope limitado.
- Ignorar `.env`, builds, node_modules, graphify-out y binarios.

## Coste estimado por motor

Estimacion orientativa para planificacion de sesiones. No sustituye metrica real por logs.

| Motor | Modelo tipico | Coste tipico por prompt (AI Credits) | Notas |
| --- | --- | --- | --- |
| CodeGraph | GPT-4o / Claude Haiku | 0.5-2 | busquedas rapidas y contexto puntual |
| GitNexus | Claude Sonnet 4.6 | 3-10 | impacto multi-repo y trazas complejas |
| Graphify | Gemini 2.5 Pro | 1-5 | consultas de grafo y docs tecnicas |
| Azure RAG Builder | Gemini 2.5 Pro / GPT-5.1 | 2-8 | evidence-first, depende de top-k |
| Repomix | GPT-4o / Gemini 2.5 Pro | 2-12 | snapshots y analisis de paquetes grandes |

Regla de control:

1. Si una sesion se proyecta por encima de 10 credits, preparar pre-flight con `templates/session-cost-estimate.md`.
2. Si supera 20 credits, justificar escalado de modelo y alcance antes de ejecutar.
3. Registrar consumo final en `observability/evals/chat-token-usage-report.json` cuando aplique.
