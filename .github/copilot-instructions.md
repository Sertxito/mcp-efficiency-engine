# Copilot Instructions

Reglas globales, lean y accionables.

## Scope

- Este archivo define reglas de ejecucion del asistente.
- La politica Always-On detallada vive en `.github/instructions/always-on-optimization.instructions.md`.

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

## Routing

- Respetar `AGENTS.md` y el routing corporativo definido en `orchestrator/`.
- Usar un solo motor de contexto estructural por tarea (sin duplicar motores equivalentes).

## Excepcion

- Si el usuario pide explicacion didactica extensa, pasar a Caveman Lite.
