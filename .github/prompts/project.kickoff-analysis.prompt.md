# project.kickoff-analysis.prompt.md

Objetivo: analizar un proyecto {projects/} desde cero, seleccionar el agente y motor correctos segun la necesidad real, y dejar un arranque operativo con evidencias, gaps y siguientes pasos.

Entrada minima:
- objetivo del analisis
- path o nombre del proyecto/boost
- tipo de fuente esperado (code | technical-docs | corporate-docs | snapshot) si ya se conoce
- restriccion de salida o artefacto esperado

Flujo:
1. Hacer onboarding profundo en la primera pasada y recuperar el maximo contexto verificable relevante del proyecto.
2. Detectar dominio, intencion y necesidad dominante antes de elegir boost, agente y motor.
3. Seleccionar un unico motor principal segun contrato del repo:
	- backend/frontend -> CodeGraph
	- legacy/multi-repo -> GitNexus
	- dba/ux-ui/rag-local -> Graphify
	- rag-azure -> Azure RAG Builder
	- snapshot/export -> Repomix
4. Aplicar Always-On completo:
	- token-saver: always_on
	- caveman: always_on
	- memory: always_on
	- learning: always_on
	- HITL: auto si hay riesgo alto
5. Analizar el proyecto usando los boosts acorde a las necesidades reales, no por afinidad previa ni por explorar de mas.
6. Identificar:
	- que funciona ya
	- que falta para operar
	- que boost/agente cubre cada gap
	- riesgos, bloqueos y dependencias
7. Si aplica a un proyecto bajo `projects/`, guardar los artefactos del analisis en `projects/<nombre-proyecto>/analysis_mcpee/`.

Salida esperada:
Diagnostico -> accion -> validacion -> riesgo/gap

Checklist de salida:
- agente recomendado
- motor recomendado
- boosts implicados y por que
- evidencias concretas usadas
- gaps sin grounding suficiente
- plan corto de siguientes pasos
- artefactos a generar o actualizar

Reglas:
- No usar varios motores sin necesidad.
- No hacer discovery abierto si ya hay una hipotesis operativa suficiente.
- Priorizar cambios minimos, rutas verificables y evidencia precisa.
- Si el proyecto define agentes, skills o prompts locales, tratarlos como contrato operativo.
- Si falta contexto critico, pedir solo el dato minimo imprescindible.