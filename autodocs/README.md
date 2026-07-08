# AutoDocs

AutoDocs es la wiki interna nativa de `mcp-efficiency-engine`.

## Estructura

- `autodocs/generated/`: grafo unificado, reportes de validacion y manifests
- `autodocs/schema/`: contratos de schema de la wiki
- `autodocs/site/`: proyeccion Markdown navegable para personas

## Comando canonico

```powershell
py -3 -m scripts.wiki.wiki_compiler
```

## Artefactos clave

- `autodocs/generated/unified-graph.json`
- `autodocs/generated/validation-report.json`
- `autodocs/generated/search-index.json`
- `autodocs/site/index.md`