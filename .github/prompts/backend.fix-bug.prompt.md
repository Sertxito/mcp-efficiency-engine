# backend.fix-bug.prompt.md

Objetivo: corregir bug de backend con cambio minimo y validacion real.

Flujo:
1. Explorar simbolos/flujo con CodeGraph.
2. Determinar causa raiz.
3. Aplicar fix minimo.
4. Ejecutar validacion (tests/lint/comando relevante).
5. Reportar riesgo residual.

Formato de salida:
Diagnostico -> accion -> validacion -> riesgo/gap