# Decision Matrix

Matriz de decision rapida para resolver agente y motor por tipo de entrada.

| Entrada dominante | Dominio | Agente esperado | Motor esperado | Criteria clave |
| --- | --- | --- | --- | --- |
| Codigo repo unico | dev | dev-agent | CodeGraph | symbol/callpath/blast radius |
| Codigo legacy o multi-repo | legacy | legacy-agent | GitNexus | impacto/dependencias/fallback controlado |
| Guias UX/UI y design intent | ux-ui | ux-ui-agent | Graphify | patrones UI/reutilizacion/consistencia |
| Documentacion tecnica local | dba/iot/rag-local | dba-agent / iot-agent / rag-local-agent | Graphify | nodos/relaciones/manifest |
| Documentacion corporativa | azure-rag | rag-azure-agent | Azure RAG Builder | grounded=true y fuentes |
| Snapshot/export contexto | snapshot | snapshot-agent | Repomix | scope acotado |

## Regla de desempate

1. Capability exacta solicitada.
2. Capability por dominio en intake v2.
3. Default de dominio.

## Condiciones de bloqueo

1. Repo no aprobado -> no enrutar por capability.
2. Dependencia no resuelta -> fallback de dominio.
3. Accion destructiva -> HITL bloqueante.
