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
