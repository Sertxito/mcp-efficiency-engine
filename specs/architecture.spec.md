# architecture spec

## Objetivo

Definir la arquitectura operativa del repo y el contrato entre orquestacion, agentes, motores de contexto y observabilidad.

## Componentes canonicos

1. Orquestacion: `orchestrator/`.
2. Agentes: `AGENTS.md` y `.github/agents/`.
3. Motores: CodeGraph, GitNexus, Graphify, Azure RAG Builder, Repomix.
4. Politicas: `policies/` y `optimization/policies/`.
5. Observabilidad: `observability/`.

## Reglas

1. Un evento de routing debe tener un motor principal.
2. Si hay mezcla de motores, el secundario se justifica en `notes`.
3. No se usa discovery amplio cuando hay evidencia estructurada suficiente.
4. En ausencia de grounding, se declara gap explicito.

## Flujo de ejecucion

1. Memory-first.
2. Resolucion de routing.
3. Ejecucion de agente/motor.
4. Registro en logs y evaluacion.

## Validacion minima

1. `python .\scripts\intake\resolve-routing.py --input "test" --intent info --domain dev --source-type code` emite evento valido.
2. `python .\scripts\intake\run-routing-evals.py` mantiene casos en verde.
