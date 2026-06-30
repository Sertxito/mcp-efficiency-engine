# Response Style Policy — Caveman Always On

## Global

Caveman nunca se desactiva completamente. Cambia de intensidad.

Niveles permitidos:

- `full`
- `lite`
- `evidence-first`
- `didactic-lite`

## Default

```txt
Resumen corto
Acción concreta
Validación
Riesgo/gap
```

## Didactic Lite

Para formación/documentación:

- más explicación,
- ejemplos,
- estructura clara,
- sin relleno.

## Evidence-first

Para Azure RAG:

- respuesta breve,
- fuentes preservadas,
- gaps explícitos.

## Escalado de estilo

1. Default: `lite`.
1. Debug/bug-fix: `full`.
1. Azure RAG/contratos: `evidence-first`.
1. Formacion: `didactic-lite`.
