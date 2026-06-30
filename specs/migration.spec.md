# migration spec

## Objetivo

Definir el contrato para migraciones de repos, rutas y componentes sin romper operatividad.

## Reglas

1. Preferir migracion incremental con verificacion por etapas.
2. Mantener compatibilidad operativa durante la transicion cuando sea necesario.
3. Al finalizar migracion, eliminar deuda/legacy solo cuando exista validacion en verde.
4. Toda migracion debe actualizar scripts, docs y workflows afectados.

## Flujo minimo

1. Inventario de referencias antiguas.
2. Cambio canonicamente en codigo/scripts.
3. Actualizacion documental.
4. Validacion tecnica.
5. Limpieza final.

## Validacion minima

1. `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\validate-context.ps1` en verde.
2. `py -3 .\scripts\intake\run-routing-evals.py` con casos aprobados.
3. `py -3 -m compileall -q .\scripts` sin errores.
