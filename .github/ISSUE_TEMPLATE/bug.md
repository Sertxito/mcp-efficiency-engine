---
name: "🐛 Bug Report"
about: Reporta un error o comportamiento inesperado
title: "[BUG] "
labels: ["bug", "triage"]
---

## Descripción del bug

<!-- Describe el problema de forma clara y concisa -->

## Reproducción

Pasos para reproducir:
1. ...
2. ...
3. ...

## Comportamiento esperado

<!-- Qué debería pasar -->

## Comportamiento actual

<!-- Qué sucede realmente -->

## Contexto

- **Entorno**: Windows / Linux / macOS
- **Python**: (ej. 3.10, 3.11)
- **Rama**: (ej. main, feature/xyz)
- **Comando ejecutado**:
  ```bash
  # incluye el comando exacto que falla
  ```

## Output / Error

```
<!-- Incluye logs, stack traces, stdout/stderr -->
```

## Checklist de validación

- [ ] He ejecutado `run-routing-evals.py` y falla reproduciblemente
- [ ] He ejecutado `validate-context.ps1` y reporta el error
- [ ] El error no es de configuración local (ej. .env faltante)

## Solución propuesta

<!-- Opcional: si tienes idea de la causa o solución, describe aquí -->
