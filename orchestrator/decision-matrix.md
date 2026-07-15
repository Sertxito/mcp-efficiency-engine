# Decision Matrix

Matriz de decision rapida para resolver agente y motor por tipo de entrada.

| Entrada dominante | Dominio | Agente esperado | Motor esperado | model_tier (minimo viable) | Criteria clave |
| --- | --- | --- | --- | --- | --- |
| Codigo repo unico | dev | backend | CodeGraph | simple -> GPT-4o o Claude Haiku; media -> Gemini 2.5 Pro o GPT-5.1 | symbol/callpath/blast radius |
| Codigo frontend repo unico | frontend | frontend-agent | CodeGraph | simple -> GPT-4o o Claude Haiku; media -> Gemini 2.5 Pro o GPT-5.1 | componentes/rutas/estado/UI impact |
| Codigo legacy o multi-repo | legacy | legacy | GitNexus | alta -> Claude Sonnet 4.6; critica -> Claude Opus solo si no hay alternativa valida | impacto/dependencias/fallback controlado |
| Guias UX/UI y design intent | ux-ui | ux-ui | Graphify | media -> Gemini 2.5 Pro o GPT-5.1; alta -> Claude Sonnet 4.6 | patrones UI/reutilizacion/consistencia |
| Documentacion tecnica local | dba/iot/rag-local | dba / iot / rag-local | Graphify | simple/media -> GPT-4o, Haiku o Gemini 2.5 Pro | nodos/relaciones/manifest |
| Documentacion corporativa | azure-rag | rag-azure | Azure RAG Builder | media/alta con evidence-first; subir tier solo si grounding lo exige | grounded=true y fuentes |
| Snapshot/export contexto | snapshot | snapshot | Repomix | simple -> GPT-4o o Haiku; media -> Gemini 2.5 Pro | scope acotado |

## Seleccion de modelo por complejidad (cost-aware)

| Complejidad | Uso tipico | Tier recomendado |
| --- | --- | --- |
| simple | Q&A, lookup, busqueda puntual | GPT-4o o Claude Haiku (0.33x) |
| media | refactor acotado, bug fix, docs tecnicas | Gemini 2.5 Pro o GPT-5.1 (1-3x) |
| alta | arquitectura, flujos agentic, impacto no trivial | Claude Sonnet 4.6 (6-9x) |
| critica | legacy multi-repo, riesgo alto y ambiguedad alta | Claude Opus solo si es necesario (27x) |

Regla de coste: usar siempre el modelo minimo viable para cumplir la tarea y subir de tier solo con justificacion explicita.

Excepcion permitida: en legacy/multi-repo puede requerirse Opus cuando Sonnet no resuelve el flujo con evidencia suficiente.

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

