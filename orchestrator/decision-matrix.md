# Decision Matrix

Matriz de decision rapida para resolver agente y motor por tipo de entrada.

| Entrada dominante | Dominio | Agente esperado | Motor esperado | Criteria clave |
| --- | --- | --- | --- | --- |
| Codigo repo unico | dev | backend | CodeGraph | symbol/callpath/blast radius |
| Codigo frontend repo unico | frontend | frontend-agent | CodeGraph | componentes/rutas/estado/UI impact |
| Codigo legacy o multi-repo | legacy | legacy | GitNexus | impacto/dependencias/fallback controlado |
| Guias UX/UI y design intent | ux-ui | ux-ui | Graphify | patrones UI/reutilizacion/consistencia |
| Documentacion tecnica local | dba/iot/rag-local | dba / iot / rag-local | Graphify | nodos/relaciones/manifest |
| Documentacion corporativa | azure-rag | rag-azure | Azure RAG Builder | grounded=true y fuentes |
| Snapshot/export contexto | snapshot | snapshot | Repomix | scope acotado |

## Frontera frontend vs ux-ui

1. `frontend`: cambios en codigo UI ejecutable (componentes, rutas, estado, handlers, render).
2. `ux-ui`: auditoria y gobierno de calidad UX/UI (accesibilidad, consistencia, design system, design intent).
3. Si la entrada es `source_type=technical-docs` y hay ambiguedad, resolver hacia `ux-ui`.
4. Si la entrada es `source_type=code` con implementacion/fix/refactor UI, resolver hacia `frontend`.

## Regla de desempate

1. Capability exacta solicitada.
2. Capability por dominio en intake v2.
3. Default de dominio.

## Condiciones de bloqueo

1. Repo no aprobado -> no enrutar por capability.
2. Dependencia no resuelta -> fallback de dominio.
3. Accion destructiva -> HITL bloqueante.

