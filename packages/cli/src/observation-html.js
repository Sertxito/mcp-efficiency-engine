"use strict";

const { redact } = require("../../core/src/telemetry");
const { buildQualityGateReport, readWorkflowHistory } = require("../../validation-engine/src/quality-gates");
const { buildEvidenceLibrary } = require("./human-evidence");

function escape(value) {
  return String(value ?? "No disponible").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

const labels = {
  passed: "Correcto", failed: "Fallido", blocked: "Bloqueado",
  skipped: "No ejecutado", incomplete: "Incompleto",
  "configured-not-run": "Faltan resultados de checks declarados",
  "not-configured": "Sin checks configurados",
};

function status(value) {
  return `<strong>${escape(labels[value] || value)}</strong>`;
}

function duration(value) {
  return Number.isFinite(value) && value >= 0 ? `${(value / 1000).toFixed(2)} s` : "No disponible";
}

function details(title, value) {
  return `<details><summary>${escape(title)}</summary><pre>${escape(JSON.stringify(redact(value), null, 2))}</pre></details>`;
}

function checkEvidence(check) {
  const safe = redact(check);
  return `<details><summary>Que se comprobo: ${escape(safe.label || safe.id)}</summary>
    <p>Herramienta: ${escape(safe.tool)}. Directorio: ${escape(safe.cwd)}.
    Codigo de salida: ${escape(safe.exit_code)}. Tiempo limite: ${duration(safe.timeout_ms)}.</p>
    <p>${safe.status === "passed" ? "Este check termino correctamente. Revisa si su alcance es suficiente para tu validacion."
      : "No des este check por validado. Revisa el error o bloqueo y vuelve a ejecutarlo tras resolver la causa."}</p>
    <h4>Salida registrada (puede estar truncada)</h4><pre>${escape(safe.stdout_tail || "Sin salida registrada")}</pre>
    <h4>Errores o avisos registrados (pueden estar truncados)</h4><pre>${escape(safe.stderr_tail || "Sin texto de error registrado; esto por si solo no demuestra exito")}</pre>
    <p>Fuentes del check: ${escape(Array.isArray(safe.evidence) ? safe.evidence.join(", ") : null)}</p>
    ${details("Detalle tecnico del check", safe)}</details>`;
}

function eventExplanation(event) {
  const attributes = redact(event.attributes || {});
  const parts = [];
  if (attributes.agent) parts.push(`Agente seleccionado: ${attributes.agent}. Seleccion no significa ejecucion.`);
  if (attributes.workflow) parts.push(`Workflow seleccionado: ${attributes.workflow}.`);
  if (attributes.knowledge_candidates !== undefined) parts.push(`Candidatos de conocimiento: ${attributes.knowledge_candidates}; no demuestra que el modelo los haya leido.`);
  if (attributes.status) parts.push(`Estado registrado: ${labels[attributes.status] || attributes.status}.`);
  if (attributes.outcome) parts.push(`Resultado registrado: ${attributes.outcome}.`);
  if (attributes.decision) parts.push(`Decision registrada: ${attributes.decision}.`);
  if (attributes.exit_code !== undefined) parts.push(`Codigo de salida: ${attributes.exit_code ?? "no disponible"}.`);
  if (attributes.timed_out === true) parts.push("Se agoto el tiempo de espera.");
  if (Number.isFinite(attributes.duration_ms)) parts.push(`Tiempo: ${duration(attributes.duration_ms)}.`);
  return parts.length ? `<p>${escape(parts.join(" "))}</p>` : "";
}

function usageEvidence(entries, execution) {
  const calls = entries.filter(event => event.event_name === "copilot.sdk.assistant.usage");
  const windows = entries.filter(event => event.event_name === "copilot.sdk.session.usage_info");
  const metric = (events, key) => {
    const values = events.map(event => event.attributes?.[key]).filter(Number.isFinite);
    return values.length ? `${values.reduce((sum, value) => sum + value, 0).toLocaleString("es-ES")} (${values.length}/${events.length} registros)` : "No disponible";
  };
  const value = item => Number.isFinite(item) ? item.toLocaleString("es-ES") : "No disponible";
  const rows = calls.map((event, index) => `<tr><td>${index + 1}</td><td>${escape(event.timestamp)}</td><td>${escape(event.attributes?.model || "No disponible")}</td>
    ${["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost"].map(key => `<td>${value(event.attributes?.[key])}</td>`).join("")}</tr>`).join("");
  const current = windows.at(-1)?.attributes;
  const knownWindows = windows.map(event => event.attributes?.current_tokens).filter(Number.isFinite);
  return `<article><h3>Consumo de esta peticion</h3>
    <p>Llamadas con consumo observado: ${calls.length}. Entrada acumulada: <b>${metric(calls, "input_tokens")}</b>.
    Salida acumulada: <b>${metric(calls, "output_tokens")}</b>.</p>
    <p>Cache leida: ${metric(calls, "cache_read_tokens")}. Cache escrita: ${metric(calls, "cache_write_tokens")}.
    No se suman otra vez a los tokens de entrada: su relacion depende del proveedor.</p>
    <p>Suma del campo cost del SDK: ${metric(calls, "cost")}.
    El SDK lo documenta como multiplicador de solicitudes premium por llamada, no como tokens ni creditos de IA.
    <b>Gasto facturado no disponible; no equivale a euros o dolares.</b>
    Las entradas acumuladas repiten contexto entre llamadas; no son el tamano de una ventana ni una factura.</p>
    <p>Contexto recuperado: ${value(execution?.attributes?.context_bytes)} bytes; ${value(execution?.attributes?.context_estimated_tokens)} tokens estimados.
    Prompt MCPEE: ${value(execution?.attributes?.prompt_bytes)} bytes; ${value(execution?.attributes?.prompt_estimated_tokens)} tokens estimados.
    Estimacion por caracteres / 4, no tokenizador. No incluye necesariamente instrucciones adicionales del runtime.</p>
    <p>Ventana SDK, ultima observacion: ${value(current?.current_tokens)} / ${value(current?.token_limit)} tokens.
    Pico observado: ${value(knownWindows.length ? Math.max(...knownWindows) : null)}.
    Sistema: ${value(current?.system_tokens)}; conversacion: ${value(current?.conversation_tokens)}; definiciones de herramientas: ${value(current?.tool_definition_tokens)}.
    Ausencia de datos no significa cero. Los datos historicos redactados no se reconstruyen.</p>
    ${calls.length ? `<table><thead><tr><th>Llamada</th><th>Momento</th><th>Modelo</th><th>Entrada</th><th>Salida</th><th>Cache leida</th><th>Cache escrita</th><th>Multiplicador SDK (cost)</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No hay consumo emitido por el SDK para esta peticion.</p>"}</article>`;
}

function layerEvidence(entries, execution, route) {
  const layers = entries.filter(event => event.event_name === "context.layer.completed");
  const delivery = execution?.payload?.delivery;
  const selected = route?.payload?.selected;
  const list = value => Array.isArray(value) ? value.length ? value.map(item => typeof item === "string" ? item : JSON.stringify(item)).join(", ") : "Ninguno" : "No registrado";
  const loaded = entries.filter(event => event.event_name === "copilot.sdk.session.skills_loaded")
    .flatMap(event => event.payload?.data?.skills || []).map(skill => skill.name).filter(Boolean);
  const skillCalls = entries.filter(event => event.event_name === "copilot.tool.requested" &&
    event.tool_name === "skill").map(event => event.payload?.input?.toolArgs?.skill).filter(Boolean);
  const invokedSkills = entries.filter(event => event.event_name === "copilot.sdk.skill.invoked")
    .map(event => event.attributes?.skill_name || event.payload?.data?.name).filter(Boolean);
  const subagents = entries.filter(event => /^copilot\.sdk\.subagent\.(started|completed|failed)$/.test(event.event_name));
  return `<article><h3>Capas: consultadas, seleccionadas y enviadas</h3>
    <p>Agente seleccionado: ${escape(selected?.agent_id)}. Agente incluido como guia en el prompt: ${escape(delivery?.agent_id)}.
    No demuestra un subagente ejecutado de forma independiente.</p>
    <p>Skills seleccionadas: ${escape(list(selected?.skill_ids))}. Skills incluidas en el prompt: ${escape(list(delivery?.skill_ids))}.
    Solicitudes a la herramienta skill: ${escape(skillCalls.length ? list(skillCalls) : "Ninguna registrada")}.
    Skills invocadas segun el SDK: ${escape(invokedSkills.length ? list(invokedSkills) : "Ninguna registrada; no prueba ausencia de uso interno")}.</p>
    <details><summary>Skills descubiertas por el runtime: ${loaded.length || "Sin registro"}. Disponibles no significa invocadas.</summary>
    <p>${escape(loaded.length ? list(loaded) : "No registrado")}</p></details>
    <p>Subagentes: ${subagents.length ? "actividad observada por el SDK (no inferida de la seleccion)." : "sin actividad registrada; la guia de agente seleccionada no acredita delegacion."}</p>
    ${subagents.length ? `<ol>${subagents.map(event => `<li>${escape(event.timestamp)} · ${escape(event.payload?.data?.agentName || event.attributes?.agent)} ·
      ${escape(event.event_name)} · ${event.payload?.data?.cancelled === true ? "Cancelado" : escape(event.attributes?.outcome || "Estado SDK registrado")} · ${duration(event.attributes?.duration_ms)}</li>`).join("")}</ol>` : ""}
    <p>Memorias seleccionadas: ${escape(list(selected?.memory_ids))}. Memorias incluidas en el prompt: ${escape(list(delivery?.memory_ids))}.
    Conocimiento incluido: ${escape(list(delivery?.knowledge_sources))}. Fuentes de grafos incluidas: ${escape(list(delivery?.graph_sources))}.
    Fuentes grounded incluidas: ${escape(list(delivery?.grounded_sources))}.</p>
    <p>Incluir una memoria o una fuente en el prompt no prueba influencia causal en la respuesta.</p>
    ${layers.length ? `<table><thead><tr><th>Capa</th><th>Consulta</th><th>Resultado y seleccion</th><th>Tiempo</th></tr></thead><tbody>${layers.map(event => {
      const a = event.attributes || {};
      return `<tr><td>${escape(a.layer)}</td><td>${a.consulted === true ? "Consultada" : a.consulted === false ? "No consultada" : "Operacion registrada"}</td>
      <td>${escape(a.outcome)} · candidatos: ${escape(a.candidate_count)} · seleccionados: ${escape(a.selected_count)}
      · obsoletos excluidos: ${escape(a.excluded_stale_count)} · recuperacion: ${escape(a.retrieval || "No aplica")}
      ${a.layer === "knowledge.grounding" ? `<br>Busqueda vectorial ejecutada: ${a.vector_search_performed === true ? "Si" : a.vector_search_performed === false ? "No" : "No registrado"}.
      Perfil: ${escape(a.embedding_profile)}. Fragmentos vectoriales seleccionados: ${escape(a.selected_vector_count)}.
      Fragmentos lexicos seleccionados: ${escape(a.selected_lexical_count)}. Fallback: ${escape(a.fallback_reason || "Ninguno registrado")}.
      Contexto: ${escape(a.estimated_tokens)} tokens estimados / ${escape(a.max_tokens)} de presupuesto.` : ""}
      ${a.reason ? `<br>${escape(a.reason)}` : ""}</td><td>${duration(a.duration_ms)}</td></tr>`;
    }).join("")}</tbody></table>` : "<p>No hay eventos de consulta de capas en este historial: instrumentacion anterior. No se inventan consultas a partir de una seleccion.</p>"}</article>`;
}

function requestJourney(id, entries, open) {
  const ordered = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const find = (name) => ordered.find(event => event.event_name === name);
  const last = (name) => ordered.findLast(event => event.event_name === name);
  const received = find("mcp.tool.started");
  const route = find("routing.plan.created");
  const execution = find("copilot.execution.started");
  const prompt = find("copilot.prompt.sent");
  const response = last("copilot.response.received");
  const completed = last("mcp.tool.completed") || last("copilot.execution.completed");
  const task = received?.payload?.task || execution?.payload?.task || route?.payload?.task;
  const context = execution?.payload?.context;
  const tools = ordered.filter(event => event.event_name === "copilot.tool.requested");
  const text = value => `<pre>${escape(typeof value === "string" ? redact(value) : JSON.stringify(redact(value), null, 2))}</pre>`;
  const missing = "<p><strong>No verificable: no hay evidencia registrada de este paso.</strong></p>";
  const outcome = completed?.attributes?.outcome;
  const resultLabel = outcome === "success" && response
    ? "Respuesta registrada; calidad no evaluada"
    : outcome === "failure" ? "Ejecucion fallida" : "Resultado final no verificable";
  return `<details${open ? " open" : ""}><summary>${escape(ordered[0]?.timestamp)} · ${escape(String(task || "Peticion no registrada").slice(0, 160))} · ${resultLabel}</summary>
    <p>Traza: ${escape(id)}. ${entries.length} eventos. Desde ${escape(ordered[0]?.timestamp)} hasta ${escape(ordered.at(-1)?.timestamp)}.</p>
    <h3>1. Peticion recibida por MCPEE</h3>${task ? text(task) : missing}
    <p>No captura lo ocurrido en el chat antes de invocar MCP ni demuestra que el chat haya mostrado la respuesta.</p>
    ${usageEvidence(ordered, execution)}
    ${layerEvidence(ordered, execution, route)}
    <h3>2. Ruta seleccionada</h3>${route ? `<p>Workflow: ${escape(route.attributes?.workflow)}. Agente: ${escape(route.attributes?.agent)}. Seleccion no equivale a ejecucion independiente.</p>${details("Capacidades y conocimiento seleccionados", route.payload?.selected)}` : missing}
    <h3>3. Contexto y prompt enviados</h3>${execution ? `<p>Modo: ${escape(execution.attributes?.context_mode)}. Recuperacion: ${escape(execution.attributes?.context_retrieval)}.
    Fuentes: ${escape(execution.attributes?.context_source_count)}. Bytes: ${escape(execution.attributes?.context_bytes)}. Modelo solicitado: ${escape(execution.attributes?.model)}.</p>
    ${context?.files ? text(context.files) : "<p>Lista de fuentes no registrada.</p>"}
    <p>Hash del contexto: ${escape(context?.sha256)}. No demuestra que el modelo haya utilizado cada fuente.</p>` : missing}
    ${prompt?.payload?.prompt ? `<details><summary>Ver prompt completo registrado, incluido el contexto empaquetado</summary>${text(prompt.payload.prompt)}</details>` : missing}
    <h3>4. Aprobaciones y herramientas en orden</h3>
    <ol>${ordered.filter(event => /approval|authorization|permission\.decision/.test(event.event_name)).map(event =>
      `<li>${escape(event.timestamp)} · ${escape(event.event_name)} · ${escape(event.tool_name || "")}${eventExplanation(event)}</li>`).join("")}</ol>
    ${tools.length ? `<ol>${tools.map(event => {
      const result = event.tool_call_id
        ? ordered.find(item => item.event_name === "copilot.tool.completed" && item.tool_call_id === event.tool_call_id)
        : null;
      return `<li>${escape(event.timestamp)} · <b>${escape(event.tool_name)}</b> · ${escape(result?.attributes?.result || "Finalizacion no correlacionada")}
      ${text(event.payload?.input)}
      ${result?.payload?.result !== undefined ? `<details><summary>Resultado registrado de la herramienta</summary>${text(result.payload.result)}</details>` : "<p>Contenido devuelto no disponible en el hook; no se infiere.</p>"}</li>`;
    }).join("")}</ol>` : missing}
    <h3>5. Respuesta final registrada</h3>${response?.payload?.content ? text(response.payload.content) : missing}
    <h3>6. Que demuestra este recorrido</h3><p>${resultLabel}. Una finalizacion tecnica no certifica exactitud, suficiencia de tests ni cumplimiento funcional.</p>
    <p>Modelos observados: ${escape([...new Set(ordered.flatMap(event => event.attributes?.models || (event.attributes?.model ? [event.attributes.model] : [])))].join(", ") || "No disponible")}.</p>
    <details><summary>Eventos tecnicos del recorrido (sin razonamiento interno)</summary><ol>${ordered.filter(event => !/reasoning/.test(event.event_name)).map(event =>
      `<li>${escape(event.timestamp)} · ${escape(eventLabels[event.event_name] || event.event_name)}${eventExplanation(event)}</li>`).join("")}</ol></details>
    </details>`;
}

const eventLabels = {
  "routing.plan.created": "Seleccion de agentes, herramientas y conocimiento",
  "copilot.execution.started": "Inicio de ejecucion con el modelo",
  "copilot.execution.completed": "Resultado de ejecucion con el modelo",
  "copilot.data_transfer.approval": "Decision sobre envio de contexto",
  "action.approved": "Accion aprobada",
  "action.blocked": "Accion bloqueada",
  "tool.invocation.completed": "Resultado de herramienta local",
  "workflow.started": "Inicio de validacion",
  "workflow.completed": "Resultado de validacion",
  "documentation.generated": "Generacion de documentacion",
  "knowledge.sync.completed": "Sincronizacion del conocimiento",
  "knowledge.codegraph.completed": "Actualizacion del grafo de codigo",
  "knowledge.graphify.completed": "Actualizacion del grafo de conocimiento",
  "copilot.post_change_sync.completed": "Fin del ciclo posterior a cambios",
  "copilot.post_change_validation.completed": "Resultado del ciclo posterior a cambios",
  "mcp.tool.started": "Peticion recibida por MCP",
  "mcp.tool.completed": "Resultado de la peticion MCP",
};

function renderObservationHtml(root, report, events, extraReport = null) {
  const quality = buildQualityGateReport(root);
  const library = buildEvidenceLibrary(root, extraReport);
  const history = readWorkflowHistory(root);
  const latest = new Map();
  for (const run of history) if (!latest.has(run.workflow_id)) latest.set(run.workflow_id, run.id);
  const traces = new Map();
  for (const event of events) {
    const key = event.trace_id || event.session_id || "Sin correlacion";
    if (!traces.has(key)) traces.set(key, []);
    traces.get(key).push(event);
  }
  const workflows = history.map(run => `<details>
    <summary>${escape(run.workflow_id)} - ${status(run.status)} -
      ${latest.get(run.workflow_id) === run.id ? "ULTIMO RESULTADO REGISTRADO" : "INTENTO HISTORICO"} -
      ${escape(run.completed_at)}</summary>
    <article><h3>${escape(run.workflow_id)} - ${status(run.status)}</h3>
    <p>${latest.get(run.workflow_id) === run.id ? "ULTIMO RESULTADO REGISTRADO" : "INTENTO HISTORICO"} · ${escape(run.completed_at)}</p>
    ${typeof run.task === "string" && run.task.startsWith("Run detected local project validation checks for ")
      ? "<p class=\"notice\"><strong>Spec de checks comunes:</strong> ejecuta las comprobaciones de la tabla. El nombre del workflow NO demuestra que se haya ejecutado su procedimiento especializado, su agente, un despliegue o una revision de seguridad.</p>" : ""}
    <p>${escape(run.task)}</p><p>Evidencia: ${escape(run.report_path)}</p>
    <table><thead><tr><th>Comprobacion</th><th>Resultado</th><th>Herramienta</th><th>Tiempo</th></tr></thead>
    <tbody>${run.checks.map(check => `<tr><td>${escape(check.label || check.id)}</td><td>${status(check.status)}</td><td>${escape(check.tool)}</td><td>${duration(check.duration_ms)}</td></tr>`).join("")}</tbody></table>
    ${run.checks.map(checkEvidence).join("")}
    <p>Fuentes validadas: ${escape(Array.isArray(run.evidence) ? run.evidence.map(source =>
      typeof source === "string" ? source : source.path).join(", ") : null)}</p>
    ${details("Fuentes y hashes de esta validacion", run.evidence)}
  </article></details>`).join("");
  const technologyRows = quality.technologies.map(technology => `<article><h3>${escape(technology.name)}: ${status(technology.status)}</h3>
    <p>${technology.configured_check_count} checks declarados. Un check correcto no certifica toda la tecnologia.</p>
    <details><summary>Ver cada check declarado y lo que falta</summary><ul>${technology.checks.map(check => {
      const result = technology.latest_results.find(entry =>
        entry.workflow_id === check.workflow_id && entry.id === check.id);
      return `<li>${escape(check.label || check.id)} · ${escape(check.workflow_id)}:
        ${result ? status(result.status) : "<strong>No probado: sin resultado registrado</strong>"}
        ${result ? ` · ${escape(result.completed_at)} · Evidencia: ${escape(result.report)}` : ""}
        <br>Configuracion: ${escape(check.workflow_spec)}</li>`;
    }).join("")}</ul></details></article>`).join("");
  const hasRequest = entries => entries.some(event =>
    ["mcp.tool.started", "copilot.execution.started", "routing.plan.created"].includes(event.event_name));
  const journeys = [...traces].filter(([, entries]) => hasRequest(entries)).sort((a, b) =>
    String(b[1].at(-1)?.timestamp).localeCompare(String(a[1].at(-1)?.timestamp)))
    .map(([id, entries], index) => requestJourney(id, entries, index === 0)).join("");
  const usage = report.outcomes.model_usage;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>MCPEE - Visor humano de evidencias</title>
<style>body{font:17px/1.6 system-ui,sans-serif;background:#f3f5f8;color:#182332;margin:0}main{max-width:1100px;margin:auto;padding:28px}
h1,h2,h3{line-height:1.3}section,article{background:white;padding:22px;margin:18px 0;border:1px solid #cbd5e1;border-radius:10px}
.notice{border-left:6px solid #a65e00}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #cbd5e1}
summary{cursor:pointer;padding:10px;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;background:#eef2f6;padding:15px}
li{margin:15px 0}nav a{margin-right:20px;color:#124e85}small{color:#45566b}
dt{font-weight:600}dd{margin:0 0 10px 18px}.value{white-space:pre-wrap;overflow-wrap:anywhere}dd dl{border-left:2px solid #cbd5e1;padding-left:12px}</style></head>
<body><main><h1>MCPEE: evidencia para tu validacion</h1>
<p>Proyecto: ${escape(root)}<br>Instantanea generada: ${escape(report.generated_at)}</p>
<nav><a href="#recorridos">Peticiones y contexto</a><a href="#estado">Checks historicos</a><a href="#validaciones">Validaciones</a><a href="#biblioteca">Otras evidencias</a><a href="#lectura">Como leerlo</a></nav>
<section class="notice"><h2>Estado global del producto: no evaluado</h2><p>Los checks historicos no prueban el funcionamiento completo de los workflows ni la calidad de las respuestas. La traza de cada peticion se muestra por separado.</p><a href="#recorridos">Ir a la ultima peticion, su contexto y su respuesta</a></section>
<section id="recorridos"><h2>Por donde paso cada peticion</h2>
<p>Mas recientes primero. La ultima peticion esta desplegada. Solo mostramos evidencia registrada, no razonamiento interno ni actividad no observable.</p>
${journeys || "<p>No hay eventos registrados.</p>"}</section>
<section><h2>Actividad sin peticion correlacionada</h2><p>${[...traces.values()].filter(entries => !hasRequest(entries)).reduce((count, entries) => count + entries.length, 0)} eventos no se pueden atribuir aqui a una peticion con entrada registrada. No se mezclan con la ultima solicitud ni se presentan como un recorrido completo.</p>
<details><summary>Tipos de actividad sin entrada correlacionada</summary><ul>${[...new Set([...traces.values()].filter(entries => !hasRequest(entries)).flat().map(event => event.event_name).filter(name => !/reasoning/.test(name)))].map(name => `<li>${escape(eventLabels[name] || name)}</li>`).join("")}</ul></details></section>
<section id="estado" class="notice"><h2>Checks historicos declarados: ${quality.status === "passed" ? "<strong>Con resultados registrados correctos; vigencia y suficiencia no verificadas</strong>" : status(quality.status)}</h2>
<p>Esto NO es una aprobacion humana ni una certificacion de entrega. Es el estado de los resultados registrados para los checks declarados.</p>
<p>Fuera de este estado: calidad de respuestas, suficiencia de tests, infraestructura desplegada y actividad interna no observable del host.
Ejecuciones del modelo completadas en la telemetria disponible: ${report.outcomes.copilot.completed}.
No se deduce una ejecucion del modelo a partir de una prueba MCP o de un agente seleccionado.</p>
<p>Antes de validar: revisa alcance, fuentes, errores y checks pendientes. Un resultado historico correcto no demuestra que el codigo actual siga correcto: esta vista no vuelve a ejecutar tests ni verifica vigencia de hashes.</p>
${technologyRows || "<p>No hay tecnologias detectadas con cobertura evaluable.</p>"}</section>
<section><h2>Actividad observada, no estado actual</h2>
<p>${report.event_count} eventos durante la retencion de ${report.retention_days} dias; ${report.session_count} sesiones identificadas.</p>
<p>Herramientas locales: ${report.outcomes.local_tools.total} llamadas; ${report.outcomes.local_tools.failed} fallidas, de las cuales ${report.outcomes.local_tools.timed_out} agotaron el tiempo de espera.
Tiempo acumulado: ${duration(report.outcomes.local_tools.duration_ms_total)} (suma de llamadas, no duracion total del proyecto).</p>
<p>${usage.calls ? `${usage.calls} eventos de consumo emitidos por el SDK.` : "Sin eventos de consumo del modelo: no hay evidencia de tokens o coste en este historial."}
Entrada: ${escape(usage.input_tokens_total)} tokens. Salida: ${escape(usage.output_tokens_total)} tokens.
Suma del campo cost del SDK: ${escape(usage.cost_total)} (multiplicadores de solicitudes premium; gasto facturado no disponible).</p>
<p>Los fallos historicos se conservan. Un intento posterior correcto no prueba que todos los problemas anteriores esten resueltos.</p></section>
<section id="validaciones"><h2>Validaciones y sus intentos</h2>
<p>Orden: mas recientes primero. Cada workflow distingue su ultimo resultado de los intentos anteriores.</p>
<p>Valida lo que dicen los checks, no lo que sugiere el nombre del workflow. Un test unitario correcto no equivale a completar una tarea de negocio.</p>
${workflows || "<p>No hay informes de workflows. No probado, no aprobado.</p>"}</section>
<section id="lectura"><h2>Como decidir con esta evidencia</h2><ol>
<li>Comprueba que el workflow y sus checks cubren lo que necesitas validar. MCPEE no puede decidir su suficiencia por ti.</li>
<li>Lee el ultimo resultado, sus fuentes y la salida de cada check. Fallido o bloqueado requiere investigacion; no ejecutado significa que falta evidencia.</li>
<li>Revisa el recorrido para entender aprobaciones y herramientas. Si un paso no aparece, no lo des por probado.</li>
<li>Si el codigo o la configuracion cambiaron, vuelve a ejecutar la validacion y genera una nueva instantanea.</li>
</ol><p>No disponible / null = dato no observado. [REDACTED] = dato oculto, no cero. Correcto = check registrado correcto, no aprobacion global.</p>
<p>HTML autonomo: sin servidor, scripts, fuentes externas ni envio de datos. Contiene evidencia local redactada; puede contener informacion sensible del proyecto. No lo publiques sin revisarlo.</p>
${details("Resumen tecnico redactado", report)}</section>
<section id="biblioteca"><h2>Biblioteca de evidencias para personas</h2>
<p>Lectura comun para los informes JSON de MCPEE, con significado de campos, estados y limites.
Los campos desconocidos se indican como tecnicos: no inventamos una interpretacion.
Para buscar un nombre o identificador usa la busqueda de tu navegador (Ctrl+F).</p>
${library}</section>
</main></body></html>`;
}

module.exports = { renderObservationHtml };
