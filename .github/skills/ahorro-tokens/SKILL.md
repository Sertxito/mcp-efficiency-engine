# Skill: ahorro-tokens

## Objetivo

Aplicar ahorro de tokens sin perder calidad, evidencia ni trazabilidad.

## Cuándo usar

- Cuando una tarea se vuelve larga por discovery abierto.
- Cuando hay demasiadas lecturas de contexto irrelevante.
- Cuando hay que bajar coste sin bajar calidad de salida.
- Cuando se pide plan/ejecucion y se mezclan en una sola interaccion.

## Reglas operativas

1. Scope quirurgico: acotar archivos/simbolos antes de explorar.
2. Sesiones cortas: 1 problema concreto = 1 sesion.
3. CLI primero: usar herramientas deterministas antes de generar boilerplate.
4. Separar fases: plan (alto valor) y ejecucion (cambio atomico).
5. Salida compacta: diagnostico -> accion -> validacion -> riesgo/gap.

## Mapeo en este repo

Fuente canonica:
- `autodocs/site/guides/00-Ahorro_Tokens.md`

Soporte always-on:
- `.github/skills/token-saver/SKILL.md`
- `.github/skills/caveman-mode/SKILL.md`
- `.github/instructions/always-on-optimization.instructions.md`

## Validacion minima

1. `pwsh -ExecutionPolicy Bypass -File .\scripts\setup\validate-context.ps1`
2. `py -3 .\scripts\intake\run-routing-evals.py`
3. Revisar `observability/evals/routing-eval-report.json` (cases_failed = 0)
