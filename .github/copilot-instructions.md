# Copilot Instructions

Reglas globales, lean y accionables.

## Scope

- Este archivo define reglas de ejecucion del asistente.
- La politica Always-On detallada vive en `.github/instructions/always-on-optimization.instructions.md`.
- El alcance operativo por defecto para analizar, controlar y trabajar es la raiz del repositorio.
- Todo artefacto operativo de analisis y trazabilidad debe quedar bajo `autodocs/analysis_mcpee/` o `autodocs/generated/` segun su naturaleza.

## Reglas obligatorias

- Responder en espanol, directo y sin relleno.
- Formato por defecto: Diagnostico -> accion -> validacion -> riesgo/gap.
- Prioridad: seguridad y fuentes por encima de brevedad.
- Cambios minimos y seguros; no refactor fuera de scope.
- Si falta contexto, pedir solo el dato minimo imprescindible.
- Preferir evidencia precisa a exploracion amplia.
- Evitar discovery abierto y lecturas masivas innecesarias.
- Cuando haya tooling determinista (CLI), usarlo antes que generar boilerplate manual.
- Boost-first obligatorio en toda tarea: seleccionar y aplicar boost/agente/skill antes de editar o ejecutar cambios.
- Trazabilidad obligatoria por tarea: reportar siempre boost/agente/skill usado, motor aplicado, fallback (si existe) y evidencia de validacion.
- Mantener consistencia con patrones existentes del repositorio.
- No introducir nuevas convenciones sin necesidad explicita.
- No generar artefactos operativos fuera de `autodocs/analysis_mcpee/` y `autodocs/generated/`, salvo contrato explicito.
- Si una tarea afecta a un alcance funcional concreto, priorizar contexto, salidas y documentacion en la raiz y en `autodocs/`.
- Los analisis, diagnosticos y reportes generados por MCP Efficiency Engine
  para un proyecto deben guardarse preferentemente en
	`autodocs/analysis_mcpee/`.
- La trazabilidad de boost-first debe persistirse cuando aplique, bajo `autodocs/analysis_mcpee/`.
- En la primera pasada sobre un boost o proyecto nuevo, hacer onboarding
	profundo y recuperar el maximo contexto verificable relevante, aunque tarde
	mas, usando repo-intake, onboarding y los agentes/skills/prompts/
	instructions locales del proyecto cuando existan.

## Routing

- Respetar `AGENTS.md` y el routing corporativo definido en `orchestrator/`.
- Usar un solo motor de contexto estructural por tarea (sin duplicar motores equivalentes).

## Excepcion

- Si el usuario pide explicacion didactica extensa, pasar a Caveman Lite.
