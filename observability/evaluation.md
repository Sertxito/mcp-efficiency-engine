# Evaluation

Evalua inputs esperados vs agente/motor real y perfil de optimizacion aplicado.

## Objetivo

- Validar que routing, grounding y optimizacion cumplen contrato.
- Detectar regresiones antes de impactar operacion.

## Fuente de verdad

- Casos: `observability/evals/routing-eval-cases.json`
- Runner: `scripts/intake/run-routing-evals.py`
- Reporte: `observability/evals/routing-eval-report.json`
- Eventos: `observability/logs/routing-decisions.jsonl`

## Criterios de aprobacion

1. `cases_failed = 0`.
1. `prompt.exists = true` en todos los casos.
1. `agent` y `engine` esperados por caso.
1. `hitl.required = true` en rutas de alto impacto.

## Semaforo

- `OK`: `cases_failed = 0`.
- `WARN`: 1 caso fallado o desvio leve de perfil.
- `FAIL`: 2+ casos fallados o HITL incorrecto en alto riesgo.

## Ejecucion

```powershell
py -3 .\scripts\intake\run-routing-evals.py
```
