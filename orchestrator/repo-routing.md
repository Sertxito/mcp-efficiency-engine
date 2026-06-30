# Repo Routing

Repo Routing base: dba->Graphify, iot->Graphify+GitNexus/CodeGraph, azure-rag->Azure RAG Builder, dev->CodeGraph, legacy->GitNexus.

## Routing por capacidades (v2)

Orden de decisión:

1. Capability exacta solicitada
2. Capability por dominio desde índice generado
3. Default de dominio

Fuente de verdad:

- `repo-registry/repos.yml` (approval, dependencies, optional)
- `repo-intake/generated/<slug>/context-manifests/manifest.json`
- `repo-intake/generated/<slug>/capabilities/capability.json`

Reglas de bloqueo:

- Repos no aprobados (`approval.status != approved`) no se enrutan.
- Dependencias no resueltas bloquean capability y fuerzan fallback de dominio.
- Repos opcionales ausentes (`optional: true`) no bloquean el sistema; generan warning.

Política de degradación:

- `capability unavailable` -> fallback a dominio (fallback=true en evento)
- `dependency unresolved` -> fallback a dominio (fallback=true)
- `repo not approved` -> fallback a dominio (fallback=true)

Resolución operativa:

```powershell
python .\scripts\intake\resolve-routing.py --input "Analiza schema" --intent analysis --domain dba --source-type technical-docs --capability database-analysis
```
