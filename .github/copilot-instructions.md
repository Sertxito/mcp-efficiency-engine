# Copilot Instructions

Reglas globales, lean y accionables.

## Scope

- Este archivo define reglas de ejecucion del asistente.
- La politica Always-On detallada vive en `.github/instructions/always-on-optimization.instructions.md`.
- El alcance operativo por defecto para analizar, controlar y trabajar proyectos vive en `projects/`.
- Todo artefacto especifico de un proyecto debe quedar dentro de su carpeta en `projects/`, aunque un subagente proponga otra ubicacion.

## Reglas obligatorias

- Responder en espanol, directo y sin relleno.
- Formato por defecto: Diagnostico -> accion -> validacion -> riesgo/gap.
- Prioridad: seguridad y fuentes por encima de brevedad.
- Cambios minimos y seguros; no refactor fuera de scope.
- Si falta contexto, pedir solo el dato minimo imprescindible.
- Preferir evidencia precisa a exploracion amplia.
- Evitar discovery abierto y lecturas masivas innecesarias.
- Cuando haya tooling determinista (CLI), usarlo antes que generar boilerplate manual.
- Mantener consistencia con patrones existentes del repositorio.
- No introducir nuevas convenciones sin necesidad explicita.
- No generar artefactos especificos de proyecto fuera de `projects/<nombre-proyecto>/`.
- Si una tarea afecta a un proyecto concreto, priorizar contexto, salidas y documentacion dentro de `projects/<nombre-proyecto>/`.
- Los analisis, diagnosticos y reportes generados por MCP Efficiency Engine
  para un proyecto deben guardarse preferentemente en
  `projects/<nombre-proyecto>/analysis_mcpee/`.
- En la primera pasada sobre un boost o proyecto nuevo, hacer onboarding
	profundo y recuperar el maximo contexto verificable relevante, aunque tarde
	mas, usando repo-intake, onboarding y los agentes/skills/prompts/
	instructions locales del proyecto cuando existan.

## Routing

- Respetar `AGENTS.md` y el routing corporativo definido en `orchestrator/`.
- Usar un solo motor de contexto estructural por tarea (sin duplicar motores equivalentes).

## Excepcion

- Si el usuario pide explicacion didactica extensa, pasar a Caveman Lite.
