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

- `bootstrap-portable.ps1`: orquesta setup portable + validacion + init registry + intake.
- `bootstrap-portable.cmd`: wrapper CMD unico recomendado en Windows para bootstrap portable completo.
- `setup/setup-prerequisites.ps1`: instala y prepara dependencias base (MCP + tooling).
- `setup/setup-codegraph.ps1`: setup de CodeGraph.
- `setup/setup-gitnexus.ps1`: setup de GitNexus.
- `setup/optimize-engines.ps1`: auditoria/optimizacion exhaustiva de motores MCP (CodeGraph, GitNexus, Graphify, Repomix).
- `setup/start-gitnexus.ps1`: indexa si hace falta, levanta backend web y abre UI local.
- `setup/setup-graphify.ps1`: setup de Graphify.
- `setup/validate-context.ps1`: verificacion de prerequisitos locales.
- `../tooling/tooling.manifest.json`: fuente de verdad de CLIs externos requeridos.

## Repo intake y routing

- `intake/validate-repo-registry.py`: valida `repo-registry/repos.yml` (strict opcional).
- `intake/validate-repo-registry.ps1`: wrapper PowerShell de validacion del registry.
- `intake/init-template-registry.ps1`: inicializa `repo-registry/repos.yml` desde la plantilla portable.
- `intake/init-template-registry.cmd`: wrapper CMD recomendado en Windows para inicializar el registry plantilla.
- `intake/repo-intake.py`: genera artefactos intake por repo.
- `intake/run-repo-intake.cmd`: wrapper recomendado en Windows para intake.
- `intake/run-repo-intake.ps1`: wrapper PowerShell para intake.
- `intake/resolve-routing.py`: resuelve ruta por capabilities/engine/fallback y puede registrar metricas de tokens por llamada con `--input-tokens --output-tokens`.
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
- `learning/ingest-copilot-session-usage.py`: ingesta best-effort de uso de tokens desde logs de sesion de VS Code Copilot hacia `iteration-metrics.jsonl` (incluye `copilot_credits` cuando el log lo expone).
- `learning/chat-token-usage-report.py`: reporte agregado de tokens y costo en creditos solo de chat (`usage.source=copilot-session`) con salida JSON+Markdown. Soporta `--plan` (`free|pro|pro+|max|business|enterprise`) y `--seats` para calcular presupuesto mensual incluido y sobreconsumo. Referencia oficial de planes/precio cuando haga falta validar creditos incluidos: https://github.com/features/copilot/plans?ref_cta=View+pricing+and+plans&ref_loc=hero&ref_page=%2Ffeatures_copilot_copilot_business&plans=business
- `learning/learning-loop-report.py`: reporte de aprendizaje continuo.
- `learning/iteration-value-report.py`: reporte de valor por iteracion.
- `learning/autolearning-gate.py`: gate automatizado de aprendizaje.

## Flujos recomendados

Setup inicial:

```powershell
.\scripts\bootstrap-portable.cmd
.\scripts\setup\setup-prerequisites.ps1
.\scripts\setup\validate-context.ps1
.\scripts\setup\optimize-engines.ps1 -InstallMissing
```

Optimización profunda (skills + embeddings en GitNexus):

```powershell
.\scripts\setup\optimize-engines.ps1 -DeepGitNexus
```

Validacion operativa minima:

```powershell
pwsh -ExecutionPolicy Bypass -NoProfile -File .\scripts\setup\validate-context.ps1 -PortableMode
.\scripts\intake\init-template-registry.cmd
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
