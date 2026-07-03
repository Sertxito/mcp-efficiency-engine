# routing spec

## Objetivo

Definir el contrato de enrutamiento entre intencion, dominio, agente, motor y nivel de grounding.

## Reglas

1. Cada evento debe seleccionar un agente y motor principal.
2. Si hay fallback, debe quedar marcado en el evento.
3. `grounded` solo puede ser `true` cuando existan `sources` resolubles.
4. Rutas de alto impacto deben activar HITL.
5. En casos mixtos, el motor secundario se justifica en `notes`.

## Entradas esperadas

1. `input`, `intent`, `domain`, `source_type`.
2. `capability` opcional para ruta dirigida.

## Validacion minima

1. `py -3 .\scripts\intake\resolve-routing.py --input "consulta contrato" --intent info --domain azure-rag --source-type corporate-docs` debe enrutar a `rag-azure`.
2. `py -3 .\scripts\intake\run-routing-evals.py` debe pasar sin casos fallidos.

