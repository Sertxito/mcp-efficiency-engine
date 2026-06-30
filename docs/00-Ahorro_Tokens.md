# Ahorro Tokens

> Extracción estructurada de la página de OneNote **Ahorro Tokens**, conservando el detalle textual de la página y de lo que aparecía renderizado dentro de las imágenes.

## Nota de uso en este repo

Este archivo es la base canonica del enfoque de ahorro de tokens en este repositorio.

Uso recomendado:

1. Leer secciones 1-4 para criterio operativo.
2. Aplicar secciones 5-10 en tareas reales de coding/routing.
3. Usar secciones 11-15 como checklist de decision y cierre.

---

# Índice

1. [Matriz de Selección de Modelos](#1-matriz-de-selección-de-modelos)
2. [Enrutamiento de Tareas / Workflow Routing](#2-enrutamiento-de-tareas--workflow-routing)
3. [Panel de Control de Contexto](#3-panel-de-control-de-contexto)
4. [Ley de Rendimientos Decrecientes / Effort Settings](#4-ley-de-rendimientos-decrecientes--effort-settings)
5. [Optimización de copilot-instructions.md](#5-optimización-de-copilot-instructionsmd)
6. [Prompting de Precisión: Evitando el Discovery](#6-prompting-de-precisión-evitando-el-discovery)
7. [Micro-Gestión del Agent Setup y Servidores MCP](#7-micro-gestión-del-agent-setup-y-servidores-mcp)
8. [Modo Caveman: Ultra-Compresión de Salida](#8-modo-caveman-ultra-compresión-de-salida)
9. [El Workflow Optimizado](#9-el-workflow-optimizado)
10. [Stack MCP / Herramientas de Contexto](#10-stack-mcp--herramientas-de-contexto)
11. [Matriz práctica para tipos de proyecto](#11-matriz-práctica-para-tipos-de-proyecto)
12. [Stack final recomendado](#12-stack-final-recomendado)
13. [Reglas anti-caos para agentes](#13-reglas-anti-caos-para-agentes)
14. [Decisión final sin palos de ciego](#14-decisión-final-sin-palos-de-ciego)
15. [Resumen ejecutivo condensado](#15-resumen-ejecutivo-condensado)

---

# 1. Matriz de Selección de Modelos

## Gama Económica

**Coste aproximado:** 40 créditos de entrada por 1M tokens.

**Ganadores:**

- Gemini 3 Flash.
- Claude Haiku 4.5.
- GPT-5 mini / GPT-5.4 mini.

**Uso ideal:**

- Autocompletado asistido.
- Snippets.
- Boilerplate.
- Dudas puntuales.

**Idea clave:**  
La gama económica debe usarse por defecto para tareas de bajo riesgo cognitivo, especialmente cuando el objetivo no es razonar profundamente sino asistir, completar, generar fragmentos pequeños o resolver dudas concretas.

---

## Gama Media

**Coste aproximado:** 125–300 créditos de entrada por 1M tokens.

**Ganadores:**

- Claude Sonnet 4.6 / 4.5.
- GPT-5.4.
- Gemini 2.5 / 3.1 Pro.
- GPT-5.3-Codex.

**Uso ideal:**

- Refactors multiarchivo.
- Tareas con razonamiento de código mecánico.
- Cambios con cierta coordinación entre piezas.
- Ejecución de tareas técnicas que requieren entender relaciones, pero no necesariamente tomar decisiones arquitectónicas críticas.

**Idea clave:**  
La gama media es el punto de equilibrio para el trabajo diario de desarrollo cuando hay que tocar varias piezas, razonar sobre código o ejecutar cambios con algo de contexto, pero sin quemar modelos premium.

---

## Gama Alta

**Coste aproximado:** 500+ créditos de entrada por 1M tokens.

**Ganadores:**

- Familia Opus, aproximadamente versiones 4.5 a 4.8.
- GPT-5.5.

**Uso ideal:**

- Diseño de arquitectura.
- Revisiones críticas.
- Decisiones técnicas con impacto alto.
- Evaluación de trade-offs.
- Planificación compleja antes de ejecutar.

**Idea clave:**  
La gama alta no debe usarse como piloto automático para todo. Tiene sentido cuando el coste de equivocarse es alto o cuando el razonamiento estratégico aporta valor real.

---

## Danger Zone

**Evitar:**

- Claude Opus 4.
- Modo Auto.
- Fast Mode.

**Motivos:**

- Coste computacional x6 frente al Opus normal.
- Lógica opaca.
- No compensa si no sabes exactamente por qué se está usando.
- Puede agotar la cuota en días.

**Idea clave:**  
El modo automático puede parecer cómodo, pero oculta decisiones de coste. Si el sistema escala esfuerzo o modelo sin control, el desarrollador pierde visibilidad y puede quemar créditos sin obtener una mejora proporcional.

---

# 2. Enrutamiento de Tareas / Workflow Routing

La página diferencia entre la intención real del desarrollador y el modo de trabajo que conviene activar.

## Intenciones típicas del desarrollador

### Dudas puntuales, explicaciones y snippets

Ejemplos:

- “¿Qué hace esta función?”
- “Explícame este error.”
- “Dame un snippet para validar este DTO.”
- “¿Cómo uso este operador?”

**Modo recomendado:** ASK MODE.  
**Táctica:** modelos económicos.  
**Coste:** bajo.

---

### Cambios masivos o arquitectura nueva

Ejemplos:

- “Quiero rediseñar este módulo.”
- “Necesito dividir este monolito en bounded contexts.”
- “Define un plan para migrar esta capa legacy.”
- “Diseña la arquitectura de esta solución.”

**Modo recomendado:** PLAN MODE.  
**Táctica:** usar gama alta para generar un plan detallado.  
**Después:** iterar o ejecutar con gama media.

---

### Refactor simple o tareas atómicas

Ejemplos:

- “Renombra esta clase y ajusta referencias.”
- “Extrae este método.”
- “Añade validación en este endpoint.”
- “Corrige este test.”

**Modo recomendado:** AGENT MODE.  
**Táctica:** gama media o económica.  
**Forma de trabajo:** ejecutar paso a paso.

---

## Regla importante del workflow

```text
[RULE] No generar boilerplate con el Agente si existen herramientas CLI que lo hacen automáticamente.
```

Ejemplo claro:

```bash
ng generate component features/orders/order-detail
```

Es mejor usar Angular CLI para crear estructura, ficheros y convenciones base que pedir al agente que genere manualmente boilerplate.

**Motivo:**

- La CLI es determinista.
- Respeta convenciones del framework.
- Reduce tokens.
- Evita errores tontos.
- El agente queda reservado para decisiones que sí requieren criterio.

---

# 3. Panel de Control de Contexto

La optimización de tokens depende de controlar qué contexto entra en cada interacción.

## 3.1 Micro-Sesiones / Reset

**Acción:**

- Reiniciar chats frecuentemente.
- Abrir un chat nuevo para cada problema específico.
- Evitar arrastrar historial si ya no aporta valor.

**Resultado:**

- Purga inmediata del historial acumulado.
- Menos contexto inútil reenviado.
- Menos coste por interacción.
- Menos riesgo de que el agente mezcle problemas anteriores.

**Regla práctica:**

```text
1 problema concreto = 1 sesión concreta.
```

---

## 3.2 Referencias Quirúrgicas / Targeting

La página muestra la idea de apuntar a ficheros concretos, por ejemplo:

```text
src/
components/
> src/
auth.py
__cst__.py
```

**Acción:**

- Usar referencias explícitas.
- Ejemplo:

```text
#auth.py
```

**Resultado:**

- Evita el uso indiscriminado de `@workspace`.
- Evita que el agente tenga que adivinar leyendo todo el repositorio.
- Reduce búsquedas innecesarias.
- Mejora la precisión.

**Idea clave:**  
No le digas al agente “mira todo”. Dile exactamente dónde mirar.

---

## 3.3 Archivo `.copilotignore` / Exclusion

La página muestra un ejemplo tipo:

```bash
cat .copilotignore

# Bloqueo de directorios muertos
node_modules/
dist/
build/
.git/
```

**Acción:**

- Configurar exclusiones estrictas.
- Bloquear directorios que no aportan al razonamiento.

**Resultado:**

- Bloquea lectura de directorios muertos.
- Evita reenvío inútil.
- Reduce contaminación contextual.
- Reduce coste.

**Directorios típicos a excluir:**

```gitignore
node_modules/
dist/
build/
.git/
coverage/
.tmp/
.cache/
out/
bin/
obj/
```

**Idea clave:**  
Si el agente puede leer basura, tarde o temprano leerá basura. Hay que limitarle el terreno de juego.

---

# 4. Ley de Rendimientos Decrecientes / Effort Settings

La página explica que un nivel de esfuerzo más alto no se traduce necesariamente en una mejora proporcional de calidad, e incluso puede degradarla.

## Curva de activación

Niveles representados:

- Low.
- Mid.
- High.
- X-High.
- Max.

Ejes conceptuales:

- Nivel de esfuerzo.
- Créditos.
- Tiempo.
- Calidad / rendimiento obtenido.

---

## Caso de estudio: Claude Opus 4.8

**Low → Mid → High:**

- Mejora clara.
- Mejora justificable en razonamiento.
- El incremento de coste puede tener sentido.

**X-High → Max:**

- La calidad se iguala o degrada.
- El gasto extra de créditos y tiempo se vuelve ineficiente.
- El retorno marginal baja muchísimo.

---

## Conclusión

```text
Más esfuerzo no siempre significa mejor resultado.
```

Para tareas diarias, subir esfuerzo sin criterio puede ser tirar créditos. Hay que usar esfuerzo alto solo cuando el tipo de problema lo justifique.

---

# 5. Optimización de copilot-instructions.md

## El impuesto oculto

La página indica que `copilot-instructions.md` se adjunta en cada interacción.

Eso significa que:

- Si es largo, cada prompt cuesta más.
- Si está mal escrito, genera respuestas malas.
- Si tiene reglas ambiguas, fuerza reintentos.
- Si parece una wiki, se convierte en lastre permanente.

---

## Problema: Bloated Wiki

Un fichero de instrucciones hinchado suele contener:

- Documentación genérica.
- Explicaciones largas.
- Principios vagos.
- Normas repetidas.
- Contexto histórico que no se necesita en cada interacción.

Ejemplo malo:

```text
Escribe código limpio.
```

Problema: no es accionable. Cada modelo puede interpretarlo de forma diferente.

---

## Solución: Lean Ruleset

Un `copilot-instructions.md` eficiente debe ser un conjunto reducido de reglas obligatorias.

Ejemplo bueno:

```text
Usa siempre ZonedDateTime en lugar de Date.
```

Mejor porque:

- Es concreto.
- Es verificable.
- Es accionable.
- No requiere interpretación subjetiva.

---

## Reglas de optimización

### 1. Brevedad extrema

Mantener idealmente por debajo de 30–40 líneas.

### 2. Reglas, no wiki

Debe ser un conjunto estricto de restricciones, no documentación genérica.

### 3. Especificidad accionable

Evitar frases vagas como:

```text
Escribe código limpio.
```

Usar reglas concretas como:

```text
Usa siempre ZonedDateTime en lugar de Date.
```

### 4. Estandarización global

Consolidar a nivel de proyecto:

```text
.github/copilot-instructions.md
```

Evitar variaciones locales que generen comportamientos diferentes entre carpetas, equipos o agentes.

---

# 6. Prompting de Precisión: Evitando el Discovery

La página explica que un prompt ambiguo delega la fase de descubrimiento al agente, multiplicando el uso de herramientas MCP, búsquedas y aclaraciones.

## Evitar: discovery abierto

Ejemplo a evitar:

```text
Revisa el repositorio y dime qué está mal.
```

**Problema:**

- Obliga al LLM a indexar.
- Obliga a buscar a ciegas.
- Dispara lectura de ficheros.
- Genera muchas llamadas a herramientas.
- Aumenta coste.
- Reduce precisión.

---

## Evitar: pedir al agente que ejecute comandos para descubrir información

Ejemplo a evitar:

```text
Ejecuta comandos en la terminal hasta encontrar el problema.
```

**Problema:**

- El agente consume turnos pensando qué comando ejecutar.
- Consume herramientas.
- Consume tokens interpretando outputs quizá irrelevantes.
- Puede repetir pasos.
- Puede explorar demasiado.

---

## Usar: prompt acotado con error concreto

Ejemplo recomendado:

```text
El test X falla con esta salida:
[error]
Arréglalo en auth.py.
```

**Ventaja:**

- Proporcionas la salida exacta.
- Acotas el fichero.
- Defines el objetivo.
- Reduces exploración.
- Aumentas probabilidad de solución directa.

---

## Usar: ejecutar tú el comando CLI

La página recomienda:

1. Ejecutar tú el comando CLI.
2. Usar herramientas como:
   - `grep`.
   - tests.
   - logs.
   - comandos del framework.
3. Copiar la salida.
4. Pasarla al agente para análisis directo.

Ejemplo:

```bash
npm test -- auth.service.spec.ts
```

Luego:

```text
Este test falla con esta salida exacta:
[paste del error]

Analiza solo auth.service.ts y auth.service.spec.ts.
Propón el cambio mínimo.
```

**Resultado:**

- Ahorra turnos de razonamiento.
- Evita discovery innecesario.
- Controla tokens.
- Aumenta trazabilidad.

---

# 7. Micro-Gestión del Agent Setup y Servidores MCP

## Problema principal

Cada herramienta inyecta su esquema en el prompt.

Eso implica un recargo fijo de tokens por cada paso, aunque la herramienta no se use.

La página contrasta dos enfoques:

- Agente genérico con muchas herramientas.
- Sniper Agent especializado.

---

## Agente genérico

Puede tener acceso a:

- Web.
- DB.
- Terminal.
- MCPs múltiples.
- Otras herramientas activas.

**Problema:**

- Carga de herramientas innecesaria.
- Inyección de esquemas masiva.
- Más coste base por interacción.
- Más opciones para equivocarse.
- Más tentación de hacer discovery.

---

## Sniper Agent

Ejemplo mostrado:

```text
@agente-testing
```

Características:

- Acceso restringido.
- Solo herramientas necesarias.
- Orientado a una tarea concreta.
- Por ejemplo: lectura + tests.

**Ventajas:**

- Acceso a herramienta de precisión.
- Inyección mínima.
- Menor coste.
- Mejor foco.

---

## Apagar herramientas nativas

**Acción:**

- Desactivar búsqueda web si la tarea no lo requiere.
- Desactivar acceso a bases de datos si no aplica.
- No cargar MCPs innecesarios.

**Idea clave:**

```text
Herramienta activa = coste potencial permanente.
```

---

## Agentes personalizados

Crear perfiles especializados con acceso limitado.

Ejemplos:

```text
@agente-testing
@agente-refactor
@agente-docs
@agente-sql-review
```

Cada uno debería tener solo las capacidades necesarias para su función.

---

## CLI > MCP

La página indica:

```text
CLI > MCP
```

Es decir, cuando sea posible, pedir usar comandos nativos como:

```bash
git status
git diff
gh pr view
npm test
dotnet test
```

En lugar de servidores MCP complejos.

**Motivo:**

- CLI suele ser más directa.
- Menos esquema inyectado.
- Menos abstracción.
- Más control.
- Más fácil copiar salida concreta al agente.

---

# 8. Modo Caveman: Ultra-Compresión de Salida

## La táctica

Comunicación sin relleno.

La página indica que reduce el consumo de tokens de salida aproximadamente en un 75%.

---

## Comparación

### Respuesta estándar

```text
¡Hola! Claro, te explico. Aquí tienes la solución a tu problema de DB...
```

### Caveman Ultra

```text
DB err -> fix -> [CODE]
```

---

## Niveles de compresión

### LITE

- Sin relleno.
- Mantiene oraciones completas.
- Mantiene artículos.
- Reduce cortesía y texto periférico.

Ejemplo:

```text
Error en DB por timeout. Sube timeout y revisa pool.
```

### FULL

- Cero artículos.
- Fragmentos breves.
- Acrónimos estándar.

Ejemplo:

```text
DB timeout -> revisar pool -> subir timeout -> validar retry.
```

### ULTRA

- Abreviaturas extremas.
- Cero conjunciones.
- Uso intensivo de flechas.

Ejemplo:

```text
DB timeout -> pool cfg -> timeout+retry -> test.
```

---

## Resultado medido

La página recoge una reducción comprobada:

```text
6.4 créditos -> 4.1 créditos por interacción
```

Manteniendo exactitud técnica total.

---

## Idea clave

No siempre quieres una explicación bonita. A veces quieres una respuesta operativa, directa y barata.

---

# 9. El Workflow Optimizado

La página resume el flujo ideal en cuatro piezas.

## 1. Modelo correcto

Seleccionar gama media o económica por defecto.

Solo subir a gama alta cuando:

- Hay arquitectura.
- Hay decisión crítica.
- Hay alto impacto.
- Hay riesgo alto.
- Necesitas evaluación de trade-offs.

---

## 2. Contexto acotado

Trabajar con:

- Micro-sesiones.
- `#files`.
- Referencias explícitas.
- Scope reducido.

---

## 3. Prompt quirúrgico

Proporcionar:

- Error exacto.
- Archivo exacto.
- Endpoint exacto.
- Clase exacta.
- Test exacto.
- Flujo exacto.

Evitar:

```text
Mira todo y dime qué ves.
```

---

## 4. Herramientas limitadas

Usar solo:

- CLI estrictamente necesaria.
- MCP estrictamente necesario.
- Herramienta concreta para la tarea.

No cargar todo “por si acaso”.

---

## Frase clave

```text
La optimización no es programar menos; es dar el contexto exacto.
```

---

# 10. Stack MCP / Herramientas de Contexto

La segunda parte de la página entra en herramientas concretas para optimizar contexto y reducir tokens en agentes.

---

## 10.1 Perfil DEV diario: optimizar tokens y cambios de código

### Opción recomendada: CodeGraph como fuente primaria

La página describe CodeGraph como una fuente primaria para desarrollo diario.

Según el contenido de la página:

- Crea un grafo local pre-indexado del código.
- Incluye símbolos, llamadas y dependencias.
- Lo expone por MCP.
- Mantiene auto-sync por cambios de fichero.
- Está orientado a dar “surgical context”.
- Evita búsquedas fichero a fichero.
- Es 100% local.
- Usa SQLite.
- No requiere API keys ni servicios externos.

### Cuándo usarlo

- Proyectos modernos Angular.
- Proyectos .NET.
- Node.
- Python.
- Refactors multi-fichero.
- Entender impacto de cambios.
- Evitar que el agente haga:

```text
grep -> glob -> read -> grep -> read -> read
```

hasta quemar tokens.

### Criterio

CodeGraph es el estándar diario cuando trabajas en un repo moderno y quieres contexto estructural vivo sin discovery excesivo.

---

## 10.2 Perfil LEGACY / migración / multi-repo

### Opción recomendada: GitNexus como fuente primaria

La página recomienda GitNexus cuando el problema sea legacy complejo o multi-repo.

Según el contenido de la página, GitNexus:

- Indexa cualquier codebase en un knowledge graph.
- Trabaja con dependencias.
- Trabaja con call chains.
- Trabaja con clusters.
- Trabaja con execution flows.
- Lo expone por MCP.
- Da awareness arquitectónico a agentes como:
  - Claude Code.
  - Cursor.
  - Codex.
  - Windsurf.
  - OpenCode.
- Tiene modo CLI + MCP para desarrollo diario.
- Tiene Web UI para exploración visual.
- Usa almacenamiento local con LadybugDB.
- Tiene privacidad local en modo CLI.

### Cuándo usarlo

- Migraciones legacy.
- Sistemas con varios repositorios.
- Sistemas con varios servicios.
- Análisis de impacto antes de tocar algo.
- Generar wiki técnica viva.
- Revisiones de PR con blast radius si se usa enterprise/self-hosted.

### Criterio

Si es un ecosistema legacy o multi-repo con mucha dependencia cruzada, GitNexus tiene más sentido que CodeGraph.

---

## 10.3 Perfil DBA / RAG / documentación / conocimiento multimodal

### Opción recomendada: Graphify bajo demanda

La página recomienda Graphify bajo demanda, no como herramienta siempre activa.

Según el contenido de la página, Graphify:

- Convierte carpetas de código en knowledge graph.
- Convierte SQL schemas.
- Convierte scripts.
- Convierte documentación.
- Convierte papers.
- Convierte imágenes.
- Convierte vídeos.
- Genera:
  - `graph.html`.
  - `GRAPH_REPORT.md`.
  - `graph.json`.
- Permite consultar el grafo sin releer todo el repositorio.
- Lista extras para:
  - SQL schema extraction.
  - PostgreSQL introspection.
  - PDF.
  - Office.
  - Vídeo.
  - Terraform.

### Dónde encaja perfecto

#### DBA

- SQL schemas.
- PostgreSQL introspection.
- Relaciones entre bases de datos.
- Procedimientos.
- Documentación técnica.

#### RAG

- Construir corpus estructurado desde:
  - Código.
  - Docs.
  - PDFs.
  - Imágenes.

#### Community manager / formación

- Convertir documentación.
- Guiones.
- Materiales.
- Transcripts.
- Assets.
- Todo en un grafo de conocimiento.

#### Legacy discovery

- Sacar un `GRAPH_REPORT.md` explicativo para humanos antes de meter mano.

### Advertencia

No dejarlo siempre activo junto a CodeGraph o GitNexus.

Mejor usarlo como:

- Proceso de análisis.
- Proceso de documentación.
- Generador de conocimiento.
- Fuente para alimentar instrucciones o contexto resumido.

---

## 10.4 Perfil snapshot barato para pasar contexto a un LLM

### Opción recomendada: Repomix bajo demanda

La página define Repomix como una herramienta para empaquetar un repositorio completo en un único archivo AI-friendly.

Según el contenido de la página, Repomix:

- Empaqueta un repositorio completo en un único archivo.
- Está pensado para LLMs como:
  - Claude.
  - ChatGPT.
  - Gemini.
- Soporta conteo de tokens.
- Respeta `.gitignore`.
- Incorpora Secretlint para evitar incluir información sensible.
- Tiene compresión basada en Tree-sitter.
- Extrae firmas y estructura.
- Reduce uso de tokens.
- Su propia página habla de “Code Compression” con reducción aproximada del 70% de tokens.

### Dónde usarlo

- Llevar contexto a un chat que no tiene MCP.
- Auditoría rápida.
- Compartir estado de repo.
- Generar documentación.
- Preparar prompts de formación o análisis.

### Advertencia

No usarlo como sustituto del grafo activo si estás trabajando con un agente dentro del repo.

Repomix es más:

```text
paquete de contexto
```

que:

```text
motor vivo de navegación
```

---

## 10.5 Perfil enterprise / context-as-a-service

### Opción: Augment Context Engine

La página lo recomienda con cuidado en:

- Coste.
- Datos.
- Modelo operativo.

Según el contenido de la página, Augment Context Engine MCP:

- Mantiene entendimiento semántico del stack.
- Entiende relaciones entre repos.
- Entiende servicios y arquitecturas.
- Considera historial de commits.
- Considera patrones de codebase.
- Puede incorporar fuentes externas como:
  - Docs.
  - Tickets.
  - Tribal knowledge.
- Recupera solo lo relevante.
- Comprime contexto sin perder información.
- Diferencia entre:
  - Servidor local para desarrollo activo.
  - Servidor remoto para entender/agregar codebases.
  - Cross-repo context.
  - Entornos CI/server sin working tree local.

La página también recoge que las consultas MCP se facturan con token-based pricing:

- Tokens del proveedor.
- Más un 40% de service fee.
- Media orientativa de 0,03–0,06 por query según experiencia indicada en esa fuente.

### Cuándo tiene sentido

- Contexto cross-repo serio.
- Entren docs/tickets/conocimiento externo.
- El equipo puede asumir:
  - SaaS.
  - Enterprise.
  - Seguridad.
  - Coste.
- Importa más la calidad contextual gestionada que mantener tú el stack local.

### Criterio

Para experimentos personales, formación y proyectos técnicos: empezar local con CodeGraph/GitNexus.

Para equipo o cliente grande con compliance y varios repos: evaluar Augment Context Engine.

---

# 11. Matriz práctica para tipos de proyecto

| Caso | Primario | Secundario bajo demanda | Qué NO haría |
|---|---|---|---|
| Proyecto moderno Angular/.NET/API | CodeGraph | Repomix para snapshot | CodeGraph + GitNexus activos a la vez |
| Legacy migration | GitNexus | Graphify para informe/documentación | Meter 4 MCPs de contexto en el agente |
| DBA / SQL / procedimientos | Graphify | Repomix para empaquetar docs/code | Pedir al agente que descubra a ciegas toda la BBDD |
| RAG / knowledge base | Graphify | Augment Context Engine si necesitas enterprise/cross-source | Usar solo grep/vector chunks sin estructura |
| IoT / varios servicios | GitNexus si hay multi-repo; CodeGraph si es repo único | Graphify para docs/diagramas | Duplicar motores de grafo |
| Community manager / contenidos / docs | Graphify | Repomix si quieres bundle textual | Usar herramientas de code graph para contenido puro |
| Formación / storytelling técnico | Graphify | CodeGraph para demos de impacto real en código | Sobrecargar la demo con demasiadas tools |

---

# 12. Stack final recomendado

## Base instalada, pero no todo activo

La página propone tener instalado:

### CodeGraph

Para:

- Desarrollo local.
- Refactor.
- Impacto.
- Reducción de exploración.

### GitNexus

Para:

- Legacy.
- Multi-repo.
- Análisis arquitectónico profundo.
- Escenarios tipo migración.

### Graphify

Para:

- DBA.
- RAG.
- Documentación.
- SQL schemas.
- PDFs.
- Imágenes.
- Vídeos.
- Informes.
- Knowledge graph multimodal.

### Repomix

Para:

- Snapshots controlados.
- Paquetes de contexto.
- Token counting.
- Compresión puntual.

### Aider

Solo si se va a trabajar específicamente con Aider.

---

## Activo por sesión

La idea central es no tener todo activo a la vez.

### DEV moderno

```text
Activo: CodeGraph
Bajo demanda: Repomix
```

### LEGACY / multi-repo

```text
Activo: GitNexus
Bajo demanda: Graphify
```

### DBA / RAG / docs

```text
Activo: Graphify
Bajo demanda: Repomix
```

### Enterprise cross-repo gestionado

```text
Activo: Augment Context Engine
Bajo demanda: Graphify / Repomix según caso
```

---

# 13. Reglas anti-caos para agentes

## Regla 1

Solo un motor de contexto estructural activo:

```text
CodeGraph OR GitNexus OR Augment
```

No varios a la vez haciendo el mismo papel.

---

## Regla 2

Graphify no es el motor diario salvo que la tarea sea:

- Multimodal.
- Documentación.
- RAG.
- Análisis de conocimiento.

Se ejecuta para generar:

- Conocimiento.
- Informes.
- `graph.json`.
- Material procesado.

---

## Regla 3

Repomix no está siempre activo.

Se usa para crear snapshots empaquetados.

---

## Regla 4

Si el agente empieza a hacer discovery largo, paras y acotas.

Acotar con:

- Archivo.
- Error.
- Stacktrace.
- Clase.
- Endpoint.
- Tabla.
- Flujo.

---

## Regla 5

Prohibido:

```text
Revisa todo el repo y dime qué está mal.
```

Eso es exactamente el patrón a evitar.

---

# 14. Decisión final sin palos de ciego

## Estrategia ganadora para optimizar agentes y ahorrar tokens

### Para DEV diario

```text
Empieza con CodeGraph como estándar diario.
```

Motivos recogidos en la página:

- Local.
- Auto-sync.
- MCP.
- Orientado a reducir exploración.
- Reduce file reads.
- Pensado para agentes de coding.

---

### Para legacy serio o multi-repo

```text
Usa GitNexus en vez de CodeGraph, no además.
```

Motivos:

- CLI + MCP.
- Web UI.
- Graph.
- Execution flows.
- Multi-repo groups.
- Soporte para escenarios enterprise/self-hosted.

---

### Para DBA / RAG / docs / contenido

```text
Usa Graphify como pipeline de conocimiento.
```

Motivos:

- Código.
- SQL schemas.
- Docs.
- PDFs.
- Imágenes.
- Vídeo.
- Office.
- Graph report.
- Graph query.

---

### Para paquetes de contexto puntuales

```text
Usa Repomix.
```

Motivos:

- Export controlado.
- Token counting.
- Respeta `.gitignore`.
- Secretlint.
- Compresión.

No debe ser el cerebro del agente, sino un paquete de contexto.

---

# 15. Resumen ejecutivo condensado

## Principio central

```text
Optimizar tokens no es usar menos IA.
Optimizar tokens es usar la IA con mejor contexto, mejor modelo y menos ruido.
```

---

## Lo que hay que reducir

- Contexto innecesario.
- Herramientas activas por defecto.
- Discovery ambiguo.
- Historial de chats largo.
- Carpetas muertas.
- Instrucciones globales hinchadas.
- Salidas demasiado verbosas.

---

## Lo que hay que controlar

- Modelo.
- Nivel de esfuerzo.
- Scope de la tarea.
- Ficheros referenciados.
- Herramientas permitidas.
- Formato de salida.
- Prompt inicial.

---

## Lo que hay que evitar

```text
Modo Auto sin control.
Agentes genéricos con demasiadas herramientas.
Discovery a ciegas.
@workspace indiscriminado.
Copilot instructions tipo wiki.
Usar gama alta para tareas simples.
Pedir boilerplate que ya genera la CLI.
```

---

## Workflow mental recomendado

Antes de pedir nada al agente, preguntarse:

1. ¿Qué quiero exactamente?
2. ¿Qué fichero o pieza concreta afecta?
3. ¿Qué error o input exacto tengo?
4. ¿Qué herramienta necesita realmente?
5. ¿Qué modelo es suficiente?
6. ¿Necesito plan o ejecución?
7. ¿Puedo generar boilerplate con CLI?
8. ¿Estoy arrastrando contexto viejo?

---

## Regla final

```text
Contexto exacto + modelo suficiente + herramientas mínimas = menos tokens y mejor resultado.
```

---

# Apéndice A — Plantillas de prompts alineadas con la página

## Prompt para bug concreto

```text
El test [NOMBRE_TEST] falla con esta salida:

[PEGAR_ERROR]

Scope:
- Archivo principal: [archivo]
- Test: [archivo_test]

Objetivo:
- Corrige el fallo con el cambio mínimo.
- No refactorices fuera de scope.
- Devuelve diff y explicación breve.
```

---

## Prompt para refactor multiarchivo

```text
Necesito refactorizar [componente/flujo] con este objetivo:

[OBJETIVO]

Scope permitido:
- [archivo_1]
- [archivo_2]
- [archivo_3]

Restricciones:
- No cambiar contratos públicos salvo que sea imprescindible.
- Mantener compatibilidad con tests existentes.
- Proponer plan antes de tocar código.

Salida esperada:
1. Plan breve.
2. Riesgos.
3. Cambios por archivo.
4. Diff sugerido.
```

---

## Prompt para arquitectura

```text
Quiero decidir la arquitectura para [caso].

Contexto:
- Sistema actual: [resumen]
- Restricciones: [restricciones]
- Objetivo: [objetivo]
- Volumen/riesgo: [datos]

Necesito:
- 3 alternativas.
- Trade-offs.
- Recomendación final.
- Riesgos.
- Primeros pasos de implementación.

No generes código todavía.
```

---

## Prompt modo Caveman

```text
Modo CAVEMAN FULL.
Sin relleno.
Respuesta breve.
Usa flechas, bullets y código solo si hace falta.
```

---

# Apéndice B — Checklist operativo de ahorro de tokens

## Antes de abrir el agente

- [ ] ¿Estoy en un chat limpio?
- [ ] ¿Tengo el error exacto?
- [ ] ¿Sé qué fichero toca?
- [ ] ¿Puedo generar boilerplate por CLI?
- [ ] ¿He excluido carpetas muertas?
- [ ] ¿Necesito realmente MCP activo?
- [ ] ¿Necesito realmente búsqueda web?
- [ ] ¿Necesito modelo alto o basta gama media/económica?

## Durante la interacción

- [ ] ¿El agente empieza a explorar demasiado?
- [ ] ¿Está leyendo ficheros irrelevantes?
- [ ] ¿Está usando herramientas no necesarias?
- [ ] ¿La salida es demasiado larga?
- [ ] ¿Conviene parar y acotar?

## Después

- [ ] ¿Puedo convertir lo aprendido en regla corta?
- [ ] ¿La regla merece entrar en `copilot-instructions.md`?
- [ ] ¿Es una regla o documentación genérica?
- [ ] ¿Estoy manteniendo el fichero por debajo de 30–40 líneas?

---

# Apéndice C — `.copilotignore` base recomendado

```gitignore
# Dependencias
node_modules/

# Builds / outputs
dist/
build/
out/
bin/
obj/
coverage/

# Git
.git/

# Cachés
.cache/
.tmp/

# Logs
*.log

# Secretos locales
.env
.env.*
```

---

# Apéndice D — `copilot-instructions.md` lean de ejemplo

```md
# Copilot Instructions

- Responde en español de España salvo que se indique otra cosa.
- Prioriza cambios mínimos y seguros.
- No refactorices fuera del scope pedido.
- Si falta contexto, pide solo el dato mínimo imprescindible.
- Usa patrones existentes del repositorio antes de introducir nuevos.
- En Java, usa ZonedDateTime en lugar de Date.
- En Angular, usa standalone components y signals; evita NgModules.
- No generes boilerplate si existe CLI oficial para ello.
- Devuelve diffs o bloques de código completos cuando propongas cambios.
- Explica trade-offs solo cuando haya más de una solución razonable.
```

---

# Apéndice E — Decisión rápida de modelo

| Tarea | Modelo recomendado | Motivo |
|---|---|---|
| Snippet simple | Económico | Bajo razonamiento |
| Duda puntual | Económico | Respuesta corta |
| Boilerplate | CLI, no agente | Determinista y barato |
| Refactor pequeño | Medio/económico | Scope controlado |
| Refactor multiarchivo | Medio | Necesita coordinación |
| Plan arquitectónico | Alto | Decisión crítica |
| Revisión crítica | Alto | Alto impacto |
| Ejecución paso a paso | Medio/económico | No quemar premium |
| Legacy multi-repo | Medio/alto + GitNexus | Contexto complejo |
| RAG/docs multimodal | Graphify bajo demanda | Conocimiento estructurado |

---

# Apéndice F — Regla de oro para sesiones de desarrollo

```text
Si el agente necesita descubrir demasiado, el prompt está mal planteado.
```

Reformular así:

```text
Aquí está el error.
Aquí está el archivo.
Aquí está el objetivo.
Aquí están las restricciones.
Haz el cambio mínimo.
```

---

# Fin del documento
