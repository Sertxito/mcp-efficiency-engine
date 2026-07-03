<!-- converted from Documento_funcional_portal_rcc_canarias_v1.05.docx -->







HOJA DE CONTROL





# Introducción


El Portal RCC Canarias se plantea como una aplicación interna de supervisión y análisis de expedientes RCC.
En esta versión existirá un único perfil de usuario: Administrador. El administrador accederá a una única vista principal tipo dashboard, orientada al seguimiento del procesamiento automático, el análisis agregado de expedientes y la consulta operativa de solicitudes procesadas. La aplicación no contempla, en esta versión, una vista separada para usuario funcional ni flujos de tramitación individual con edición completa del expediente.
La finalidad del portal será:

# Alcance
El alcance de esta versión incluye:


# Actores y permisos
## Modelo de actor de esta versión
El administrador tendrá acceso a una vista única de supervisión compuesta por tres pestañas: Análisis de la IA, Análisis de expedientes y Expedientes. Su acceso será de consulta, análisis y supervisión, sin funcionalidades de tramitación ni edición del expediente.
No existirán en esta versión perfiles diferenciados de usuario funcional, tramitador, soporte, supervisor o consulta. Cualquier ampliación de roles deberá tratarse como una evolución funcional posterior.

## Regla general de acceso
El portal determinará el acceso del usuario autenticado en función de si dispone del perfil de administrador.

## Alcance del administrador
El administrador podrá consultar información agregada e individual en modo lectura. La vista individual se limitará al modal de detalle accesible desde la pestaña Expedientes.

# Arquitectura objetivo (AWS)

## Principio arquitectónico general
El Portal RCC Canarias será una aplicación interna desplegada en AWS, orientada exclusivamente a la supervisión, análisis y consulta de expedientes RCC por parte del perfil administrador.
La solución mantendrá una arquitectura web con frontend y backend API. El backend servirá la aplicación frontend, expondrá los servicios de consulta necesarios para alimentar las tres pestañas del dashboard y generará URLs firmadas temporales para la apertura segura de documentos PDF almacenados en S3.
El portal no ejecutará procesamiento pesado ni sustituirá al pipeline RCC. Su función será consultar y presentar información ya persistida por los procesos automáticos en Aurora PostgreSQL y documentación almacenada en S3.

## Componentes principales

## Separación entre portal y pipeline
El portal no ejecutará directamente los procesos automáticos de RCC. La generación de expedientes, OCR, clasificación documental, comprobaciones externas, cálculo de cuantía y generación de observaciones seguirán siendo responsabilidad del pipeline.
El portal consumirá los datos ya consolidados y no modificará la información funcional del expediente.

## Entrada al portal
El acceso principal será una única ruta de dashboard.

## Frontend servido por backend
El frontend será servido por el mismo backend que expone la API del portal. Esto permite desplegar la solución como un único artefacto lógico interno.
El backend tendrá las siguientes responsabilidades:

## Gestión documental en S3
Los documentos se almacenan en S3 y se consultan desde el portal únicamente bajo demanda. El usuario no accede directamente al bucket.
El administrador no debe elegir entre documento original y documento OCR. Esa decisión será transparente y la resolverá el backend.

# Navegación y UX global
## Principio general de navegación
a El Portal RCC Canarias tendrá una única vista de administrador organizada en tres zonas persistentes:
Estructura esperada:
┌─────────────────────────────────────────────────────────────┐
│ Topbar navy fija: Portal RCC                    Usuario     │
├───────────────┬─────────────────────────────────────────────┤
│ Sidebar       │ Cabecera fija de sección                    │
│               │ Filtros específicos fijos                   │
│               ├─────────────────────────────────────────────┤
│               │ KPIs                                        │
│               │ Gráficas / tabla / contenido con scroll     │
└───────────────┴─────────────────────────────────────────────┘


## Topbar navy

La topbar será de color navy y tendrá función institucional e informativa. No será el mecanismo principal de navegación.
Reglas:

## Sidebar lateral


La sidebar será el mecanismo principal de navegación entre las secciones funcionales del portal. Estará situada a la izquierda y será ajustable en anchura por el usuario.
Reglas:

## Cabecera fija de sección

Cada sección tendrá una cabecera propia dentro del área principal. Esta cabecera permanecerá visible mientras el usuario haga scroll.

Ejemplos de títulos y subtítulos

## Filtros específicos por sección

El portal no tendrá filtros globales. Cada sección tendrá exclusivamente sus filtros específicos, definidos según los datos que explota.
Los filtros estarán ubicados dentro de la cabecera fija de sección, debajo del título y subtítulo.

Reglas:

## Comportamiento de scroll
La aplicación deberá mantener visibles los elementos de orientación y filtrado durante el desplazamiento vertical.
Reglas:

## Área principal por sección
El área principal cambiará según la opción seleccionada en la sidebar.
La estructura interna de cada sección será homogénea:
Cabecera fija de sección
├─ Título
├─ Subtítulo
└─ Filtros específicos

Contenido con scroll
├─ KPIs
└─ Gráficas / tabla / contenido operativo

## Navegación a detalle de expediente
La sección Expedientes será la única que permitirá acceder al detalle individual de una solicitud.
El detalle se abrirá siempre mediante modal superpuesto, no mediante una ruta o pantalla independiente.
El modal de expediente incluirá seis secciones:

## Popup PDF
Desde las secciones Informe de validaciones y Documentos asociados del modal, el botón Ver abrirá un popup PDF superpuesto.
Reglas:

## KPIs
Los KPIs se mostrarán como tarjetas superiores dentro del contenido de cada sección, debajo del bloque fijo de cabecera y filtros.

## Gráficas
Las gráficas estarán presentes en Análisis de la IA y Análisis de expedientes.
Si se habilita interacción sobre gráficas, deberá limitarse a filtros o resaltados agregados, no a navegación a expedientes individuales.

# Expedientes
## Objetivo
Proporciona una tabla interactiva con el listado completo de expedientes que tienen persona interesada informada. Permite buscar, filtrar y ordenar expedientes de forma rápida. Al hacer clic en cualquier fila se abre un modal de detalle en modo lectura con toda la información relevante del expediente estructurada en 6 secciones.


## Filtros específicos

La sección Expedientes tendrá los siguientes filtros:

## Tabla de expedientes

SELECT
t_expedientes.id_expediente,
t_expedientes.uri_expediente,
t_persona.st_nombre || ' ' || COALESCE(t_persona.st_apellidos, '') AS nombre,
t_persona.co_identificacion                                         AS nif,
t_expedientes.co_estado_funcional,
t_expedientes.co_tipo_uc,
t_expedientes.co_modalidad_tramitacion,
t_expedientes.co_situacion_urgencia,
t_expedientes.bl_monoparental,
COUNT(t_observaciones.id_observacion)                               AS obs_pendientes,
t_cuantias.nu_cuantia_final,
COALESCE(t_expedientes.fe_creacion_platino,
t_expedientes.fe_creacion)                                 AS fe_creacion
FROM t_expedientes
JOIN t_persona
ON t_persona.id_persona = t_expedientes.id_persona_interesada
LEFT JOIN t_observaciones
ON t_observaciones.id_expediente = t_expedientes.id_expediente
AND (t_observaciones.bl_resuelta IS NULL OR t_observaciones.bl_resuelta != 'true')
AND (t_observaciones.fe_baja_logica IS NULL OR t_observaciones.fe_baja_logica = '')
LEFT JOIN t_cuantias
ON t_cuantias.id_expediente = t_expedientes.id_expediente
AND (t_cuantias.fe_baja_logica IS NULL OR t_cuantias.fe_baja_logica = '')
WHERE (t_persona.st_nombre IS NOT NULL OR t_persona.co_identificacion IS NOT NULL)
AND ...filtros...
GROUP BY t_expedientes.id_expediente
ORDER BY t_expedientes.id_expediente;

