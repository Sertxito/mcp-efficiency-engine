# Example: SLA Query

## Input

Que dice el SLA.

## Ruta esperada

- `agent`: `rag-azure`
- `engine`: `Azure RAG Builder`
- `token_saver_profile`: `evidence-first`
- `caveman_profile`: `evidence-first` o `lite`

## Validacion rapida

```powershell
py -3 .\scripts\intake\resolve-routing.py --input "Que dice el SLA sobre incidencias criticas" --intent knowledge-grounded --domain azure-rag --source-type corporate-docs --capability policy-lookup
```

## Checks

1. `grounded=true`
1. `sources` no vacio
1. `prompt.exists=true`

