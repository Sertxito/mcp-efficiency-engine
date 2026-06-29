# Repo Intake Guide

Repo Intake convierte repos externos en capacidades sin copiarlos.

## Flujo recomendado (local-first)

1. Registrar repos hermanos en `repo-registry/repos.yml` (formato JSON-first con `schema_version: 2.0`).
1. (Opcional) Detectar nuevos repos `boost_*` en `c:/repo` sin aplicar cambios con `.\scripts\discover-boost-repos.cmd`.
1. Revisar propuesta generada en `repo-intake/generated/reports/boost-discovery-proposal.json`.
1. Aplicar automáticamente candidatos nuevos (si quieres) con `.\scripts\discover-boost-repos.cmd --apply`.
1. Validar governance y dependencias con `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-repo-registry.ps1 -Strict`.
1. Ejecutar intake con `.\scripts\run-repo-intake.cmd`.

## Campos mínimos por repo (v2)

- `name`
- `domain` (`dev|legacy|dba|iot|azure-rag`)
- `version` (semver `x.y.z`)
- `location` (ruta local)
- `type` (`local`)
- `approval.status` (`approved`)
- `approval.approved_by`
- `approval.approved_date`

Campos opcionales:

- `optional: true` para repos de ejemplo no clonados localmente.
- `dependencies` para declarar relaciones entre repos hermanos.

## Artefactos generados

- Legacy (compatibilidad): `repo-intake/generated/{agents|skills|context-manifests|reports}`
- V2 JSON-first root: `repo-intake/generated/v2/<slug>/<version>/`
- V2 manifest: `repo-intake/generated/v2/<slug>/<version>/context-manifests/manifest.json`
- V2 capability: `repo-intake/generated/v2/<slug>/<version>/capabilities/capability.json`
- V2 audit log: `repo-intake/generated/v2/<slug>/<version>/audit/audit-log.jsonl`

## Validación estricta

- Bloquea: campos obligatorios faltantes.
- Bloquea: repos duplicados.
- Bloquea: dependencias desconocidas.
- Bloquea: ciclos de dependencias.
- Bloquea: repos no aprobados.
- Warning permitido: repo marcado `optional: true` cuya `location` no existe localmente.