## Modal de detalle

Al hacer clic en una fila de la tabla se abre un modal de solo lectura con 6 secciones.
### Datos del interesado
SELECT t_persona.*
FROM t_expedientes
JOIN t_persona
ON t_persona.id_persona = t_expedientes.id_persona_interesada
WHERE t_expedientes.id_expediente = :id;

### Miembros de la unidad de convivencia
Selector desplegable con todos los miembros de la UC excepto la persona interesada. Al seleccionar un miembro se muestra su ficha de detalle.
SELECT
t_uc.co_parentesco_declarado,
t_uc.co_estado_miembro,
t_persona.id_persona,
t_persona.st_nombre,
t_persona.st_apellidos,
t_persona.co_identificacion,
t_persona.fe_nacimiento
FROM t_uc
JOIN t_persona
ON t_persona.id_persona = t_uc.id_persona
WHERE t_uc.id_expediente = :id
AND t_uc.id_persona != (
SELECT id_persona_interesada
FROM t_expedientes
WHERE id_expediente = :id)
AND (t_uc.fe_baja_logica IS NULL);

### Oposiciones y firmas
Cargado de forma asíncrona. Por cada persona de la UC se muestra su nombre, badge de firma (t_oposiciones.bl_firmada) y una tabla con el resultado por consulta (cada variable diferente a id_persona y a bl_firmada, y id_expediente es un tipo de consulta).

El valor “No” indica que No autorización, el valor “No_Opo” indica No oposición, el valor “Si” indica Autorización
SELECT
t_oposiciones.*,
t_persona.st_nombre,
t_persona.st_apellidos
FROM t_oposiciones
JOIN t_persona
ON t_persona.id_persona = t_oposiciones.id_persona
WHERE t_oposiciones.id_expediente = :id
AND (t_oposiciones.fe_baja_logica IS NULL OR t_oposiciones.fe_baja_logica = '');

### Cuantía
Muestra únicamente la cuantía final vigente como valor destacado (fuente grande, color verde).
SELECT t_cuantias.nu_cuantia_final
FROM t_cuantias
WHERE t_cuantias.id_expediente = :id
AND (t_cuantias.fe_baja_logica IS NULL OR t_cuantias.fe_baja_logica = '')
ORDER BY t_cuantias.fe_calculo DESC
LIMIT 1;

### Informe de Valoración
Cargado de forma asíncrona. Muestra el último informe generado con su resultado o recomendación (badge), fecha de generación y botón Ver que abre el PDF en un popup superpuesto sobre el modal de detalle.
SELECT
t_informes_generados.id_informe,
t_informes_generados.co_resultado,
t_informes_generados.co_recomendacion,
t_informes_generados.fe_creacion,
t_informes_generados.st_uri_informe
FROM t_informes_generados
WHERE t_informes_generados.id_expediente = :id
AND (t_informes_generados.fe_baja_logica IS NULL
OR t_informes_generados.fe_baja_logica = '')
ORDER BY t_informes_generados.fe_creacion DESC
LIMIT 1;

### Documentos asociados
Cargado de forma asíncrona. Los documentos se presentan agrupados por archivo físico (t_documentos_asociados.st_uri). Los grupos con al menos un fragmento de tipo 1, 2, 3 o 4 se muestran primero con borde dorado y fondo crema (Solicitud 7441, Anexo I, Anexo II).
Cabecera de cada grupo:
Fragmentos al expandir cada grupo:
SELECT
t_documentos_asociados.id_documento,
t_documentos_asociados.st_uri,
t_uris.st_nombre_documento,
t_documentos_asociados.co_tipo_documento,
dim_tipo_documento.st_nombre           AS st_nombre_tipo,
t_documentos_asociados.nu_pagina_inicio,
t_documentos_asociados.nu_pagina_fin,
t_documentos_asociados.nu_confianza_clasificacion,
t_documentos_asociados.co_regex,
t_documentos_asociados.co_ocr
FROM t_documentos_asociados
LEFT JOIN t_uris
ON t_uris.st_uri = t_documentos_asociados.st_uri
LEFT JOIN dim_tipo_documento
ON dim_tipo_documento.co_tipo_documento = t_documentos_asociados.co_tipo_documento
WHERE t_documentos_asociados.id_expediente = :id
ORDER BY
CASE WHEN t_documentos_asociados.co_tipo_documento IN ('1','2','3')
THEN 0 ELSE 1 END,
t_documentos_asociados.st_uri,
CAST(t_documentos_asociados.nu_pagina_inicio AS INTEGER);

# Análisis de expedientes
## Objetivo
Ofrece una visión estadística del parque de expedientes RCC. Permite analizar la distribución por estado, documentación presentada, perfil de las personas interesadas, observaciones activas, composición de las unidades de convivencia y datos económicos. Está organizada en 6 bloques temáticos con gráficas de distribución estática y de evolución temporal. Todos los componentes responden a los filtros de la sección.


## Filtros específicos

La sección Análisis de expedientes tendrá los siguientes filtros:
La fecha de referencia para filtrado y agrupación temporal es t_expedientes.fe_creacion_platino con fallback a t_expedientes.fe_creacion. Cada gráfica de evolución dispone de su propio selector de agrupación temporal (Día / Semana / Mes / Año) con valor por defecto Mes.

## KPIs

### Expedientes y procesamiento
Muestra dos filas de tres tarjetas cada una dentro de la misma card.
Fila 1: Totales
Fila 2: Promedios por expediente

### Características de los expedientes
Muestra dos filas de tres tarjetas cada una dentro de la misma card.
Fila 1: Tramitación
Fila 2: Unidad de convivencia

## Gráficas
### Estado del expediente

Distribución
Tipo: Donut chart.
Porcentaje de expedientes en cada estado funcional. Los estados son dinámicos. Colores: PENDIENTE=gris, SUBSANACION=ámbar, FAVORABLE=verde, DENEGADA=rojo, SUSPENDIDA=morado.
SELECT t_expedientes.co_estado_funcional, COUNT(*) AS total
FROM t_expedientes
WHERE ...filtros...
GROUP BY t_expedientes.co_estado_funcional
ORDER BY total DESC;

Evolución temporal
Tipo: Gráfica multi-línea.
Una línea por estado a lo largo del tiempo. Selector de agrupación temporal con valor por defecto Mes. Fecha de referencia: COALESCE(t_expedientes.fe_creacion_platino, t_expedientes.fe_creacion).
SELECT
SUBSTR(COALESCE(t_expedientes.fe_creacion_platino,
t_expedientes.fe_creacion), 1, 7) AS periodo,
t_expedientes.co_estado_funcional,
COUNT(*) AS total
FROM t_expedientes
WHERE ...filtros...
GROUP BY periodo, t_expedientes.co_estado_funcional
ORDER BY periodo;

### Documentos

