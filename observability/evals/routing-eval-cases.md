# Routing Eval Cases

## Casos base

1. `bug login` -> `dev-agent` + `CodeGraph` + Caveman `full`.
1. `SLA` -> `rag-azure-agent` + `Azure RAG Builder` + `sources` no vacio.
1. `arquitectura` -> `rag-local-agent`/`dba-agent` segun dominio con `Graphify`.
1. `legacy migration` -> `legacy-agent` + `GitNexus` + `hitl.required=true` cuando haya alto impacto/fallback.

## Suite ejecutable JSON-first

- `observability/evals/routing-eval-cases.json`

## Runner

```powershell
py -3 .\scripts\intake\run-routing-evals.py
```

## Criterios de pase

1. `cases_failed = 0`.
1. Coincidencia exacta de `agent` y `engine` por caso.
1. `prompt.exists = true` en todos los casos.
