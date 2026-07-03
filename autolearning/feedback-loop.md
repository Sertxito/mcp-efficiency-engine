# AutoLearning Loop

## Objetivo

Cerrar el ciclo de mejora continua para que routing, memoria y optimizacion mejoren con evidencia real de ejecucion (no por intuicion).

Nombre operativo: AutoLearning (antes Learning Loop).

## Ciclo operativo

1. Input
1. Routing decision
1. Memory usage
1. Result
1. Metrics
1. Improve next execution

## Fuente de verdad actual

- Eventos por ejecucion: observability/logs/routing-decisions.jsonl
- Campos clave de learning por evento:
  - learning.used_pattern
  - learning.success
  - learning.fallback
  - learning.confidence
- Campos de calidad de routing:
  - fallback
  - grounded
  - sources
  - notes

## Regla de evaluacion

1. Si sube fallback_rate por patron, revisar capability mapping y defaults.
1. Si baja grounded_rate, revisar fuentes/manifests y cobertura de repos aprobados.
1. Si confidence media cae, revisar combinacion intent+domain y requirements por engine.
1. Registrar cambios y revalidar con routing evals antes de merge.

## Automatizacion

- Script: scripts/learning/learning-loop-report.py
- Script de confirmacion real: scripts/learning/record-learning-feedback.py
- scripts/intake/run-routing-evals.py confirma automaticamente (source=ci) los eventos de routing que pasan en eval
- Gate CI: scripts/learning/autolearning-gate.py
- Salidas:
  - observability/evals/learning-loop-report.json
  - observability/evals/learning-loop-report.md
- Ejecucion recomendada: al cierre (bye.ps1) y en CI si se endurece governance.

## Confirmacion real (post-ejecucion)

El evento de routing nace con `learning.success = null` y `outcome_status = pending`.

Cuando existe resultado real (humano, CI o runtime), confirmar con:

```powershell
py -3 .\scripts\learning\record-learning-feedback.py --success true --source ci --confidence 0.95 --notes "tests green"
```

Opcionalmente se puede pasar `--event-id` para fijar un evento concreto.

## Coste y valor por iteracion

Registrar tokens/coste/modelo/herramientas para una iteracion:

```powershell
py -3 .\scripts\learning\record-iteration-metrics.py --model "GPT-5.3-Codex" --input-tokens 1200 --output-tokens 450 --local-tools 3 --remote-tools 0 --estimated-cost-usd 0.013
```

Generar reporte de valor operativo:

```powershell
py -3 .\scripts\learning\iteration-value-report.py
```

Salidas:

- observability/evals/iteration-value-report.json
- observability/evals/iteration-value-report.md

Para contrastar planes, creditos incluidos o precio oficial de Copilot cuando sea necesario:

- https://github.com/features/copilot/plans?ref_cta=View+pricing+and+plans&ref_loc=hero&ref_page=%2Ffeatures_copilot_copilot_business&plans=business

## Criterios minimos de salud

1. fallback_rate <= 0.20 (global) salvo dominios de baja cobertura declarados.
1. grounded_rate >= 0.80 global.
1. confidence_avg >= 0.80 global.
1. patrones con peor calidad deben quedar en backlog con accion correctiva.
