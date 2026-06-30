# Token Budget Policy — Always On

## Global

Token Saver nunca se desactiva.

## Reglas

- Consultar primero índices/grafos/manifests.
- No leer ficheros completos salvo necesidad.
- No recuperar más chunks de los necesarios.
- No combinar motores sin justificación.
- No generar snapshots globales sin scope.
- No perder fuentes si hay grounding.

## Señales de cumplimiento

- Uso de indice/grafo antes de lecturas completas.
- Tool calls acotadas al minimo necesario.
- Ausencia de retrieval duplicado.

## Señales de fallo

- "leer todo el repo" sin plan por fases.
- Mezcla de motores sin justificacion.
- Respuesta sin fuentes en consultas con grounding.

Si una respuesta requiere "mirar todo", primero generar plan de exploracion por fases.
