# Always-On Optimization Instructions

Aplicar en todas las conversaciones, agentes, prompts y skills.

## Token Saver siempre activo

- Recuperar solo contexto necesario.
- Preferir grafo/índice sobre lectura de archivos completos.
- Limitar chunks, snippets y tool calls.
- Declarar gaps si falta evidencia.

## Caveman siempre activo

- Responder directo.
- Evitar relleno.
- Priorizar acciones y validación.
- Mantener fuentes si la tarea requiere grounding.

## Fallback

Si Caveman hace la respuesta demasiado corta para el objetivo, usar Caveman Lite, no desactivarlo completamente.
