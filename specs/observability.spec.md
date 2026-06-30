# observability spec

## Objetivo

Definir el contrato de telemetria para decisiones de routing, evaluacion y trazabilidad operacional.

## Reglas

1. Toda decision de routing debe registrarse en JSONL.
2. Los eventos deben cumplir el esquema de logs.
3. Debe existir reporte de evaluacion de routing actualizado.
4. Las rutas con riesgo alto deben registrar estado HITL.
5. No se aceptan eventos sin campos minimos de contexto.

## Artefactos canonicos

1. `observability/logs/routing-decisions.jsonl`.
2. `observability/logs.schema.json`.
3. `observability/evals/routing-eval-report.json`.

## Validacion minima

1. `py -3 .\scripts\intake\run-routing-evals.py` genera reporte en `observability/evals/routing-eval-report.json`.
2. `py -3 .\scripts\intake\resolve-routing.py --input "test" --intent info --domain dev --source-type code` agrega evento en `observability/logs/routing-decisions.jsonl`.
