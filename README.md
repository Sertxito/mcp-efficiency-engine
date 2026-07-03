# MCP Efficiency Engine — Optimization Edition

Plataforma unificada con:

- Agentes especializados.
- Routing corporativo.
- Repo Intake.
- RAG local con Graphify.
- RAG enterprise con RAG-Azure-Builder.
- MCP para código vivo con CodeGraph/GitNexus.
- Snapshots con Repomix.
- Observabilidad.
- **Token Saver** para optimizar contexto/coste.
- **Token Saver MCP** como runtime MCP local para optimización operativa.
- **Caveman Mode** para optimizar interacción/respuesta.

## Alcance operativo de proyectos

- El espacio canonico para proyectos analizados o trabajados por la plataforma
  es `projects/`.
- Si el trabajo es especifico de un proyecto, el contexto,
  la documentacion derivada y los artefactos generados deben vivir dentro de
  `projects/<nombre-proyecto>/`.
- Los artefactos globales de plataforma permanecen en las rutas raiz ya
  definidas (`observability/`, `context/`, `repo-intake/`, `optimization/`),
  pero no deben absorber salida especifica de un proyecto.
- Esta regla prevalece aunque un subagente sugiera escribir fuera de `projects/`.

## Idea clave

```txt
Token Saver = optimización infra / data layer
Caveman     = optimización UX / interaction layer
```

No compiten. Se combinan.

```txt
Usuario
  ↓
Caveman Mode (estilo de interacción)
  ↓
Orchestrator / Corporate Router
  ↓
Agente especializado
  ↓
Token Saver Policy (contexto mínimo suficiente)
  ↓
Motor correcto
  ↓
Respuesta trazable + observabilidad
```

## Uso rápido

Setup inicial (Windows, una sola vez):

```powershell
.\scripts\setup\setup-prerequisites.ps1
```

Este script instala y configura herramientas base para la plataforma MCP:

- `codebase-memory-mcp`
- `token-saver-mcp`
- `codegraph`
- `gitnexus`
- `graphify`

Luego valida el contexto y corre el intake:

```powershell
.\scripts\setup\validate-context.ps1
.\scripts\intake\run-repo-intake.cmd
python .\scripts\intake\run-routing-evals.py
```

Contrato de instalacion:

- `requirements.txt` cubre solo dependencias Python locales del runtime.
- `tooling/tooling.manifest.json` define los CLIs externos requeridos y su instalacion.
- `scripts/setup/setup-prerequisites.ps1` instala ambos planos.
- `scripts/setup/validate-context.ps1 -PortableMode` verifica Python + CLIs y genera `repo-intake/generated/reports/setup-validation.json`.

Contrato de registry portable:

- `repo-registry/repos.yml` es el registry enterprise activo.
- `repo-registry/repos.template.json` es la plantilla portable para nuevos repos.
- `registry_mode: "template"` permite `repos: []` solo en validacion no estricta.
- `registry_mode: "enterprise"` mantiene el comportamiento actual de gobierno y repos no vacios.

Automatizacion recomendada para un repo nuevo:

```powershell
.\scripts\setup\setup-prerequisites.ps1 -PortableMode
pwsh -ExecutionPolicy Bypass -NoProfile -File .\scripts\setup\validate-context.ps1 -PortableMode
.\scripts\intake\init-template-registry.cmd
.\scripts\intake\run-repo-intake.cmd
```

Comando unico recomendado:

```powershell
.\scripts\bootstrap-portable.cmd
```

Este comando:

- instala o verifica tooling portable
- valida el contexto base
- inicializa el registry plantilla si no existe y pide los datos minimos
- reutiliza el registry actual si ya existe
- ejecuta el intake automaticamente
- muestra un resumen final del registry y del intake generado

Tambien soporta modo no interactivo si pasas los datos por flags:

```powershell
.\scripts\bootstrap-portable.cmd -ForceTemplateRegistry -Owner demo-team -RepoNamePrefix demo_ -InitialRepoName demo_repo -InitialRepoDomain dev -InitialRepoLocation .
```

Con eso el usuario final obtiene:

- tooling instalado
- validacion base ejecutada
- registry plantilla inicializado
- intake operativo aunque todavia no haya repos configurados

Lee primero:

- `FINAL_USAGE_GUIDE.md`
- `ARCHITECTURE.md`
- `optimization/token-saver.md`
- `optimization/caveman-mode.md`
- `optimization/optimization-routing.md`

Mapa de scripts operativos:

- `scripts/README.md`

Entry points recomendados:

- setup: `scripts/setup/*`
- intake/routing: `scripts/intake/*`
- operacion diaria: `scripts/ops/*`

## Mapa de politicas

Politicas de gobierno (globales del repo):

- `policies/context-policy.md`
- `policies/cost-policy.md`
- `policies/repo-intake-policy.md`
- `policies/security-policy.md`

Politicas de optimizacion (always-on runtime):

- `optimization/policies/response-style.policy.md`
- `optimization/policies/token-budget.policy.md`

Orden de lectura recomendado:

1. `policies/security-policy.md`
2. `policies/context-policy.md`
3. `policies/cost-policy.md`
4. `policies/repo-intake-policy.md`
5. `optimization/policies/token-budget.policy.md`
6. `optimization/policies/response-style.policy.md`

## Always-On Optimization

En este runtime, **Token Saver y Caveman Mode están siempre activos**.

Documentación principal:

- `optimization/ALWAYS_ON_OPTIMIZATION.md`
- `docs/02-always-on-optimization-guide.md`
- `.github/copilot-instructions.md`
- `.github/instructions/always-on-optimization.instructions.md`

