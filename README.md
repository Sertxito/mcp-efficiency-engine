# MCP-First Enterprise Full v6 — Optimization Edition

Versión final unificada con:

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

En esta versión, **Token Saver y Caveman Mode están siempre activos**.

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

Motores y herramientas usadas en este stack:

- CodeGraph: [https://github.com/colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)
- GitNexus: [https://github.com/abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)
- Graphify (sitio): [https://graphify.net/](https://graphify.net/)
- Graphify (PyPI): [https://pypi.org/project/graphifyy/](https://pypi.org/project/graphifyy/)
- Repomix: [https://repomix.com/](https://repomix.com/)
- Repomix (GitHub): [https://github.com/yamadashy/repomix](https://github.com/yamadashy/repomix)
- Token Saver MCP (npm): [https://www.npmjs.com/package/token-saver-mcp](https://www.npmjs.com/package/token-saver-mcp)
- Token Saver (GitHub): [https://github.com/flightlesstux/token-saver](https://github.com/flightlesstux/token-saver)
- Codebase Memory MCP: [https://github.com/DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
