# Optimization Guide

Token Saver optimiza contexto/coste. Caveman optimiza interaccion/respuesta. Se combinan por routing.

## Principios

1. Reducir coste sin perder evidencia.
2. Responder directo sin perder claridad.
3. Evitar retrieval y tool-calls innecesarios.
4. Mantener seguridad y gobernanza antes que velocidad.

## Capa Always-On

- Token Saver: activo siempre.
- Caveman: activo siempre (full o lite segun caso).
- Memory: cache operacional no sensible, sin friccion.
- Learning: registro post-ejecucion para mejora continua.
- HITL: auto en rutas de riesgo.

## Reglas operativas

1. Usa un solo motor principal por tarea.
2. Evita lecturas masivas si hay indice/grafo disponible.
3. Si falta evidencia, declarar gap antes de inventar.
4. Si la accion es destructiva, bloquear hasta aprobacion.

## Checklist

- Evals de routing en verde.
- Logs con bloque `hitl` cuando aplica.
- Refresh de `context/project-notes/*` al dia.
- Snapshot de `context/repomix/repomix-output.xml` actualizado.
