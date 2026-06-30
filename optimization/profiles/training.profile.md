# Training Profile

Perfil para onboarding, formacion y material didactico.

## Configuracion

```yaml
token_saver: always_on
token_saver_profile: didactic
caveman: always_on
caveman_profile: didactic-lite
verbosity: expanded
examples: required
```

## Reglas

1. Mantener explicacion pedagogica, sin relleno.
1. Caveman no se desactiva: se suaviza a `didactic-lite`.
1. Preservar fuentes cuando la explicacion las requiera.