Distribución por tipo
Tipo: Donut chart.
Número de documentos asociados de los tipos principales: 1=Solicitud 7441, 2=Anexo I, 3=Anexo II, 4=Solicitud 7475. Solo se contabilizan estos cuatro tipos.
SELECT
CASE t_documentos_asociados.co_tipo_documento
WHEN '1'  THEN 'Solicitud 7441'
WHEN '2'  THEN 'Anexo I'
WHEN '3'  THEN 'Anexo II'
WHEN '4' THEN 'Solicitud 7475'
END AS tipo,
COUNT(*) AS total
FROM t_documentos_asociados
WHERE t_documentos_asociados.id_expediente IN (
SELECT id_expediente FROM t_expedientes WHERE ...filtros...)
AND t_documentos_asociados.co_tipo_documento IN ('1','2','3','4')
GROUP BY tipo;

Evolución temporal por tipo
Tipo: Gráfica multi-línea.
Una línea por tipo de documento a lo largo del tiempo. Selector de agrupación temporal con valor por defecto Mes. Fecha de referencia del expediente padre.
SELECT
SUBSTR(COALESCE(t_expedientes.fe_creacion_platino,
t_expedientes.fe_creacion), 1, 7) AS periodo,
CASE t_documentos_asociados.co_tipo_documento
WHEN '1'  THEN 'Solicitud 7441'
WHEN '2'  THEN 'Anexo I'
WHEN '3'  THEN 'Anexo II'
WHEN '4' THEN 'Solicitud 7475'
END AS tipo,
COUNT(*) AS total
FROM t_documentos_asociados
JOIN t_expedientes
ON t_expedientes.id_expediente = t_documentos_asociados.id_expediente
WHERE t_expedientes.id_expediente IN (
SELECT id_expediente FROM t_expedientes WHERE ...filtros...)
AND t_documentos_asociados.co_tipo_documento IN ('1','2','3','4')
GROUP BY periodo, tipo
ORDER BY periodo;

### Persona interesada

Distribución por género
Tipo: Donut chart.
Distribución de género de las personas interesadas. Acepta los valores 'F'/'mujer' como Mujer y 'M'/'hombre' como Hombre.
SELECT
CASE LOWER(t_persona.co_genero)
WHEN 'f'      THEN 'Mujer'
WHEN 'mujer'  THEN 'Mujer'
WHEN 'm'      THEN 'Hombre'
WHEN 'hombre' THEN 'Hombre'
ELSE 'No especificado'
END AS genero,
COUNT(*) AS total
FROM t_expedientes
JOIN t_persona
ON t_persona.id_persona = t_expedientes.id_persona_interesada
WHERE t_expedientes.id_expediente IN (
SELECT id_expediente FROM t_expedientes WHERE ...filtros...)
GROUP BY genero;

Estado civil
Tipo: Donut chart.
Distribución del estado civil de las personas interesadas (t_persona.co_estado).
SELECT
COALESCE(t_persona.co_estado, 'No especificado') AS estado_civil,
COUNT(*) AS total
FROM t_expedientes
JOIN t_persona
ON t_persona.id_persona = t_expedientes.id_persona_interesada
WHERE t_expedientes.id_expediente IN (
SELECT id_expediente FROM t_expedientes WHERE ...filtros...)
GROUP BY estado_civil
ORDER BY total DESC;

### Observaciones

Activas por tipo
Tipo: Donut chart.
Número de observaciones pendientes agrupadas por co_grupo. Grupos posibles: DENEGACION, SUBSANACION, REVISION, INFORMACION.
SELECT t_observaciones.co_grupo, COUNT(*) AS total
FROM t_observaciones
WHERE (t_observaciones.fe_baja_logica IS NULL
OR t_observaciones.fe_baja_logica = '')
AND (t_observaciones.bl_resuelta IS NULL
OR t_observaciones.bl_resuelta != 'true')
AND t_observaciones.id_expediente IN (
SELECT id_expediente FROM t_expedientes WHERE ...filtros...)
GROUP BY t_observaciones.co_grupo;

Evolución temporal
Tipo: Gráfica multi-línea.
Una línea por grupo de observación a lo largo del tiempo. Selector de agrupación temporal con valor por defecto Mes. Fecha de referencia del expediente padre.
SELECT
SUBSTR(COALESCE(t_expedientes.fe_creacion_platino,
t_expedientes.fe_creacion), 1, 7) AS periodo,
t_observaciones.co_grupo                          AS tipo,
COUNT(*) AS total
FROM t_observaciones
JOIN t_expedientes
ON t_expedientes.id_expediente = t_observaciones.id_expediente
WHERE (t_observaciones.fe_baja_logica IS NULL
OR t_observaciones.fe_baja_logica = '')
AND t_expedientes.id_expediente IN (
SELECT id_expediente FROM t_expedientes WHERE ...filtros...)
GROUP BY periodo, tipo
ORDER BY periodo;

### Unidad de convivencia

Distribución por tipo UC
Tipo: Donut chart.
Distribución de expedientes por tipo de UC (t_expedientes.co_tipo_uc).
SELECT
COALESCE(dim_uc.st_descripcion, t_expedientes.co_tipo_uc, 'SIN_TIPO_UC') AS tipo_uc,
COUNT(*) AS total
FROM t_expedientes
LEFT JOIN dim_uc
ON dim_uc.co_tipo_uc = t_expedientes.co_tipo_uc
WHERE ...filtros...
GROUP BY t_expedientes.co_tipo_uc
ORDER BY total DESC;


Evolución temporal adultos / menores
Tipo: Gráfica multi-línea.
Muestra la suma acumulada de adultos y menores por periodo. Selector de agrupación temporal con valor por defecto Mes.
SELECT
SUBSTR(COALESCE(t_expedientes.fe_creacion_platino,
t_expedientes.fe_creacion), 1, 7) AS periodo,
SUM(t_expedientes.nu_adultos)                     AS adultos,
SUM(t_expedientes.nu_menores)                     AS menores
FROM t_expedientes
WHERE ...filtros...
GROUP BY periodo
ORDER BY periodo;


### Cuantías
Distribución por tramos
Tipo: Gráfica de barras agrupadas.
Distribución de expedientes agrupados en 4 tramos de cuantía final calculada.
SELECT
CASE
WHEN t_cuantias.nu_cuantia_final < 0    THEN 'Menos de 0'
WHEN t_cuantias.nu_cuantia_final < 500  THEN '0 — 500'
WHEN t_cuantias.nu_cuantia_final < 1000 THEN '500 — 1000'
ELSE '1000+'
END AS tramo,
COUNT(*) AS expedientes
FROM t_cuantias
WHERE (t_cuantias.fe_baja_logica IS NULL OR t_cuantias.fe_baja_logica = '')
AND t_cuantias.id_expediente IN (
SELECT id_expediente FROM t_expedientes WHERE ...filtros...)
GROUP BY tramo;

Evolución temporal de cuantía media

Tipo: Gráfica multi-línea.
Evolución de la cuantía media (€) a lo largo del tiempo. Selector de agrupación temporal con valor por defecto Mes. Fecha de referencia del expediente padre.
SELECT
SUBSTR(COALESCE(t_expedientes.fe_creacion_platino,
t_expedientes.fe_creacion), 1, 7) AS periodo,
ROUND(AVG(t_cuantias.nu_cuantia_final), 2)        AS cuantia_media
FROM t_cuantias
JOIN t_expedientes
ON t_expedientes.id_expediente = t_cuantias.id_expediente
WHERE (t_cuantias.fe_baja_logica IS NULL OR t_cuantias.fe_baja_logica = '')
AND t_expedientes.id_expediente IN (
SELECT id_expediente FROM t_expedientes WHERE ...filtros...)
GROUP BY periodo
ORDER BY periodo;

