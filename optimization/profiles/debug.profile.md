# Debug Profile

Perfil para bug-fix, troubleshooting y loops de validacion rapidos.

## Configuracion

```yaml
token_saver: always_on
token_saver_profile: strict
caveman: always_on
caveman_profile: full
grounding: on_demand
focus: root-cause-first
```

## Reglas

1. Ir directo a causa -> accion -> validacion.
1. Evitar lecturas masivas de archivos completos.
1. Solo incluir fuentes cuando el caso lo exija.
