# azure-rag spec

## Objetivo

Definir cuando usar Azure RAG Builder para conocimiento corporativo y como evitar respuestas sin fuente.

## Alcance

1. Contratos, SLA, politicas y documentacion corporativa no contenida en el repo.
2. Consultas donde la fuente oficial debe citarse.

## Reglas

1. Azure RAG no se usa para modificar codigo del repo.
2. Si no hay fuente recuperada, se declara gap en lugar de inferir.
3. La respuesta debe separar claramente evidencia recuperada y recomendacion.
4. En tareas mixtas codigo + corporativo, usar motor principal y secundario justificado.

## Entradas esperadas

1. Intencion de consulta clara.
2. Contexto de dominio (seguridad, compliance, contrato, operaciones).

## Validacion minima

1. El evento de routing debe seleccionar `rag-azure` cuando `source_type=corporate-docs`.
2. Debe existir traza en `observability/logs/routing-decisions.jsonl` con `grounded=true` solo si hay fuentes.

