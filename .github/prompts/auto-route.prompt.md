# auto-route.prompt.md

Objetivo: enrutar una solicitud al agente y motor correctos con Always-On activo.

Entrada minima:
- user_input
- intent (si ya viene detectado)
- domain (si ya viene detectado)
- source_type (code | technical-docs | corporate-docs | snapshot)

Flujo:
1. Detectar intencion y tipo de fuente.
2. Seleccionar agente/motor segun contrato del repo.
3. Aplicar perfil Always-On:
	- token-saver: always_on
	- caveman: always_on
	- memory: always_on
	- learning: always_on
4. Emitir salida estructurada para observabilidad.

Salida esperada (JSON):
- agent
- engine
- capability
- repo
- optimization_profile
- grounded
- fallback
- notes

Reglas:
- No usar varios motores sin necesidad.
- Si no hay evidencia suficiente, marcar gap.
