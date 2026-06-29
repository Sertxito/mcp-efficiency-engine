Comparar routing real contra matriz esperada.

## Ejecución

```powershell
python .\scripts\run-routing-evals.py
```

Entradas:

- `observability/evals/routing-eval-cases.json`

Salidas:

- `observability/evals/routing-eval-report.json`
- `observability/logs/routing-decisions.jsonl`

Objetivo:

- Detectar desvíos entre intención/dominio y agente/motor resultante.
- Medir fallback rate y consistencia de perfiles de optimización.
