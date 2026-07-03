# Repo Intake Eval Cases

Casos minimos para validar que el intake registra capacidades y dominios esperados.

## Matriz base

1. `boostDBA` -> `domain=dba`, motor esperado `Graphify`.
1. `boost_azure_rag` -> `domain=azure-rag`, motor esperado `Azure RAG Builder`.
1. `boost_iot` -> `domain=iot`, agente esperado `iot`.

## Criterios de aprobacion

1. Repo aparece en `repo-registry/repos.yml` con `approval.status=approved`.
1. Se genera capability en `repo-intake/generated/v2/<slug>/<version>/capabilities/capability.json`.
1. No hay errores en `validate-repo-registry.ps1 -Strict`.

## Comandos

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\intake\validate-repo-registry.ps1 -Strict
.\scripts\intake\run-repo-intake.ps1
```

