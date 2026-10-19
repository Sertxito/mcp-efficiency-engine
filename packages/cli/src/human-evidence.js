"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readProjectJson, listJsonFiles } = require("../../validation-engine/src/quality-gates");
const { capabilityRegistry } = require("../../copilot-renderer/src/render");
const { listMemory } = require("../../memory-engine/src/memory");
const { listTasks } = require("../../core/src/tasks");
const { listLearning } = require("../../learning-engine/src/learning");
const { redact } = require("../../core/src/telemetry");

const FIELD_LABELS = {
  status: "Estado registrado", id: "Identificador", name: "Nombre", label: "Comprobacion",
  task: "Objetivo", workflow_id: "Procedimiento", agent_id: "Agente", session_id: "Sesion",
  trace_id: "Recorrido correlacionado", generated_by: "Generado por", schema_version: "Version del formato",
  completed_at: "Fin registrado", started_at: "Inicio registrado", generated_at: "Fecha de la instantanea",
  created_at: "Fecha de creacion", timestamp: "Fecha del evento", stages: "Etapas del ciclo",
  checks: "Comprobaciones", results: "Resultados", runs: "Ejecuciones", evidence: "Fuentes de evidencia",
  sources: "Fuentes", path: "Ruta", report: "Informe de evidencia", sha256: "Huella del contenido (SHA-256)",
  reason: "Motivo", error: "Error", diagnostic: "Diagnostico", limitations: "Limites de esta evidencia",
  duration_ms: "Tiempo de ejecucion", exit_code: "Codigo de salida", tool: "Herramienta",
  tools: "Herramientas", args: "Argumentos", cwd: "Directorio de trabajo", timeout_ms: "Tiempo limite",
  stdout_tail: "Ultima parte de la salida", stderr_tail: "Ultima parte de errores o avisos",
  available: "Disponible", invokable: "Se puede ejecutar", version: "Version", type: "Tipo",
  decision: "Decision", action: "Accion", text: "Contenido", kind: "Clase de registro",
  approval: "Aprobacion registrada", proposal_ids: "Propuestas pendientes de decision",
  proposal_id: "Propuesta", task_id: "Tarea", evaluation_id: "Validacion de referencia",
  human_scorecard: "Scorecard humano", literal_assertions: "Comprobaciones literales",
  score: "Puntuacion registrada", outcome: "Resultado", findings: "Hallazgos",
  model_execution: "Se ejecuto un modelo", mode: "Modo de prueba", scope: "Alcance",
  validation: "Validacion", documentation: "Documentacion", refreshed: "Actualizada",
  input_tokens: "Tokens de entrada", output_tokens: "Tokens de salida", cost: "Coste registrado",
  pending: "Pendientes", installed: "Instalados", missing: "Ausentes",
  knowledge_candidates: "Fuentes candidatas (no demuestra lectura)", changed_paths: "Rutas modificadas",
  impact_preflight: "Analisis previo del impacto", targets: "Objetivos del analisis",
  check_count: "Numero de comprobaciones", passed_checks: "Comprobaciones correctas",
  failed_checks: "Comprobaciones fallidas", blocked_checks: "Comprobaciones bloqueadas",
  failed: "Fallidos", passed: "Correctos", total: "Total", event_count: "Numero de eventos",
  events: "Eventos", attributes: "Datos del evento", event_name: "Tipo de evento",
};

const STATUS_LABELS = {
  passed: "Correcto", failed: "Fallido", blocked: "Bloqueado", skipped: "No ejecutado",
  completed: "Completado", pending: "Pendiente de decision", approved: "Aprobado segun registro",
  rejected: "Rechazado", in_progress: "En curso", not_applicable: "No aplica",
  incomplete: "Incompleto", available: "Disponible, no necesariamente instalado",
  installed: "Instalado", "up-to-date": "Actualizado", ready: "Preparado",
  "detected-installed": "Detectado e instalado",
  core: "Parte obligatoria del nucleo",
  "no-evidence": "Sin evidencia", success: "Correcto", failure: "Fallido",
};

const STAGE_LABELS = {
  understand: "Comprender la peticion", analyze: "Analizar el impacto", plan: "Planificar",
  execute: "Ejecutar", validate: "Validar", document: "Documentar",
  observe: "Registrar el recorrido", learn: "Proponer aprendizaje",
};

