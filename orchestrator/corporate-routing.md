# Corporate Routing

## Objetivo

Definir reglas corporativas para seleccionar agente y motor principal por tarea sin mezclar engines de forma innecesaria.

## Mapa base

```txt
Codigo repo unico -> CodeGraph
Codigo legacy/multi-repo -> GitNexus
Docs tecnicas/locales -> Graphify
Docs corporativos reales -> Azure RAG Builder
Snapshot/export -> Repomix
```

## Regla de motor unico

1. Seleccionar un motor principal por evento.
2. Solo en caso mixto justificar apoyo secundario en `notes`.
3. Si no hay evidencia suficiente, declarar gap y no inventar.

## Caso mixto permitido

```txt
"Explicame auth y dame documentos reales"
-> Graphify para explicacion local
-> Azure RAG Builder para fuentes reales
```

## Hook Always-On (obligatorio)

Despues de elegir agente/motor, aplicar optimizacion transversal:

```txt
1. Detectar intencion
2. Detectar fuente
3. Elegir agente/motor
4. Aplicar Token Saver
5. Aplicar Caveman
6. Aplicar Memory + Learning
7. Evaluar HITL
8. Responder / actuar
9. Registrar evento
```

## Validacion minima

1. `prompt.exists=true`
2. `agent` y `engine` coherentes con dominio/capability
3. `hitl.required=true` en rutas de alto impacto
