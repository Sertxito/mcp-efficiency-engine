# Repo Intake Policy

## Objetivo

Incorporar repos al ecosistema sin clonar dentro de este repositorio y con metadata valida para routing.

## Reglas

1. No copiar repos terceros dentro de este repo.
2. Registrar cada repo en [repo-registry/repos.yml](repo-registry/repos.yml).
3. Ejecutar intake para extraer capacidades, dependencias y manifiestos.
4. Mantener contrato de naming y reglas de governance del registry.
5. Tratar repos opcionales como warning, no como bloqueo, si asi esta definido.
6. El trabajo especifico de proyectos gestionados dentro de este repositorio
   debe vivir bajo `projects/`.
7. Todo artefacto especifico de un proyecto debe guardarse en
   `projects/<nombre-proyecto>/` y no en la raiz, salvo artefactos globales de
   plataforma expresamente definidos.

## Flujo minimo

1. Registrar entrada en repos registry.
2. Validar registry en modo estricto.
3. Ejecutar intake y revisar artefactos generados.

## Criterios de validacion

1. Registry valido sin errores bloqueantes.
2. Artefactos de intake presentes y legibles.
3. Capacidades disponibles para routing y evaluacion.

## Senales de fallo

1. Repo fuera de registry.
2. Intake sin artefactos o con metadata incompleta.
3. Drift entre registry y capacidades detectadas.