function escape(value) {
  return String(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function lookup(table, key, fallback = key) {
  return Object.hasOwn(table, key) ? table[key] : fallback;
}

function readable(value, key = "", budget = { remaining: 300 }, depth = 0) {
  if (budget.remaining-- <= 0 || depth > 12) {
    return "<p><strong>Detalle limitado para mantener el visor legible; consulta el fichero de evidencia indicado.</strong></p>";
  }
  if (value === null || value === undefined) return "<span>No disponible: no se presupone cero.</span>";
  if (typeof value === "boolean") return value ? "Si" : "No";
  if (typeof value === "number" && /(?:duration|timeout).*ms/.test(key)) return `${(value / 1000).toFixed(2)} s`;
  if (typeof value !== "object") {
    const display = key === "status" || key === "outcome" ? lookup(STATUS_LABELS, value) : value;
    return `<span class="value">${escape(display)}</span>`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return "<p>Sin registros en esta lista. No implica que la capacidad este probada.</p>";
    const count = Math.min(value.length, 40, Math.max(0, budget.remaining));
    return `<p>${value.length} registros${count < value.length ? `; se muestran ${count}, detalle limitado` : ""}.</p>
      <ol>${value.slice(0, count).map(item =>
        `<li>${readable(item, key, budget, depth + 1)}</li>`).join("")}</ol>`;
  }
  const entries = Object.entries(value);
  const count = Math.min(entries.length, Math.max(0, budget.remaining));
  return `<dl>${entries.slice(0, count).map(([field, item]) =>
    `<dt>${escape(lookup(FIELD_LABELS, field, `Campo tecnico: ${field}`))}</dt>
    <dd>${readable(item, field, budget, depth + 1)}</dd>`).join("")}</dl>
    ${count < entries.length ? "<p>Campos adicionales omitidos por el limite de detalle; consulta la evidencia original.</p>" : ""}`;
}

function renderRecord(record, heading) {
  const safe = redact(record);
  if (Array.isArray(safe?.items) && safe.items.every(item =>
    typeof item?.type === "string" && typeof item.id === "string")) {
    const types = [...new Set(safe.items.map(item => item.type))];
    return `<p>${safe.items.length} capacidades catalogadas. Solo se muestra su estado de instalacion, no su validacion.</p>
      ${types.map(type => `<details><summary>${escape(type)}:
        ${safe.items.filter(item => item.type === type).length} capacidades</summary>
        <table><thead><tr><th>Capacidad</th><th>Estado</th><th>Para que sirve</th></tr></thead>
        <tbody>${safe.items.filter(item => item.type === type).map(item =>
          `<tr><td>${escape(item.id)}</td><td>${escape(lookup(STATUS_LABELS, item.status))}</td>
          <td>${escape(item.description || "Sin descripcion registrada")}</td></tr>`).join("")}</tbody></table>
        </details>`).join("")}`;
  }
  if (Array.isArray(safe?.stages)) {
    return `<p>Workflow: ${escape(safe.workflow_id || "No disponible")}.
      Agente: ${escape(safe.agent_id || "No disponible")}.
      Estado registrado: ${escape(lookup(STATUS_LABELS, safe.status))}.</p>
      <p>El ciclo registrado no es una aprobacion humana de la respuesta ni una prueba de entrega.</p>
      <table><thead><tr><th>Etapa</th><th>Estado</th><th>Motivo y evidencia</th></tr></thead><tbody>
      ${safe.stages.map(stage => `<tr><td>${escape(lookup(STAGE_LABELS, stage.id))}</td>
        <td>${escape(lookup(STATUS_LABELS, stage.status))}</td>
        <td>${readable({ reason: stage.reason, evidence: stage.evidence })}</td></tr>`).join("")}
      </tbody></table><details><summary>Mas datos de ${escape(heading)}</summary>${readable(safe)}</details>`;
  }
  return readable(safe);
}

function buildEvidenceLibrary(root, extraReport = null) {
  const groups = [
    [".mcpee/reports/runs", "Ciclo de ejecucion con agentes", "Etapas y evidencia de ejecuciones registradas. Ausencia de informes significa que el ciclo no esta demostrado aqui."],
    [".mcpee/reports/evaluations", "Evaluaciones", "Resultados registrados: comprueba su alcance. Checks automaticos no sustituyen una valoracion humana."],
    [".mcpee/reports/asset-evaluations", "Evaluaciones de agentes, skills y respuestas", "Distingue assertions literales y valoraciones humanas registradas. No certifica por si mismo la calidad de las respuestas."],
    [".mcpee/reports", "Otros informes y exportaciones", "Incluye instantaneas historicas y pruebas locales. Una exportacion antigua no es el estado actual."],
    [".mcpee/state", "Estado de capacidades, herramientas y grafos", "Instalado o indexado no significa ejecutado correctamente ni validado."],
    [".mcpee/observability/runtime", "Resumen de observabilidad guardado", "Instantanea persistida por observe. Puede ser anterior a los datos del encabezado del visor."],
  ];
  let count = 0;
  const sections = groups.map(([directory, title, meaning]) => {
    const files = listJsonFiles(root, directory, title);
    count += files.length;
    if (count > 500) throw new Error("Human evidence library exceeds 500 JSON files; archive old snapshots before generating the view.");
    const cards = files.map(file => {
      const record = readProjectJson(root, file, title);
      return `<details><summary>${escape(file)}</summary>
        <p>Evidencia: ${escape(file)}. Generado por: ${escape(record?.generated_by || "No consta")}.</p>
        ${renderRecord(record, file)}</details>`;
    }).join("");
    return `<article><h3>${escape(title)}</h3><p>${escape(meaning)}</p>
      ${cards || "<p>Sin registros: no se considera validado.</p>"}</article>`;
  });
  for (const file of [".mcpee/tasks/events.jsonl", ".mcpee/memory/entries.jsonl",
    ".mcpee/learning/proposals.jsonl"]) {
    let current = root;
    for (const part of file.split("/")) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) break;
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Human evidence cannot follow a symbolic link: ${file}`);
      }
    }
    const absolute = path.join(root, file);
    if (fs.existsSync(absolute) &&
        (!fs.statSync(absolute).isFile() || fs.statSync(absolute).size > 1024 * 1024)) {
      throw new Error(`Human evidence must be a regular file of at most 1 MiB: ${file}`);
    }
  }
  const localRecords = [
    ["Capacidades del proyecto", capabilityRegistry(root),
      "Relacion de agentes, skills y otros activos. Su instalacion no prueba su comportamiento."],
    ["Tareas pendientes y decisiones", listTasks(root),
      "Las tareas historicas no se cierran automaticamente porque otros tests pasen; revisa cada decision."],
    ["Memoria explicita", listMemory(root),
      "Conocimiento guardado expresamente con sus fuentes. No equivale a conocimiento usado por un modelo."],
    ["Propuestas de aprendizaje", listLearning(root),
      "Propuestas y decisiones registradas; pendiente no equivale a aprobado ni incorporado."],
  ];
  for (const [title, value, meaning] of localRecords) {
    sections.push(`<article><h3>${escape(title)}</h3><p>${escape(meaning)}</p>
      ${renderRecord(value, title)}</article>`);
  }
  if (extraReport !== null) {
    const normalized = extraReport.replace(/\\/g, "/");
    if (!normalized.endsWith(".json") || path.posix.isAbsolute(normalized) ||
        /^[A-Za-z]:/.test(normalized) || normalized.split("/").some(part => part === "..")) {
      throw new Error("--report requires a project-relative JSON file inside the project.");
    }
    let current = root;
    for (const part of normalized.split("/").filter(Boolean)) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) throw new Error(`Human evidence report does not exist: ${extraReport}`);
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Human evidence cannot follow a symbolic link: ${extraReport}`);
      }
    }
    const record = readProjectJson(root, normalized, "Selected human evidence");
    sections.push(`<article><h3>Informe seleccionado: ${escape(normalized)}</h3>
      <p>Lectura de campos, no certificacion del informe ni aprobacion de su contenido.</p>
      ${renderRecord(record, normalized)}</article>`);
  }
  return sections.join("");
}

module.exports = { buildEvidenceLibrary, readable };
