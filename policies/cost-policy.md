# Cost Policy

## Objetivo

Minimizar coste operativo de tool calls y retrieval sin perder calidad ni trazabilidad.

## Reglas

1. No usar Azure RAG para codigo local del repositorio.
2. Evitar tool thrashing: cada llamada debe aportar evidencia nueva.
3. Preferir consultas puntuales a indices/grafos frente a scans globales.
4. Evitar snapshots globales si el scope real es parcial.
5. Reutilizar artefactos ya generados antes de relanzar pipelines.

## Criterios de validacion

1. Numero de llamadas acotado al objetivo real.
2. Sin duplicacion de retrieval para la misma pregunta.
3. Sin uso de motor premium cuando existe alternativa local valida.

## Senales de fallo

1. Llamadas repetidas con mismo resultado.
2. Recuperar contexto no utilizado en la respuesta final.
3. Escalar a motor externo sin razon de negocio o grounding.
