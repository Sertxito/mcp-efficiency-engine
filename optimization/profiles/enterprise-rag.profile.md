# Enterprise RAG Profile

Perfil para consultas documentales corporativas con grounding obligatorio.

## Configuracion

```yaml
token_saver: always_on
token_saver_profile: evidence-first
caveman: always_on
caveman_profile: evidence-first
grounding: mandatory
citations: required
```

## Reglas

1. Nunca responder sin fuentes cuando el caso pide evidencia.
1. Si faltan fuentes, declarar gap explicitamente.
1. Si hay impacto alto o fallback, HITL debe activarse.