# Análisis de la IA
## Objetivo
Monitoriza el rendimiento del pipeline de procesamiento automático de la IA del sistema RCC. Permite al administrador entender cuántos expedientes, documentos y fragmentos se han procesado, cuántas ejecuciones de agente se han realizado, el consumo de tokens y la eficiencia del clasificador de documentos. Todos los componentes responden al filtro de periodo (fecha desde / hasta).

## Filtros específicos

La sección Análisis de la IA tendrá los siguientes filtros:
Adicionalmente, todas las métricas se validan para que el id_expediente exista en t_expedientes:
AND t_metricas.id_expediente IN (SELECT id_expediente FROM t_expedientes)

## KPIs

### Procesamiento
Muestra dos filas de tres tarjetas cada una dentro de la misma card.
Fila 1: Totales
Fila 2: Promedios

### Tokens
Muestra dos filas de tres tarjetas cada una dentro de la misma card.
Fila 1: Totales
Fila 2: Promedios

## Gráficas
### Evolución de procesamiento

Evolución temporal de procesamiento
Tipo: Gráfica de barras agrupadas.
Muestra la evolución de expedientes, documentos y fragmentos distintos procesados a lo largo del tiempo. Cada gráfica dispone de un selector propio de agrupación temporal (Día / Semana / Mes / Año) con valor por defecto Día. La fecha de referencia es t_metricas.fe_creacion.

Evolución temporal de tokens
Tipo: Gráfica multi-línea.
Muestra el consumo de tokens desglosado en input, output y total a lo largo del tiempo. Selector de agrupación temporal con valor por defecto Día.

### Clasificación de documentos

Ejecuciones por agente
Tipo: Donut chart.
Distribución del número total de ejecuciones por agente. El nombre del agente se obtiene de dim_agente.st_nombre mediante join por co_agente. Si no existe en dim_agente, se muestra el código bruto.
SELECT
COALESCE(dim_agente.st_nombre, t_metricas.co_agente) AS agente,
COUNT(*) AS ejecuciones
FROM t_metricas
JOIN t_expedientes
ON t_expedientes.id_expediente = t_metricas.id_expediente
LEFT JOIN dim_agente
ON dim_agente.co_agente = t_metricas.co_agente
WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta
GROUP BY t_metricas.co_agente
ORDER BY ejecuciones DESC;

Reconocimiento de fragmentos
Tipo: Donut chart.
Sobre los fragmentos distintos procesados en el periodo, muestra cuántos fueron clasificados por Expresiones Regulares y cuántos por IA. El campo co_regex proviene de t_documentos_asociados via join por id_documento.
SELECT
CASE WHEN t_documentos_asociados.co_regex = 'true'
THEN 'Expresiones Regulares'
ELSE 'IA'
END AS metodo,
COUNT(DISTINCT t_metricas.id_documento) AS total
FROM t_metricas
JOIN t_expedientes
ON t_expedientes.id_expediente = t_metricas.id_expediente
LEFT JOIN t_documentos_asociados
ON t_documentos_asociados.id_documento = t_metricas.id_documento
WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta
AND t_metricas.id_documento IS NOT NULL
GROUP BY metodo;

### Estadísticas por agente

