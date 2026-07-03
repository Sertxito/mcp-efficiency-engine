# rag.knowledge-answer.prompt.md

Objetivo: responder preguntas tecnicas con rag-local y Graphify.

Flujo:
1. Recuperar solo nodos/chunks relevantes.
2. Sintetizar respuesta enfocada a la pregunta.
3. Mostrar evidencia o declarar gap.

Reglas:
- no inventar informacion
- no abrir contexto completo si no hace falta
- priorizar precision sobre longitud
