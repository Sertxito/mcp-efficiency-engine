# Human In The Loop (HITL)

## Purpose

Asegurar confirmacion humana solo cuando una decision o accion tiene riesgo alto, impacto externo o potencial destructivo.

## Scope

Aplicar en todas las rutas del sistema como capa transversal.

## Always-On Behavior

- Deteccion automatica de riesgo desde intent/domain/source/notes de routing.
- No pedir confirmacion para rutas de bajo riesgo.
- Pedir confirmacion cuando exista riesgo alto o fallback de routing.
- Bloquear ejecucion para acciones destructivas hasta aprobacion explicita.

## Risk Triggers

- deploy, production
- migrate, migration
- delete, drop, destroy, remove
- governance, policy
- security, rbac, role
- unresolved_dependencies
- routing_fallback

## Actions

- `none`: continuar sin aprobacion.
- `request_human_confirmation`: solicitar confirmacion antes de ejecutar.
- `block_until_human_approval`: bloquear hasta aprobacion humana.

## Observability Contract

Cada evento de routing debe incluir `hitl`:

- `mode`: `always_on_auto`
- `required`: `true|false`
- `action`: `none|request_human_confirmation|block_until_human_approval`
- `reason`: motivo legible y trazable

## Guardrails

- Nunca cachear secretos, credenciales, tokens o PII.
- Si hay duda de sensibilidad, declarar gap y no cachear.
- Confirmaciones humanas solo para impacto real; evitar friccion en bajo riesgo.
