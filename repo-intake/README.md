# Repo Intake

Este modulo transforma repos hermanos registrados en capacidades consumibles por el routing, sin copiar codigo dentro de este repositorio.

## Estructura

- `templates/`: plantillas base (`agent`, `skill`, `context-manifest`).
- `generated/reports/`: reportes JSON operativos.
- `generated/<slug>/`: salida canonica JSON-first por repo (sin versionado).

## Nota sobre carpetas vacias

Si ves carpetas antiguas de layouts legacy, se pueden eliminar.
La salida activa vive en `generated/<slug>/...` y `generated/reports/*.json`.

## Flujo recomendado

1. Validar registry: `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\intake\validate-repo-registry.ps1 -Strict`
2. Ejecutar intake: `.\scripts\intake\run-repo-intake.cmd`
3. Revisar reportes: `repo-intake/generated/reports/`
4. Consumir contratos planos: `repo-intake/generated/<slug>/`
