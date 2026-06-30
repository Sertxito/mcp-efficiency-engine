# Fallback Strategy

Fallback: Graphify -> Azure RAG si faltan docs reales; Azure RAG -> Graphify si falta contexto tecnico; CodeGraph <-> GitNexus segun scope; si no hay fuente, gap.

## Triggers

1. Capability no disponible.
2. Dependencias no resueltas.
3. Fuente insuficiente para grounding.
4. Ambiguedad de scope (repo unico vs multi-repo).

## Reglas de degradacion

1. `capability unavailable` -> fallback a dominio.
2. `dependency unresolved` -> fallback a dominio + warning.
3. `no sources` en consulta con grounding -> `grounded=false` + gap explicito.
4. Si el fallback impacta ruta de riesgo -> HITL obligatorio.

## Escalado

1. Primer fallback: continuar con motor alternativo valido.
2. Fallback repetido del mismo patron: registrar learning y abrir ajuste de routing.
3. Fallback en accion de alto impacto: bloquear hasta confirmacion humana.

## Validacion

1. `fallback=true` solo cuando aplica razon valida.
2. `notes` debe incluir causa de fallback.
3. Eventos de fallback visibles en `observability/logs/routing-decisions.jsonl`.