Runtime MCP local:

- `.vscode/mcp.json`

## Caveman: instalacion y ubicacion

No requiere instalacion externa por npm/pip.

En este repo, Caveman viene como configuracion local de prompts + skills + instrucciones.

Donde esta:

- Skills: `.github/skills/caveman/SKILL.md`
- Skills: `.github/skills/caveman-mode/SKILL.md`
- Prompts: `.github/prompts/caveman.prompt.md`
- Prompts: `.github/prompts/caveman-review.prompt.md`
- Prompts: `.github/prompts/caveman-commit.prompt.md`
- Prompts: `.github/prompts/caveman-compress.prompt.md`
- Prompts: `.github/prompts/caveman-stats.prompt.md`
- Prompt de ayuda: `.github/prompts/caveman-help.prompt.md`
- Always-on global: `.github/copilot-instructions.md`
- Rule file: `.github/instructions/always-on-optimization.instructions.md`

Como activarlo en local:

1. Abre este repo en VS Code.
2. Asegura que Copilot Chat esta leyendo las instrucciones del workspace.
3. Recarga la ventana de VS Code cuando cambies prompts/instructions.

Comandos disponibles en este repo:

- `/caveman`
- `/caveman-help`
- `/caveman-review`
- `/caveman-commit`
- `/caveman-stats`
- `/caveman-compress`
- `/cavecrew`

## Referencias oficiales

Motores (razonamiento, indexado, retrieval):

- CodeGraph: [https://github.com/colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)
- GitNexus: [https://github.com/abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)
- Graphify (sitio): [https://graphify.net/](https://graphify.net/)
- Graphify (PyPI): [https://pypi.org/project/graphifyy/](https://pypi.org/project/graphifyy/)
- Repomix (engine + packing): [https://repomix.com/](https://repomix.com/)
- Repomix (GitHub): [https://github.com/yamadashy/repomix](https://github.com/yamadashy/repomix)

Como sacar el maximo partido a cada motor:

- CodeGraph
  - Que hace: navegacion estructural rapida del repo activo
    (simbolos, relaciones, contexto de codigo).
  - Maximo partido:
    - Mantener indice sincronizado con `codegraph sync`.
    - Usarlo como primer paso en tareas de codigo vivo (antes de lectura masiva).
    - Verificar salud con `codegraph status` en preflight diario.

- GitNexus
  - Que hace: grafo semantico y de impacto para analizar riesgo,
    rutas de ejecucion y trazabilidad.
  - Maximo partido:
    - Reindexar tras cambios amplios con `gitnexus analyze . --skills --embeddings`.
    - Usar `gitnexus impact` y `gitnexus detect-changes` antes de cambios sensibles.
    - En Windows, al no haber VECTOR nativo, usar fallback optimizado
      (ya configurado en `.vscode/mcp.json`):
      - `GITNEXUS_SEMANTIC_EXACT_SCAN_LIMIT=50000`
      - `GITNEXUS_EMBEDDING_THREADS=4`

- Graphify
  - Que hace: conocimiento local orientado a RAG sobre contexto interno del repo.
  - Maximo partido:
    - Regenerar grafo cuando cambie estructura con `scripts/context/build-graphify.ps1`.
    - Mantener `context/graphify-out/graph.json` actualizado para
      evitar respuestas con drift.

- Repomix
  - Que hace: snapshot consolidado del repo para analisis y transferencia de contexto.
  - Maximo partido:
    - Refrescar snapshot tras cambios de documentacion/arquitectura con `scripts/context/build-repomix.ps1`.
    - Excluir artefactos ruidosos cuando no aporten al objetivo para reducir tokens.

Herramientas runtime (operacion, memoria y optimizacion):

- Token Saver MCP (npm): [https://www.npmjs.com/package/token-saver-mcp](https://www.npmjs.com/package/token-saver-mcp)
- Token Saver (GitHub): [https://github.com/flightlesstux/token-saver](https://github.com/flightlesstux/token-saver)
- Codebase Memory MCP: [https://github.com/DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)

Como sacar el maximo partido a herramientas runtime:

- Token Saver MCP
  - Que hace: controla coste de contexto y evita sobre-recuperacion.
  - Maximo partido:
    - Mantenerlo siempre activo en MCP local.
    - Aplicar retrieval minimo suficiente y evitar lectura indiscriminada.

- Codebase Memory MCP
  - Que hace: memoria operativa persistente de patrones y decisiones.
  - Maximo partido:
    - Mantener `auto_index=true` y `auto_index_limit=50000`.
    - Guardar solo aprendizaje operativo util (no secretos, no ruido).

Checklist rapido de maximo rendimiento (post-reinicio):

```powershell
pwsh -ExecutionPolicy Bypass -File .\scripts\setup\validate-context.ps1
codegraph status
gitnexus status
codebase-memory-mcp config list
```

## Diagrama Visual Del Repositorio

```mermaid
flowchart TD
  U[Usuario] --> D[Documentacion Base]
  D --> R[README]
  D --> A[AGENTS]
  D --> F[FINAL_USAGE_GUIDE]
  R --> ORQ[orchestrator]
  R --> DOCS[docs 00-09]
  R --> OPS[scripts setup/intake/ops]
  ORQ --> ENGINES[CodeGraph | GitNexus | Graphify | Azure RAG | Repomix]
  OPS --> OBS[observability]
  DOCS --> USE[examples/use-cases]
```
