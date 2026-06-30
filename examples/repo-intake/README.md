# Example: Repo Intake

Ejemplo minimo para registrar un repo y generar artefactos de intake.

## Pasos

1. Editar `repo-registry/repos.yml` y añadir un repo aprobado.
1. Validar registry:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\intake\validate-repo-registry.ps1 -Strict
```

1. Ejecutar intake:

```powershell
.\scripts\intake\run-repo-intake.ps1
```

1. Revisar salida en `repo-intake/generated/`.
