# coding-standards spec

## Objetivo

Establecer reglas de cambio seguro y minimo para scripts, docs operativas y artefactos de soporte.

## Reglas

1. Cambios minimos y acotados al alcance de la tarea.
2. Sin refactor amplio fuera de scope.
3. Mantener rutas canonicas en `scripts/setup|intake|ops|discovery|context|learning`.
4. Priorizar JSON-first en artefactos operativos.
5. Evitar duplicar logica entre wrappers y scripts canonicos.

## Estilo por tecnologia

1. Python: repo root correcto para scripts en subcarpetas (`parents[2]` en utilidades bajo `scripts/*/*`).
2. PowerShell: resolver root con `Join-Path $PSScriptRoot '..\\..'` cuando el script vive en subcarpeta.
3. Markdown: contratos claros, accionables y verificables.

## Validacion minima

1. `py -3 -m compileall -q .\scripts` sin errores.
2. `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\validate-context.ps1` en verde.
