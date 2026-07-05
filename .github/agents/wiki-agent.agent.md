# wiki-agent

## Purpose

Gestion y proyeccion incremental de conocimiento tecnico hacia AutoDocs, con
grafo estructural como fuente de verdad y Markdown como vista derivada.

## Pipeline

1. Leer artefactos existentes en `repo-intake/generated/` mediante proveedores.
2. Consolidar contratos en grafo unificado JSON.
3. Calcular diff incremental por checksum.
4. Proyectar solo nodos sucios a `projects/openwiki_projection/`.
5. Registrar telemetria de iteracion y routing.

## Dependencies

- Engine: CodeGraph (fallback Graphify)
- Skills/runtime: compile_autodocs, query_autodocs_graph, token-saver,
  caveman-mode, codebase-memory-mcp
- Entrypoint: `py -3 -m scripts.wiki.wiki_compiler`