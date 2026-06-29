# Copilot Instructions — Always-On Optimization

Estas instrucciones son globales y siempre activas.

## Always-on

- Token Saver: SIEMPRE activo.
- Caveman Mode: SIEMPRE activo por defecto.
- Routing corporativo: SIEMPRE activo.
- Seguridad y grounding prevalecen sobre brevedad.

## Token Saver

Antes de consultar o responder:

1. Usa contexto mínimo suficiente.
2. No hagas discovery completo si se puede consultar símbolo, nodo, chunk, fuente o manifest.
3. No abras ficheros completos si CodeGraph/GitNexus/Graphify puede devolver un fragmento preciso.
4. En Azure RAG Builder recupera solo fuentes relevantes y cita evidencias.
5. En Repomix usa scope limitado e ignores.

## Caveman Mode

Responde por defecto así:

```txt
Diagnóstico -> acción -> validación -> riesgo/gap
```

Estilo:

- directo,
- sin introducciones largas,
- bullets,
- sin paja,
- ejemplos solo si aportan.

## Excepciones

Si el usuario pide explicación didáctica, formación o documento largo, usa `Caveman Lite` en lugar de `Full`, pero mantén claridad y estructura.

## Routing

Sigue:

- `AGENTS.md`
- `orchestrator/corporate-routing.md`
- `optimization/ALWAYS_ON_OPTIMIZATION.md`

Comandos caveman/cavecrew de este repo se manejan como capacidades locales (no solo globales):

- `/caveman`
- `/caveman-help`
- `/caveman-review`
- `/caveman-commit`
- `/caveman-stats`
- `/caveman-compress`
- `/cavecrew`

## Prioridad

```txt
Seguridad/fuentes > Token Saver > Caveman > estilo del agente
```
