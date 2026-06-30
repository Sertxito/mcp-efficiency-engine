# repo-intake spec

## Objetivo

Definir el contrato de intake para mantener metadata de repos consistente y utilizable por routing.

## Reglas

1. Todo repo debe existir en `repo-registry/repos.yml`.
2. El registry debe validar en modo estricto antes de intake.
3. El intake debe generar capacidades, manifests y reportes.
4. Repos opcionales pueden generar warning, no error bloqueante.
5. No se debe depender de rutas legacy fuera de `scripts/intake`.

## Flujo minimo

1. Validar registry.
2. Ejecutar intake.
3. Verificar artefactos generados.

## Validacion minima

1. `pwsh -NoProfile -File .\scripts\intake\validate-repo-registry.ps1 -Strict` en verde.
2. `.\scripts\intake\run-repo-intake.cmd` completado sin errores bloqueantes.
3. Reporte disponible en `repo-intake/generated/reports/repo-registry-validation.json`.
