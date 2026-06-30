# dba.query-review.prompt.md

Objetivo: revisar consultas SQL y riesgos de rendimiento/seguridad.

Flujo:
1. Identificar tablas, joins y filtros.
2. Detectar riesgos: full scan, cardinalidad, locks, anti-patterns.
3. Proponer version mejorada.
4. Incluir estrategia de validacion.

Salida:
- query actual
- hallazgos
- query propuesta
- plan de prueba
