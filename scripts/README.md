# Scripts Index

Indice operativo de scripts del repositorio. Objetivo: crecer sin caos, con un punto unico de entrada.

## Estructura canonica (viva)

- `scripts/setup/*`: bootstrap y validacion de entorno.
- `scripts/intake/*`: registry, intake, routing y preflight.
- `scripts/ops/*`: arranque y cierre diario.
- `scripts/discovery/*`: descubrimiento y notas de proyecto.
- `scripts/context/*`: construccion de contexto (Graphify/Repomix/Azure adapter).
- `scripts/learning/*`: feedback, metricas y gates de aprendizaje.

Todas las ejecuciones deben usar rutas canonicas por subcarpeta.

## Convenciones

- Preferir `cmd` wrappers en Windows cuando exista equivalente (`run-repo-intake.cmd`).
- Scripts de verificacion y pipeline deben ser idempotentes.
- Evitar rutas hardcodeadas fuera del repo.

## Setup y bootstrap

- `setup/setup-prerequisites.ps1`: instala y prepara dependencias base (MCP + tooling).
- `setup/setup-codegraph.ps1`: setup de CodeGraph.
- `setup/setup-gitnexus.ps1`: setup de GitNexus.
- `setup/setup-graphify.ps1`: setup de Graphify.
- `setup/validate-context.ps1`: verificacion de prerequisitos locales.

## Repo intake y routing

- `intake/validate-repo-registry.py`: valida `repo-registry/repos.yml` (strict opcional).
- `intake/validate-repo-registry.ps1`: wrapper PowerShell de validacion del registry.
- `intake/repo-intake.py`: genera artefactos intake por repo.
- `intake/run-repo-intake.cmd`: wrapper recomendado en Windows para intake.
- `intake/run-repo-intake.ps1`: wrapper PowerShell para intake.
- `intake/resolve-routing.py`: resuelve ruta por capabilities/engine/fallback.
- `intake/run-routing-evals.py`: ejecuta casos de prueba de routing.
- `intake/agent-pipeline-preflight.py`: chequea integridad agente -> skills -> repos.

## Operacion diaria

- `ops/hi.ps1`: preflight de inicio (contexto, intake, routing, salud).
- `ops/bye.ps1`: cierre con refreshes y reportes.

## Descubrimiento y sincronizacion

- `discovery/discover-boost-repos.py`: descubrimiento de repos boost.
- `discovery/discover-boost-repos.cmd`: wrapper CMD para descubrimiento.
- `discovery/refresh-project-notes.py`: refresca notas de proyecto desde observabilidad.

## Contexto y snapshots

- `context/build-graphify.ps1`: reconstruye salida de Graphify.
- `context/build-repomix.ps1`: genera snapshot Repomix.
- `context/azure-rag-mcp-adapter.py`: adaptador para flujo Azure RAG MCP.

## Learning y observabilidad

- `learning/record-learning-feedback.py`: registro de feedback de ejecucion.
- `learning/record-iteration-metrics.py`: registro de metricas por iteracion.
- `learning/learning-loop-report.py`: reporte de aprendizaje continuo.
- `learning/iteration-value-report.py`: reporte de valor por iteracion.
- `learning/autolearning-gate.py`: gate automatizado de aprendizaje.

## Flujos recomendados

Setup inicial:

```powershell
.\scripts\setup\setup-prerequisites.ps1
.\scripts\setup\validate-context.ps1
```

Validacion operativa minima:

```powershell
py -3 .\scripts\intake\validate-repo-registry.py --strict
.\scripts\intake\run-repo-intake.cmd
py -3 .\scripts\intake\agent-pipeline-preflight.py
py -3 .\scripts\intake\run-routing-evals.py
```

Operacion diaria:

```powershell
.\scripts\ops\hi.ps1
# ... trabajo ...
.\scripts\ops\bye.ps1
```
