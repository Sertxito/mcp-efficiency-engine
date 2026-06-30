# rag spec

## Objetivo

Definir el uso de RAG local para documentacion tecnica del repo y artefactos internos.

## Alcance

1. Consultas sobre arquitectura, guias y politicas locales.
2. Navegacion de conocimiento indexado en `context/graphify-out/`.

## Reglas

1. Preferir RAG local para conocimiento interno antes de consultas externas.
2. No mezclar RAG local y Azure RAG sin justificar el caso mixto.
3. Si no hay evidencia local suficiente, declarar gap y escalar motor.
4. Mantener respuestas trazables a fuente local.

## Artefactos clave

1. `context/graphify-out/graph.json`.
2. `context/graphify-out/manifest.json`.
3. `docs/` y `project-notes/` como base documental.

## Validacion minima

1. La decision de routing para docs locales selecciona `rag-local-agent`.
2. La salida mantiene grounding explicito a fuentes del repo.
