# Example: Login Bug

## Input

Arregla login.

## Ruta esperada

- `agent`: `dev-agent`
- `engine`: `CodeGraph`
- `token_saver_profile`: `strict`
- `caveman_profile`: `full`

## Validacion rapida

```powershell
py -3 .\scripts\intake\resolve-routing.py --input "Arregla bug de login" --intent bug-fix --domain dev --source-type code --capability code-fix
```

## Checks

1. `fallback=false`
1. `prompt.exists=true`
1. `hitl.required=false` (si no hay accion de alto riesgo)
