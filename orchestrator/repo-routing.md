<!-- markdownlint-disable MD013 -->

# Repo Routing

Repo Routing base: dba->Graphify, iot->Graphify+GitNexus/CodeGraph, azure-rag->Azure RAG Builder, dev->CodeGraph, frontend->CodeGraph, backend multi-repo->GitNexus, ux-ui->Graphify.

## Routing por capacidades (v2)

Orden de decisión:

1. Capability exacta solicitada
2. Capability por dominio desde índice generado
3. Default de dominio

Fuente de verdad:

- `repo-registry/repos.yml` (approval, dependencies, optional)
- `repo-intake/generated/<slug>/context-manifests/manifest.json`
- `repo-intake/generated/<slug>/capabilities/capability.json`

Regla de alcance para repos locales:

- El perimetro canonico de trabajo es la raiz del repositorio.
- Los artefactos de analisis, reportes y trazabilidad deben quedar en
  `autodocs/analysis_mcpee/`.
- Los artefactos generados de proyeccion/indice deben quedar en
  `autodocs/generated/`.
- El routing o los subagentes no deben promover escritura fuera de
  `autodocs/` salvo que se trate de artefactos globales de plataforma.

Regla de primera pasada por capability o boost:

- La primera pasada de analisis sobre una capability o boost nuevo debe usar
  onboarding profundo antes de optimizar.
- Debe resolver primero la fuente canonica en `repo-intake/generated/<slug>/`
  y luego consumir la maxima evidencia relevante del proyecto: docs,
  instrucciones, skills, prompts y agentes locales.
- Si existen agentes o subagentes especializados para ese boost, deben usarse
  cuando el entorno lo permita; si no, sus definiciones deben leerse y
  aplicarse como contrato operativo.

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
