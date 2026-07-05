# AutoDocs Projection Engine

AutoDocs es el motor de proyeccion incremental que toma conocimiento
estructurado de artefactos existentes en `repo-intake/generated/`, consolida
un grafo unificado JSON y proyecta Markdown solo para nodos sucios en
`projects/openwiki_projection/`.

## Flujo operativo

1. `scripts.wiki.wiki_compiler` carga variables de entorno de la sesion.
2. Registra proveedores con `PluginManager` y ejecuta `gather_knowledge()`
  de forma segura.
3. `IncrementalEngine` calcula nodos nuevos/modificados (dirty) y nodos eliminados.
4. `GraphConsolidator` fusiona contratos de proveedores y persiste `repo-intake/generated/wiki/unified-graph.json`.
5. Solo se renderizan paginas Markdown de nodos dirty; si un nodo desaparece,
   su `.md` se elimina.
6. Se escribe telemetria en:
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

- `repo-intake/generated/wiki/unified-graph.json`
- `projects/openwiki_projection/`

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
4. Reusa artefactos existentes de `repo-intake/generated/` (no reescanear
  codigo fuente).
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

## Notas de diseno

- Markdown es solo proyeccion visual.
- El source of truth es el grafo JSON unificado.
- El pipeline es incremental para reducir costo y tiempo.
- Errores de plugin no detienen la ejecucion global; se registran en
  telemetria.
