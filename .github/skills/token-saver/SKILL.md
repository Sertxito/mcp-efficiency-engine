# Token Saver Skill — Always On

## Estado

Siempre activo.

## Propósito

Reducir coste, contexto y ruido en cualquier herramienta o agente.

## Reglas

1. Iniciar toda tarea identificando el contexto mínimo necesario.
2. Evitar discovery completo.
3. Preferir consultas estructuradas:
   - símbolo,
   - endpoint,
   - tabla,
   - nodo,
   - chunk,
   - fuente,
   - manifest.
4. Limitar Azure RAG a fuentes relevantes.
5. Limitar Graphify a nodos/reportes relevantes.
6. Limitar Repomix por scope.
7. Registrar gap cuando falte evidencia.

## Por agente

- backend: CodeGraph con símbolo/call path.
- legacy: GitNexus con flow/dependency concreto.
- dba: Graphify con schema/query relevante.
- rag-local: Graphify con nodos/fuentes.
- rag-azure: Azure RAG Builder con fuentes y top-k limitado.
- iot: combinar solo si hace falta.
- community-manager: contexto suficiente, no todo el corpus.
