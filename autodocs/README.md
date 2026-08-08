# AutoDocs

AutoDocs es la wiki interna nativa de `mcp-efficiency-engine`.

## Scope real de ingesta

En este repo, AutoDocs compila desde contenido estructurado del propio
workspace (modo core-only) y no desde superficies locales de agentes/skills.

Entradas soportadas por defecto:

- `README.md`, `README_WIKI.md`, `FINAL_USAGE_GUIDE.md`, `FILE_INDEX.md`,
  `autodocs/README.md`, `package.json`
- `policies/*.md`
- `specs/**/*.md`
- `observability/*.md` y `observability/*.json`
- `AGENTS.md`, `ARCHITECTURE.md`, `orchestrator/*.md`
- `autodocs/analysis_mcpee/*.{md,json}`

No se ingieren superficies locales fuera del scope core-only.

## Ingesta de videos/documentos externos

AutoDocs no parsea binarios de video directamente. Para trabajar videos:

1. Genera transcript/resumen en Markdown o JSON.
2. Guarda esos artefactos en `autodocs/analysis_mcpee/`.
3. Ejecuta el compilador wiki.

El resultado se publica en `autodocs/site/reports/` y en
`autodocs/generated/unified-graph.json`.

## Estructura

- `autodocs/generated/`: grafo unificado, reportes de validacion y manifests
- `autodocs/schema/`: contratos de schema de la wiki
- `autodocs/site/`: proyeccion Markdown navegable para personas

## Comando canonico

```powershell
py -3 -m scripts.wiki.wiki_compiler
```

## Sincronizacion automatica

- En CI, el workflow `autodocs-sync` valida en PR y sincroniza en `main`/`develop`.
- La ejecucion ya no depende de filtros de path: cualquier cambio potencialmente relevante recompila AutoDocs.
- Si hay drift, CI exige regenerar y commitear `autodocs/generated` y `autodocs/site`.

## Artefactos clave

- `autodocs/generated/unified-graph.json`
- `autodocs/generated/validation-report.json`
- `autodocs/generated/search-index.json`
- `autodocs/site/index.md`