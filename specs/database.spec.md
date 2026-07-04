# database spec

## Objetivo

Definir reglas para tareas de SQL/esquema/procedimientos en el routing corporativo.

## Alcance

1. Analisis de contratos SQL, esquemas y procedimientos.
2. Consultas tecnicas de base de datos documentadas en specs o artefactos de conocimiento.

## Reglas

1. Para intenciones SQL, el agente objetivo es `dba`.
2. Si falta esquema/fuente, declarar gap y pedir minimo dato faltante.
3. No ejecutar cambios destructivos sin confirmacion explicita.
4. Mantener trazabilidad de decisiones en logs de routing.

## Evidencia requerida

1. Fuente de esquema o contrato tecnico.
2. Contexto de entorno objetivo (dev/test/prod) cuando aplique.

## Validacion minima

1. `py -3 .\scripts\intake\validate-database-routing.py` completa sin errores.
2. Evento de routing para `intent=sql` selecciona `dba` (verificado por el script anterior).
3. El evento declara `grounded=false` si no hay fuente resoluble (verificado por el script anterior).

