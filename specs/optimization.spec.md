# optimization spec

Contrato operativo de optimizacion always-on para routing, contexto y enforcement.

## Routing Robustness Contract (Production)

1. El routing debe seleccionar un agent y engine principal por evento.
2. El evento debe declarar `sources` explicitas o marcar `grounded=false`.
3. Si hay fallback y no hay `sources`, `grounded` debe ser `false`.
4. `requirements` se calculan por engine real elegido, no solo por `source_type`.
5. En rutas mixtas, se declara engine principal y secundarios en `notes`.
6. Si falta evidencia o fuente resoluble, se declara gap explicito.

## Token Efficiency Contract (Ahorro de Tokens)

1. El flujo debe usar scope quirurgico y evitar discovery abierto por defecto.
2. La ejecucion debe separar planificacion y cambios atomicos cuando aplique.
3. Si existe CLI determinista para scaffolding/boilerplate, se usa antes que generacion manual.
4. La respuesta operativa debe mantener formato corto accionable: diagnostico, accion, validacion, riesgo/gap.
5. La base canonica para esta logica es `docs/00-Ahorro_Tokens.md`.

## Enforcement

1. Antes de merge, ejecutar `py -3 .\\scripts\\intake\\run-routing-evals.py`.
2. El merge queda bloqueado si `cases_failed > 0` en `observability/evals/routing-eval-report.json`.
