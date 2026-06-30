# Context Policy

## Objetivo

Usar solo el contexto necesario para resolver la tarea con evidencia trazable y sin retrieval redundante.

## Reglas

1. Recuperar primero artefactos estructurados (manifest, grafo, index) antes de lecturas masivas.
2. Limitar tool calls y chunks al minimo necesario para validar una decision.
3. Mantener trazabilidad: cuando aplique grounding, citar fuente concreta.
4. No mezclar motores equivalentes para la misma pregunta salvo justificacion explicita.
5. Si falta evidencia, declarar gap en lugar de inventar contexto.

## Criterios de validacion

1. El flujo muestra seleccion de una sola fuente primaria por tarea.
2. Las respuestas con grounding incluyen fuente o ruta verificable.
3. No hay lectura completa del repo sin plan por fases.

## Senales de fallo

1. Tool thrashing sin mejora de evidencia.
2. Mezcla de motores sin motivo.
3. Respuesta con afirmaciones no trazables.
