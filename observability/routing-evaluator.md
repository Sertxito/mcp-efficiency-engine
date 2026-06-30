# Routing Evaluator

Comparar routing real contra matriz esperada.

## Ejecución

```powershell
python .\scripts\intake\run-routing-evals.py
```

Entradas:

- `observability/evals/routing-eval-cases.json`

Salidas:

- `observability/evals/routing-eval-report.json`
- `observability/logs/routing-decisions.jsonl`

Objetivo:

- Detectar desvíos entre intención/dominio y agente/motor resultante.
- Medir fallback rate y consistencia de perfiles de optimización.

## Checklist de revision

1. `cases_failed = 0`.
1. Ningun caso con `prompt.exists=false`.
1. Casos de alto riesgo con `hitl.required=true`.
1. `fallback_rate` bajo umbral definido en `metrics.md`.

## Triage rapido si falla

1. Revisar desvio en `observability/evals/routing-eval-report.json`.
1. Localizar evento en `observability/logs/routing-decisions.jsonl`.
1. Ajustar regla en `scripts/intake/resolve-routing.py`.
1. Reejecutar evals y registrar aprendizaje.
