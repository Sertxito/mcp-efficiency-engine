# AutoDocs Projection Engine

AutoDocs es una capacidad nativa de `mcp-efficiency-engine`. En el modo
actual core-only, toma conocimiento estructurado del contenido operativo del
repo instalado, lo normaliza a un modelo wiki canonico, valida calidad
estructural y proyecta una wiki interna en `autodocs/site/`.

## Fuentes que consume hoy (core-only)

El proveedor local consume unicamente estas rutas:

- Core docs: `README.md`, `README_WIKI.md`, `FINAL_USAGE_GUIDE.md`,
  `FILE_INDEX.md`, `autodocs/README.md`, `package.json`.
- Politicas: `policies/*.md`.
- Specs: `specs/**/*.md`.
- Observabilidad: `observability/*.md` y `observability/*.json`.
- Routing: `AGENTS.md`, `ARCHITECTURE.md`, `orchestrator/*.md`,
  `autodocs/site/guides/03-mcp-routing-guide.md` (si existe).
- Reportes operativos: `autodocs/analysis_mcpee/*.{md,json}`.

No consume contenido de agentes/skills locales fuera del scope core-only.

## Como meter videos para que AutoDocs los trabaje

AutoDocs no analiza binarios de video (`.mp4`, `.mov`) directamente. El flujo
correcto es:

1. Guardar el video fuente donde quieras (por ejemplo en `context/project-notes/`).
2. Generar transcript/resumen en texto (Markdown o JSON).
3. Guardar esos artefactos en `autodocs/analysis_mcpee/`.
4. Ejecutar `py -3 -m scripts.wiki.wiki_compiler`.

Resultado:

- Se actualiza `autodocs/generated/unified-graph.json`.
- Aparecen/actualizan paginas en `autodocs/site/reports/`.
- Se refrescan indices en `autodocs/site/index.md` y manifests en
  `autodocs/generated/`.

## Flujo operativo

1. `scripts.wiki.wiki_compiler` carga variables de entorno de la sesion.
2. Registra proveedores con `PluginManager` y ejecuta `gather_knowledge()`
  de forma segura.
3. `GraphConsolidator` transforma contratos tecnicos en `raw_nodes` y
  `wiki_nodes`.
4. `WikiValidator` valida schema, slugs, relaciones y navegacion.
5. `IncrementalEngine` calcula nodos nuevos/modificados (dirty) y nodos
  eliminados.
6. Solo se renderizan paginas Markdown de nodos dirty; si un nodo desaparece,
  su `.md` se elimina.
7. Siempre se regeneran indices, manifests y reportes de validacion.
8. Se escribe telemetria en:
   - `observability/logs/iteration-metrics.jsonl`
   - `observability/logs/routing-decisions.jsonl`

## Ejecutar

```powershell
py -3 -m scripts.wiki.wiki_compiler
```

## Actualizacion automatica

La actualizacion puede operar en dos modos:

1. Manual local, ejecutando el comando de compilacion.
2. Automatica en GitHub Actions con el workflow
  `.github/workflows/autodocs-sync.yml`.

El workflow recompila AutoDocs en cambios relevantes y publica actualizaciones
de:

- `autodocs/generated/unified-graph.json`
- `autodocs/generated/validation-report.json`
- `autodocs/generated/search-index.json`
- `autodocs/generated/relations-index.json`
- `autodocs/site/`

Comportamiento por evento:

1. `pull_request`: valida que los artefactos generados ya estan commiteados.
2. `push` (main/develop): recompila y auto-commitea cambios si detecta drift.

Nota: la telemetria de `observability/logs/*.jsonl` se escribe en ejecucion,
pero el workflow no la commitea para evitar ruido.

## Contrato de proveedor

Todo proveedor debe devolver:

```json
{
  "provider_id": "string",
  "entities": [
    {
      "id": "string",
      "type": "string",
      "checksum": "string",
      "raw_data": {},
      "relations": [{ "target": "string", "type": "string" }]
    }
  ]
}
```

## Como agregar nuevos proveedores

1. Crea un archivo en `scripts/wiki/providers/`, por ejemplo `my_provider.py`.
2. Hereda de `BaseWikiProvider`.
3. Define `provider_id` y `gather_knowledge()`.
4. Reusa artefactos estructurados del repo (o rutas de contexto controladas)
  y evita reescanear codigo fuente completo innecesariamente.
5. Registra el proveedor en `scripts/wiki/compiler_main.py`.

Ejemplo minimo:

```python
from pathlib import Path
from scripts.wiki.providers.base_provider import BaseWikiProvider


class MyProvider(BaseWikiProvider):
    provider_id = "my-provider"

    def __init__(self, generated_root: Path) -> None:
        super().__init__(generated_root)

    def gather_knowledge(self):
        return {
            "provider_id": self.provider_id,
            "entities": [
                {
                    "id": "example",
                    "type": "custom",
                    "checksum": self._checksum({"example": True}),
                    "raw_data": {"example": True},
                    "relations": []
                }
            ]
        }
```

## Layout de salida

- `autodocs/generated/unified-graph.json`
- `autodocs/generated/validation-report.json`
- `autodocs/generated/validation-report.md`
- `autodocs/generated/search-index.json`
- `autodocs/generated/relations-index.json`
- `autodocs/generated/section-manifest.json`
- `autodocs/site/index.md`
- `autodocs/site/<section>/*.md`

## Notas de diseno

- Markdown es solo proyeccion visual.
- El source of truth es el grafo JSON unificado de AutoDocs.
- El pipeline es incremental para reducir costo y tiempo.
- Errores de plugin no detienen la ejecucion global; se registran en
  telemetria.
- Errores de validacion si bloquean el estado final y hacen fallar CI.