Tipo: Tabla.
Una fila por agente IA ordenada por número de ejecuciones descendente.
SELECT
COALESCE(dim_agente.st_nombre, t_metricas.co_agente) AS agente,
dim_agente.st_descripcion,
COUNT(*)                                               AS ejecuciones,
ROUND(AVG(t_metricas.nu_duracion_segundos), 3)        AS duracion_media_s,
ROUND(AVG(t_metricas.nu_tokens_input))                 AS tokens_input_media,
ROUND(AVG(t_metricas.nu_tokens_output))                AS tokens_output_media
FROM t_metricas
JOIN t_expedientes
ON t_expedientes.id_expediente = t_metricas.id_expediente
LEFT JOIN dim_agente
ON dim_agente.co_agente = t_metricas.co_agente
WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta
GROUP BY t_metricas.co_agente
ORDER BY ejecuciones DESC;
| Organismo | Viceconsejería de Bienestar Social. Gobierno de Canarias | Viceconsejería de Bienestar Social. Gobierno de Canarias | Viceconsejería de Bienestar Social. Gobierno de Canarias |
| --- | --- | --- | --- |
| Proyecto | Tecnologías productivas en materia de Discapacidad | Tecnologías productivas en materia de Discapacidad | Tecnologías productivas en materia de Discapacidad |
| Entregable | Plantilla | Plantilla | Plantilla |
| Autor | Accenture | Accenture | Accenture |
| Versión/Edición | 0100 | Fecha versión | dd/mm/aaaa |
| Aprobado por |  | Fecha aprobación | dd/mm/aaaa |
|  |  | Páginas |  |
| Finalidad | Descripción |
| --- | --- |
| Expedientes | Revisar el listado de solicitudes procesadas y abrir un modal de detalle para consultar datos principales, UC, cuantías, observaciones y documentos. |
| Análisis de expedientes | Consultar métricas agregadas de estado, modalidad, urgencia, cuantías, observaciones y evolución territorial. |
| Análisis de la IA | Monitorizar el rendimiento del procesamiento automático, OCR, clasificación documental, reprocesos y éxito del pipeline. |
| Bloque | Incluido |
| --- | --- |
| Dashboard administrador | Vista única con topbar superior navy y tres pestañas funcionales. |
| Filtros específicos por pestaña | Filtros aplicables a una pestaña concreta, como tipo documental en Análisis de la IA o tipo de observación en Análisis de la IA y Análisis de expedientes. |
| Análisis de la IA | KPIs y gráficas del procesamiento automático. |
| Análisis de expedientes | KPIs y gráficas agregadas sobre solicitudes RCC. |
| Expedientes | Listado operativo de solicitudes procesadas con apertura de detalle en modal. |
| Modal de expediente | Consulta de datos del interesado, UC, cuantías, observaciones y documentos. |
| Visor documental | Apertura de PDF en popup superpuesto desde documentos asociados. |
| Backend API | Servicios de consulta para métricas, filtros, listados, detalle y documentos. |
| Persistencia | Lectura sobre Aurora PostgreSQL. |
| Documentación | Consulta de documentos físicos almacenados en S3. |
| Auditoría técnica | Registro de accesos relevantes, apertura de detalle y generación de URL firmada si se requiere trazabilidad. |
| Caso | Comportamiento |
| --- | --- |
| Usuario administrador válido | Accede directamente al dashboard del Portal RCC. |
| Usuario sin perfil administrador | Se muestra pantalla de acceso no autorizado. |
| Sesión no válida o expirada | Se redirige al mecanismo de autenticación configurado o se muestra error de sesión. |
| Error al recuperar permisos | Se muestra mensaje funcional de error y no se cargan datos del portal. |
| Ámbito | Permiso |
| --- | --- |
| Dashboard | Acceso completo a la vista única del portal. |
| Filtros | Aplicar filtros globales y específicos por pestaña. |
| Análisis de la IA | Consultar KPIs, gráficas y métricas del procesamiento automático. |
| Análisis de expedientes | Consultar indicadores agregados, distribuciones y evolución. |
| Expedientes | Consultar listado paginado de solicitudes procesadas. |
| Detalle de expediente | Abrir modal de consulta desde una fila del listado. |
| Documentación | Consultar documentos asociados y abrir PDF mediante botón “Ver”. |
| Observaciones | Consultar observaciones activas del expediente. |
| Cuantías | Consultar cálculo vigente e histórico de cuantías. |
| Componente | Función |
| --- | --- |
| Frontend interno | Interfaz del usuario funcional y del usuario administrador. |
| Backend del portal | Sirve el frontend, expone API REST, controla permisos, genera URLs firmadas y coordina operaciones. |
| Aurora PostgreSQL | Repositorio principal de datos funcionales, estados, observaciones, comprobaciones, trazabilidad y analítica. |
| S3 documentos | Bucket para documentos recibidos. |
| Capa de autenticación / cabeceras trusted | Resuelve identidad del usuario y perfil. En fase provisional podrá inyectar cabeceras internas. |
| Responsabilidad | Sistema responsable |
| --- | --- |
| Ingesta de asientos | Pipeline RCC |
| Descarga de documentos | Pipeline RCC |
| OCR documental | Pipeline RCC |
| Extracción de datos | Pipeline RCC |
| Comprobaciones externas | Pipeline RCC |
| Generación de observaciones | Pipeline RCC |
| Cálculo de cuantía | Pipeline RCC |
| Consulta de métricas | Portal RCC |
| Visualización de dashboard | Portal RCC |
| Listado de expedientes | Portal RCC |
| Modal de detalle | Portal RCC |
| Apertura de PDFs | Portal RCC mediante backend y S3 |
| Ruta | Perfil permitido | Comportamiento |
| --- | --- | --- |
| /dashboard | Administrador | Abre la vista única del Portal RCC. |
| /dashboard/seguimiento-ia | Administrador | Abre el dashboard con la pestaña Análisis de la IA activa. |
| /dashboard/analisis-expedientes | Administrador | Abre el dashboard con la pestaña Análisis de expedientes activa. |
| /dashboard/expedientes | Administrador | Abre el dashboard con la pestaña Expedientes activa. |
| Responsabilidad | Descripción |
| --- | --- |
| Servir frontend | Entregar la aplicación web del dashboard. |
| Exponer API de consulta | Publicar endpoints para KPIs, gráficas, filtros, listados, detalle y documentos. |
| Validar autorización | Comprobar que el usuario tiene perfil administrador. |
| Aplicar filtros | Transformar los filtros del frontend en consultas seguras al modelo de datos. |
| Generar URLs firmadas | Crear URLs temporales para abrir documentos PDF desde S3. |
| Normalizar respuestas | Devolver datos ya preparados para renderizar KPIs, gráficas, tablas y modal. |
| Registrar eventos técnicos | Auditar accesos, errores y apertura documental cuando aplique. |
| Regla | Descripción |
| --- | --- |
| Documento físico | Representa el PDF completo almacenado en S3 en renta-s3-ocr-docs. |
| URL firmada | El backend genera una URL temporal para el visor PDF. |
| Apertura desde modal | El botón “Ver” de la sección Documentos asociados abre el PDF en popup superpuesto. |
| Zona | Comportamiento |
| --- | --- |
| Topbar navy | Cabecera fija superior con identidad institucional, nombre del portal y usuario conectado. |
| Sidebar lateral izquierda | Navegación principal entre las tres secciones del portal. El orden es Expedientes, Analisis de Expedientes y Analisis de la IA. |
| Área principal | Contenido dinámico de la sección activa: filtros, KPIs, gráficas, tabla o modales. Al ingresar se muestra primero la sección de expedientes. |
| Zona | Comportamiento |
| --- | --- |
| Topbar navy | Siempre visible en la parte superior. |
| Sidebar lateral | Siempre visible a la izquierda. Se puede ajustar |
| Cabecera de sección | Fija bajo la topbar dentro del área principal. |
| Filtros específicos | Fijos bajo la cabecera de sección. |
| Contenido inferior | Se desplaza verticalmente mediante scroll. |
| Elemento | Descripción |
| --- | --- |
| Identidad institucional | Logo o denominación institucional disponible. |
| Nombre del portal | “Portal RCC” o “Portal RCC Canarias”. |
| Usuario conectado | Nombre visible del administrador, si está disponible. |
| Estado de sesión | Información o acción de salida si el mecanismo de autenticación lo contempla. |
| Regla | Comportamiento |
| --- | --- |
| Topbar fija | Permanece visible durante todo el uso del portal. |
| Sin pestañas | No contiene las secciones Análisis de la IA, Análisis ni Expedientes. |
| Sin acciones de negocio | No incluye acciones de tramitación, resolución, edición o reproceso. |
| Sin acciones destructivas | No permite eliminar, cambiar estado ni modificar expedientes. |
| Entrada | Vista destino | Finalidad |
| --- | --- | --- |
| Expedientes | Listado operativo | Consultar solicitudes procesadas y abrir el modal de detalle. |
| Análisis de expedientes | Dashboard analítico RCC | Analizar estados, cuantías, territorio, modalidad, urgencia, observaciones y evolución. |
| Análisis de la IA | Dashboard de procesamiento automático | Monitorizar asientos, documentos, OCR, reprocesos, observaciones y éxito del pipeline. |
| Regla | Comportamiento |
| --- | --- |
| Vista inicial | Al acceder al portal se abre “Expedientes”. |
| Sección activa | La entrada seleccionada se muestra destacada visualmente. |
| Sidebar fija | Permanece visible durante el scroll vertical. |
| Sidebar ajustable | El usuario puede modificar manualmente el ancho de la sidebar mediante un separador o handle lateral. |
| Ancho mínimo | La sidebar no podrá reducirse por debajo del ancho mínimo necesario para mostrar iconos. |
| Ancho máximo | La sidebar no podrá ocupar un ancho que perjudique la lectura del contenido principal. |
| Colapsado | Podrá contraerse para mostrar únicamente iconos. |
| Expandido | Muestra iconos y texto de cada sección. |
| Persistencia local | El ancho elegido y el estado expandido o colapsado podrán guardarse en localStorage. |
| Sin navegación por estado | No habrá entradas separadas para pendientes, subsanación, favorables, denegadas o suspendidas. |
| Sin “Mis solicitudes” | Se elimina al existir un único usuario administrador. |
| Sin badges obligatorios | No se contemplan contadores en la sidebar salvo ampliación posterior. |
| Elemento | Descripción |
| --- | --- |
| Título de sección | Nombre de la sección activa. |
| Subtítulo funcional | Descripción breve del objetivo de la sección. |
| Filtros específicos | Filtros propios de la sección activa. |
| Acción limpiar filtros | Restablece los valores por defecto de la sección. |
| Sección | Título | Subtítulo funcional |
| --- | --- | --- |
| Expedientes | Expedientes | Listado operativo de solicitudes procesadas con acceso al detalle del expediente, unidad de convivencia, cuantías, observaciones y documentos asociados. |
| Análisis de expedientes | Análisis de expedientes | Visión agregada del estado de las solicitudes RCC, su evolución, distribución territorial, modalidad, urgencia, observaciones y cuantías. |
| Análisis de la IA | Análisis de la IA | Monitorización del procesamiento automático de asientos, documentos, OCR, observaciones y reprocesos del pipeline RCC. |
| Sección | Filtros específicos |
| --- | --- |
| Expedientes | Búsqueda por expediente, nombre y/o documento de persona interesada, estado funcional, monoparentalidad, tramitacion simplificada, urgencia, tipo UC, observaciones, rango de cuantía máximo y mínimo. |
| Análisis de expedientes | Periodo de entrada o creación, estado funcional, tramitación simplificada, urgencia, tipo UC, monoparentalidad, cuantía, observaciones. |
| Análisis de la IA | Periodo de procesamiento. |
| Regla | Comportamiento |
| --- | --- |
| Filtros independientes | Cada sección gestiona su propio estado de filtros. |
| Cambio de sección | Se cargan los filtros propios de la nueva sección. |
| Limpiar filtros | Restablece únicamente los filtros de la sección activa. |
| Aplicación en backend | Los filtros se aplican en backend para mantener consistencia. |
| Sin filtros no aplicables | No se mostrarán filtros que no tengan sentido en la sección activa. |
| Sin filtros en sidebar | La sidebar queda reservada exclusivamente para navegación. |
| Elemento | Comportamiento durante scroll |
| --- | --- |
| Topbar navy | Siempre visible. |
| Sidebar lateral | Siempre visible. |
| Cabecera de sección | Fija bajo la topbar. |
| Filtros específicos | Fijos bajo la cabecera de sección. |
| KPIs | Se desplazan con el contenido. |
| Gráficas | Se desplazan con el contenido. |
| Tabla de expedientes | Se desplaza con el contenido. |
| Situación | Comportamiento |
| --- | --- |
| Scroll largo en gráficas | El usuario mantiene visibles título y filtros. |
| Scroll largo en tabla | El usuario puede modificar filtros sin volver arriba. |
| Modal abierto | Se bloquea el scroll del fondo. |
| Popup PDF abierto | El scroll se limita al visor documental. |
| Sección | Contenido |
| --- | --- |
| Análisis de la IA | Filtros específicos, KPIs y gráficas del procesamiento automático. |
| Análisis de expedientes | Filtros específicos, KPIs y gráficas analíticas. |
| Expedientes | Filtros específicos, KPIs resumen, tabla de expedientes y modal de detalle. |
| Acción | Comportamiento |
| --- | --- |
| Clic en fila de expediente | Abre modal de detalle en modo lectura. |
| Cierre del modal | Vuelve a la tabla manteniendo filtros, búsqueda, ordenación y página. |
| Tecla Escape | Vuelve a la tabla manteniendo filtros, búsqueda, ordenación y página. |
| Sección | Contenido |
| --- | --- |
| Datos del interesado | Información identificativa y territorial del solicitante. |
| Miembros de la unidad de convivencia | Personas de la UC y estado de verificación. |
| Oposiciones y firmas | Presenta una tabla con las oposiciones de las personas y si la solicitud 7441, anexo I y anexo II se encuentran firmados. |
| Cuantías | Cálculo de la cuantía. |
| Informe de validación | Documento generado para la validación con accion de “Ver”. |
| Documentos asociados | Documentos con acción “Ver”. |
| Acción | Comportamiento |
| --- | --- |
| Botón “Ver” | Solicita al backend una URL firmada temporal. |
| Cierre del PDF | Vuelve al modal de expediente sin cerrarlo. |
| Error documental | Muestra mensaje recuperable. |
| Regla | Descripción |
| --- | --- |
| El PDF no sustituye al portal | Se muestra como popup superpuesto. |
| No se pierde contexto | Al cerrar el PDF, se mantiene abierto el modal. |
| Sin edición documental | El popup solo permite visualización. |
| Regla | Comportamiento |
| --- | --- |
| Origen único de documentos | Los PDFs visualizados por el portal se obtienen siempre desde renta-s3-ocr-docs. |
| Ubicación | Primer bloque del contenido desplazable. |
| Actualización | Se recalculan al modificar filtros. |
| Formato | Valor principal, etiqueta y unidad cuando aplique. |
| Porcentajes | Mostrar con un decimal como máximo. |
| Importes | Mostrar en euros con formato homogéneo. |
| Sin datos | Mostrar cero o guion según corresponda. |
| Sin acción de negocio | Los KPIs no ejecutan cambios funcionales. |
| Regla | Comportamiento |
| --- | --- |
| Título claro | Cada gráfica indica qué mide. |
| Tooltip | Al pasar el cursor, muestra valor exacto y categoría. |
| Leyenda | Visible cuando haya más de una serie. |
| Recalculo | Se actualiza al modificar filtros. |
| Sin datos | Muestra mensaje dentro del contenedor. |
| Error | Muestra mensaje recuperable. |
| Clic en gráfica | No abre detalle individual en esta versión. |
| Control | Parámetro API | SQL aplicado |
| --- | --- | --- |
| Texto libre | q | WHERE t_expedientes.uri_expediente LIKE '%:q%' OR t_expedientes.id_expediente LIKE '%:q%' OR (t_persona.st_nombre || ' ' || t_persona.st_apellidos) LIKE '%:q%' OR t_persona.co_identificacion LIKE '%:q%' |
| Estado | estado | WHERE t_expedientes.co_estado_funcional = :estado |
| Monoparental | monoparental | WHERE t_expedientes.bl_monoparental = :monoparental |
| Simplificada | simplificada | WHERE t_expedientes.co_modalidad_tramitacion = 'SIMPLIFICADA' |
| Urgencia | urgencia | WHERE t_expedientes.co_situacion_urgencia = 'true' |
| Tipo UC | tipoUC | WHERE t_expedientes.co_tipo_uc = :tipoUC |
| Con observaciones | conObs | WHERE EXISTS (SELECT 1 FROM t_observaciones WHERE t_observaciones.id_expediente = t_expedientes.id_expediente AND (t_observaciones.bl_resuelta IS NULL OR t_observaciones.bl_resuelta != 'true')) |
| Cuantía mínima | cuantiaMin | WHERE t_cuantias.nu_cuantia_final >= :cuantiaMin |
| Cuantía máxima | cuantiaMax | WHERE t_cuantias.nu_cuantia_final <= :cuantiaMax |
| Columna | Descripción | SQL / Fuente |
| --- | --- | --- |
| ID | Identificador interno | t_expedientes.id_expediente |
| URI | Referencia externa del expediente | t_expedientes.uri_expediente |
| Interesado | Nombre completo del solicitante | t_persona.st_nombre || ' ' || t_persona.st_apellidos |
| NIF | Documento de identidad | t_persona.co_identificacion |
| Estado | Badge de color por estado funcional | t_expedientes.co_estado_funcional |
| Tipo UC | Tipo de unidad de convivencia | t_expedientes.co_tipo_uc |
| Modalidad | Modalidad de tramitación | t_expedientes.co_modalidad_tramitacion |
| Urgencia | Badge URGENTE si urgencia activada | t_expedientes.co_situacion_urgencia = 'true' |
| Monoparental | Badge MONO si unidad monoparental | t_expedientes.bl_monoparental = 'true' |
| Obs. | Nº de observaciones pendientes (en rojo si > 0) | COUNT(t_observaciones) WHERE t_observaciones.bl_resuelta != 'true' |
| Cuantía | Cuantía final calculada (€) | t_cuantias.nu_cuantia_final |
| Creación | Fecha de entrada real del expediente | COALESCE(t_expedientes.fe_creacion_platino, t_expedientes.fe_creacion) |
| Campo mostrado | Columna en t_persona |
| --- | --- |
| Nombre | t_persona.st_nombre |
| Apellidos | t_persona.st_apellidos |
| Tipo de documento | t_persona.co_tipo_documento |
| País del documento | t_persona.pais_documento |
| Teléfono fijo | t_persona.st_telefono_fijo |
| Teléfono móvil | t_persona.st_telefono_movil |
| Correo electrónico | t_persona.st_correo_electronico |
| Fecha de nacimiento | t_persona.fe_nacimiento |
| Estado civil | t_persona.co_estado |
| Género | t_persona.co_genero |
| Nacionalidad | t_persona.co_nacionalidad |
| Campo mostrado | Fuente |
| --- | --- |
| Nombre y Apellidos | t_persona.st_nombre, t_persona.st_apellidos |
| Documento | t_persona.co_identificacion |
| Parentesco | t_uc.co_parentesco_declarado |
| Fecha de nacimiento | t_persona.fe_nacimiento |
| Organismo | Consulta | Campo |
| --- | --- | --- |
| DGP | Consulta de residencia legar de extranjeros por documentación. | co_DGP_identidad |
| INE | Consulta de datos de residencia con fecha de última variación para la supresión del volante de empadronamiento. | co_DGP_extranjeros |
| INE | Consulta del histórico de residencia y convivientes. | co_ine_residencia |
| SEPE | Consulta de Situación Actual de Desempleo. | co_sepe_situacion |
| SEPE | Importes de prestación de desempleo percibidos en un período. | co_sepe_importes |
| SEPE | Estar Inscrito como Demandante de Empleo a Fecha Concreta. | co_sepe_demandante |
| TGSS | Consulta de Estar Dado de Alta en Fecha concreta. | co_tgss_alta |
| TGSS | Consulta de vida laboral últimos 12 meses. | co_tgss_vida_laboral |
| Catastro | Consulta de datos catastrales. | co_catastro_datos |
| Catastro | Obtención de certificación de titularidad. | catastro_titularidad |
| INSS | Consulta de las prestaciones del registro de prestaciones sociales públicas, incapacidad temporal , maternidad y paternidad. | co_
inss_prestaciones |
| JUSTICIA | Consulta de defunción. | co_justicia_defuncion |
| JUSTICIA | Consulta de nacimiento. | co_justicia_nacimiento |
| RRCC Justicia | Consulta de matrimonio DICIREG. | co_rrcc_matrimonio |
| RRCC Justicia | Registro de parejas de hecho. | co_rrcc_parejas |
| DGT | Consulta de listado de vehículos. | co_dgt_listado |
| DGT | Consulta de datos de vehículos. | co_dgt_datos |
| Agencia Tributaria | Consulta sobre el impuesto de actividades económicas | co_iae |
| Agencia Tributaria | Consulta de impuestos sobre las personas físicas (IRPF) | co_irpf |
| Agencia Tributaria | Consulta de Rendimientos de trabajo | co_rendimientos |
| Agencia Tributaria | ECOT: Nivel de renta intermediado | co_ecot |
| Elemento | Fuente |
| --- | --- |
| Nombre del documento | t_uris.st_nombre_documento (lookup por t_documentos_asociados.st_uri) |
| Flecha ▶ / ▼ | Expandir / colapsar fragmentos |
| Contador | Nº de fragmentos del grupo |
| Botón Ver | Abre popup PDF del primer fragmento del grupo |
| Campo | Fuente |
| --- | --- |
| Tipo de documento | dim_tipo_documento.st_nombre (join por t_documentos_asociados.co_tipo_documento); si no existe, muestra el código numérico |
| Páginas | t_documentos_asociados.nu_pagina_inicio – t_documentos_asociados.nu_pagina_fin |
| Confianza | t_documentos_asociados.nu_confianza_clasificacion (%) |
| Método | Badge Regex (t_documentos_asociados.co_regex = 'true') o IA |
| Botón Ver | Abre popup PDF vía GET /api/documentos/:id_documento/url |
| Control | Parámetro API | SQL aplicado |
| --- | --- | --- |
| Fecha desde | desde | WHERE COALESCE(t_expedientes.fe_creacion_platino, t_expedientes.fe_creacion) >= :desde |
| Fecha hasta | hasta | WHERE COALESCE(t_expedientes.fe_creacion_platino, t_expedientes.fe_creacion) <= :hasta |
| Estado | estado | WHERE t_expedientes.co_estado_funcional IN (:estado1, :estado2, ...) (multi-selección, valores separados por coma) |
| Simplificada | simplificada | WHERE t_expedientes.co_modalidad_tramitacion = 'SIMPLIFICADA' |
| Urgencia | urgencia | WHERE t_expedientes.co_situacion_urgencia = 'true' |
| Monoparental | monoparental | WHERE t_expedientes.bl_monoparental = 'true' |
| Tarjeta | Descripción | SQL equivalente |
| --- | --- | --- |
| Total expedientes | Nº de expedientes que cumplen los filtros | SELECT COUNT(*) FROM t_expedientes WHERE ...filtros... |
| Docs / expediente | Media de documentos asociados por expediente | SELECT ROUND(COUNT(t_documentos_asociados.id_documento) * 1.0 / COUNT(DISTINCT t_expedientes.id_expediente), 2) FROM t_expedientes LEFT JOIN t_documentos_asociados ON t_documentos_asociados.id_expediente = t_expedientes.id_expediente WHERE ...filtros... |
| Consultas / expediente | Media de consultas externas por expediente | SELECT ROUND(COUNT(t_consultas_externas.id_consulta) * 1.0 / COUNT(DISTINCT t_expedientes.id_expediente), 2) FROM t_expedientes LEFT JOIN t_consultas_externas ON t_consultas_externas.id_expediente = t_expedientes.id_expediente WHERE ...filtros... |
| Tarjeta | Descripción | SQL equivalente |
| --- | --- | --- |
| Observaciones | Media de observaciones pendientes por expediente | SELECT ROUND(COUNT(t_observaciones.id_observacion) * 1.0 / COUNT(DISTINCT t_expedientes.id_expediente), 2) FROM t_expedientes LEFT JOIN t_observaciones ON t_observaciones.id_expediente = t_expedientes.id_expediente AND (t_observaciones.bl_resuelta IS NULL OR t_observaciones.bl_resuelta != 'true') AND (t_observaciones.fe_baja_logica IS NULL OR t_observaciones.fe_baja_logica = '') WHERE ...filtros... |
| Cuantía media (€) | Media de cuantías finales calculadas | SELECT ROUND(AVG(t_cuantias.nu_cuantia_final), 2) FROM t_cuantias WHERE (t_cuantias.fe_baja_logica IS NULL OR t_cuantias.fe_baja_logica = '') AND t_cuantias.nu_cuantia_final > 0 AND t_cuantias.id_expediente IN (SELECT id_expediente FROM t_expedientes WHERE ...filtros...) |
| Tarjeta | Descripción | SQL equivalente |
| --- | --- | --- |
| % Simplificada | Porcentaje de expedientes con modalidad simplificada | SELECT ROUND(100.0 * SUM(CASE WHEN t_expedientes.co_modalidad_tramitacion = 'SIMPLIFICADA' THEN 1 ELSE 0 END) / COUNT(*), 1) FROM t_expedientes WHERE ...filtros... |
| % Urgencia | Porcentaje de expedientes con situación de urgencia | SELECT ROUND(100.0 * SUM(CASE WHEN t_expedientes.co_situacion_urgencia = 'true' THEN 1 ELSE 0 END) / COUNT(*), 1) FROM t_expedientes WHERE ...filtros... |
| % Monoparental | Porcentaje de unidades monoparentales | SELECT ROUND(100.0 * SUM(CASE WHEN t_expedientes.bl_monoparental = 'true' THEN 1 ELSE 0 END) / COUNT(*), 1) FROM t_expedientes WHERE ...filtros... |
| Tarjeta | Descripción | SQL equivalente |
| --- | --- | --- |
| Media participantes | Media de miembros totales (adultos + menores) por expediente | SELECT ROUND(AVG(t_expedientes.nu_adultos + t_expedientes.nu_menores), 1) FROM t_expedientes WHERE ...filtros... |
| Media adultos | Media de adultos por expediente | SELECT ROUND(AVG(t_expedientes.nu_adultos), 1) FROM t_expedientes WHERE ...filtros... |
| Media menores | Media de menores por expediente | SELECT ROUND(AVG(t_expedientes.nu_menores), 1) FROM t_expedientes WHERE ...filtros... |
| Tramo | Criterio |
| --- | --- |
| Menos de 0 | t_cuantias.nu_cuantia_final < 0 |
| 0 — 500 | 0 <= t_cuantias.nu_cuantia_final < 500 |
| 500 — 1000 | 500 <= t_cuantias.nu_cuantia_final < 1000 |
| 1000+ | t_cuantias.nu_cuantia_final >= 1000 |
| Control | Parámetro API | SQL aplicado |
| --- | --- | --- |
| Fecha desde | desde | WHERE t_metricas.fe_creacion >= :desde |
| Fecha hasta | hasta | WHERE t_metricas.fe_creacion <= :hasta |
| Tarjeta | Descripción | SQL equivalente |
| --- | --- | --- |
| Expedientes | Expedientes distintos procesados en el periodo | SELECT COUNT(DISTINCT t_metricas.id_expediente) FROM t_metricas JOIN t_expedientes ON t_expedientes.id_expediente = t_metricas.id_expediente WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta |
| Documentos | URIs de documentos distintas en el periodo | SELECT COUNT(DISTINCT t_metricas.st_uri) FROM t_metricas JOIN t_expedientes ON t_expedientes.id_expediente = t_metricas.id_expediente WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta AND t_metricas.st_uri IS NOT NULL |
| Fragmentos | Fragmentos de documentos clasificados en el periodo | SELECT COUNT(DISTINCT t_metricas.id_documento) FROM t_metricas JOIN t_expedientes ON t_expedientes.id_expediente = t_metricas.id_expediente WHERE t_metricas.id_documento IS NOT NULL AND t_metricas.fe_creacion BETWEEN :desde AND :hasta |
| Tarjeta | Descripción | SQL equivalente |
| --- | --- | --- |
| Ejecuciones por Expediente | Media de ejecuciones de agente por expediente distinto | SELECT COUNT(*) * 1.0 / COUNT(DISTINCT t_metricas.id_expediente) FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta |
| Ejecuciones por Documento | Media de ejecuciones por documento (URI) distinto | SELECT COUNT(*) * 1.0 / COUNT(DISTINCT t_metricas.st_uri) FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta AND t_metricas.st_uri IS NOT NULL |
| Ejecuciones por Fragmento | Media de ejecuciones por fragmento distinto | SELECT COUNT(*) * 1.0 / COUNT(DISTINCT t_metricas.id_documento) FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta AND t_metricas.id_documento IS NOT NULL |
| Tarjeta | Descripción | SQL equivalente |
| --- | --- | --- |
| Tokens de Input | Total de tokens enviados al modelo en el periodo | SELECT SUM(t_metricas.nu_tokens_input) FROM t_metricas JOIN t_expedientes ON t_expedientes.id_expediente = t_metricas.id_expediente WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta |
| Tokens de Output | Total de tokens generados por el modelo en el periodo | SELECT SUM(t_metricas.nu_tokens_output) FROM t_metricas JOIN t_expedientes ON t_expedientes.id_expediente = t_metricas.id_expediente WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta |
| Tokens Totales | Suma de tokens input + output | SELECT SUM(t_metricas.nu_tokens_input + t_metricas.nu_tokens_output) FROM t_metricas JOIN t_expedientes ON t_expedientes.id_expediente = t_metricas.id_expediente WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta |
| Tarjeta | Descripción | SQL equivalente |
| --- | --- | --- |
| Tokens por Expediente | Media de tokens totales por expediente distinto | SELECT SUM(t_metricas.nu_tokens_input + t_metricas.nu_tokens_output) * 1.0 / COUNT(DISTINCT t_metricas.id_expediente) FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta |
| Tokens por Documento | Media de tokens totales por URI distinta | SELECT SUM(t_metricas.nu_tokens_input + t_metricas.nu_tokens_output) * 1.0 / COUNT(DISTINCT t_metricas.st_uri) FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta AND t_metricas.st_uri IS NOT NULL |
| Tokens por Fragmento | Media de tokens totales por fragmento distinto | SELECT SUM(t_metricas.nu_tokens_input + t_metricas.nu_tokens_output) * 1.0 / COUNT(DISTINCT t_metricas.id_documento) FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta AND t_metricas.id_documento IS NOT NULL |
| Serie | SQL equivalente |
| --- | --- |
| Expedientes | SELECT SUBSTR(t_metricas.fe_creacion,1,10) AS periodo, COUNT(DISTINCT t_metricas.id_expediente) AS v FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta GROUP BY periodo ORDER BY periodo |
| Documentos | SELECT SUBSTR(t_metricas.fe_creacion,1,10) AS periodo, COUNT(DISTINCT t_metricas.st_uri) AS v FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta AND t_metricas.st_uri IS NOT NULL GROUP BY periodo ORDER BY periodo |
| Fragmentos | SELECT SUBSTR(t_metricas.fe_creacion,1,10) AS periodo, COUNT(DISTINCT t_metricas.id_documento) AS v FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta AND t_metricas.id_documento IS NOT NULL GROUP BY periodo ORDER BY periodo |
| Serie | SQL equivalente |
| --- | --- |
| Input | SELECT SUBSTR(t_metricas.fe_creacion,1,10) AS periodo, SUM(t_metricas.nu_tokens_input) AS v FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta GROUP BY periodo ORDER BY periodo |
| Output | SELECT SUBSTR(t_metricas.fe_creacion,1,10) AS periodo, SUM(t_metricas.nu_tokens_output) AS v FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta GROUP BY periodo ORDER BY periodo |
| Total | SELECT SUBSTR(t_metricas.fe_creacion,1,10) AS periodo, SUM(t_metricas.nu_tokens_input + t_metricas.nu_tokens_output) AS v FROM t_metricas WHERE t_metricas.fe_creacion BETWEEN :desde AND :hasta GROUP BY periodo ORDER BY periodo |
| Segmento | Criterio |
| --- | --- |
| Expresiones Regulares | t_documentos_asociados.co_regex = 'true' |
| IA | t_documentos_asociados.co_regex != 'true' o sin registro en t_documentos_asociados |
| Columna | Descripción | SQL equivalente |
| --- | --- | --- |
| Agente | Nombre del agente | COALESCE(dim_agente.st_nombre, t_metricas.co_agente) |
| Descripción | Descripción del agente | dim_agente.st_descripcion |
| Ejecuciones | Nº de filas en t_metricas para este agente | COUNT(*) |
| Duración media | Media de nu_duracion_segundos, 3 decimales | ROUND(AVG(t_metricas.nu_duracion_segundos), 3) |
| Tokens input (media) | Media de tokens de input por ejecución | ROUND(AVG(t_metricas.nu_tokens_input)) |
| Tokens output (media) | Media de tokens de output por ejecución | ROUND(AVG(t_metricas.nu_tokens_output)) |