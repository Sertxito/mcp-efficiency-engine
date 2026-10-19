"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { initializeProject } = require("../packages/core/src/project");
const { recordEvent } = require("../packages/core/src/telemetry");
const { readable } = require("../packages/cli/src/human-evidence");
const { runWorkflow } = require("../packages/workflow-engine/src/workflow");

const cli = path.resolve(__dirname, "../packages/cli/bin/mcpee.js");

test("request journeys show prompt, context, tools and response without claiming global validation", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-journey-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  const trace_id = "request-journey";
  for (const event of [
    { event_name: "mcp.tool.started", payload: { task: "Inspect the project" } },
    { event_name: "routing.plan.created", attributes: { workflow: "understand", agent: "reader" }, payload: { selected: { skill_ids: ["analysis"], agent_id: "reader", memory_ids: ["selected-memory"] } } },
    { event_name: "context.layer.completed", attributes: { layer: "memory", consulted: true, outcome: "success", selected_count: 1, candidate_count: 2, excluded_stale_count: 1 } },
    { event_name: "context.layer.completed", attributes: { layer: "knowledge.grounding", consulted: true, outcome: "success", vector_search_performed: false, selected_vector_count: 0, selected_lexical_count: 1, retrieval: "lexical-fallback", fallback_reason: "No vectors" } },
    { event_name: "copilot.execution.started", attributes: { context_mode: "grounded", context_source_count: 1, prompt_estimated_tokens: 50 }, payload: { context: { files: ["README.md"], sha256: "abc" }, delivery: { agent_id: "reader", skill_ids: ["analysis"], memory_ids: ["sent-memory"] } } },
    { event_name: "copilot.sdk.assistant.usage", attributes: { input_tokens: 100, output_tokens: 10, cache_read_tokens: 50, cost: 1 } },
    { event_name: "copilot.sdk.assistant.usage", attributes: { input_tokens: 200, output_tokens: 20 } },
    { event_name: "copilot.execution.completed", attributes: { input_tokens: 300, output_tokens: 30 } },
    { event_name: "copilot.sdk.session.usage_info", attributes: { current_tokens: 150, token_limit: 1000 } },
    { event_name: "copilot.sdk.session.skills_loaded", payload: { data: { skills: [{ name: "available-skill" }] } } },
    { event_name: "copilot.sdk.skill.invoked", payload: { data: { name: "invoked-skill" } } },
    { event_name: "copilot.sdk.subagent.started", payload: { data: { agentName: "actual-subagent" } } },
    { event_name: "copilot.prompt.sent", payload: { prompt: "PACKAGED_CONTEXT <script> API_KEY=privatevalue" } },
    { event_name: "copilot.tool.requested", tool_name: "view", tool_call_id: "read-1", payload: { input: { path: "README.md" } } },
    { event_name: "copilot.tool.completed", tool_name: "view", tool_call_id: "read-1", attributes: { result: "success" } },
    { event_name: "copilot.response.received", payload: { content: "FINAL_INSPECTION_RESPONSE" } },
    { event_name: "mcp.tool.completed", attributes: { outcome: "success" } },
    { event_name: "copilot.sdk.assistant.reasoning", payload: { content: "INTERNAL_REASONING_NOT_FOR_DISPLAY" } },
  ]) recordEvent(root, { ...event, trace_id });
  execFileSync(process.execPath, [cli, "view", "--project", root, "--html", "journey.html"]);
  const html = fs.readFileSync(path.join(root, "journey.html"), "utf8");
  assert.match(html, /Estado global del producto: no evaluado/);
  assert.match(html, /Peticion recibida por MCPEE/);
  assert.match(html, /PACKAGED_CONTEXT &lt;script&gt;/);
  assert.match(html, /FINAL_INSPECTION_RESPONSE/);
  assert.match(html, /Respuesta registrada; calidad no evaluada/);
  assert.match(html, /Contenido devuelto no disponible/);
  assert.doesNotMatch(html, /privatevalue|INTERNAL_REASONING_NOT_FOR_DISPLAY/);
  assert.match(html, /Entrada acumulada: <b>300 \(2\/2 registros\)/);
  assert.match(html, /Salida acumulada: <b>30 \(2\/2 registros\)/);
  assert.match(html, /Cache leida: 50 \(1\/2 registros\)/);
  assert.match(html, /Ventana SDK, ultima observacion: 150 \/ 1000 tokens/);
  assert.match(html, /multiplicador de solicitudes premium/i);
  assert.match(html, /Gasto facturado no disponible/i);
  assert.match(html, /Busqueda vectorial ejecutada: No/);
  assert.match(html, /memorias seleccionadas: selected-memory/i);
  assert.match(html, /memorias incluidas en el prompt: sent-memory/i);
  assert.match(html, /Skills descubiertas por el runtime: 1/);
  assert.match(html, /available-skill/);
  assert.match(html, /Skills invocadas segun el SDK: invoked-skill/);
  assert.match(html, /actual-subagent/);
  assert.match(html, /no prueba influencia causal/);
});

test("human observation HTML distinguishes latest attempts, escapes evidence and fails closed", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-html-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  const reports = path.join(root, ".mcpee/reports/workflows");
  fs.mkdirSync(reports, { recursive: true });
  for (const [id, result, time] of [
    ["first", "failed", "2026-10-14T08:00:00.000Z"],
    ["second", "passed", "2026-10-14T09:00:00.000Z"],
  ]) {
    fs.writeFileSync(path.join(reports, `${id}.json`), JSON.stringify({
      id, workflow_id: "review-check", status: result, completed_at: time,
      task: "<script>alert(1)</script>",
      checks: [{ id: "check", status: result, tool: "node", duration_ms: 1500,
          stdout_tail: "\u001b[32mAPI_KEY=secretvalue\u001b[0m", stderr_tail: "<img src=x onerror=alert(1)>" }],
      evidence: [],
    }));
  }
  recordEvent(root, { event_name: "workflow.completed", trace_id: "test-trace",
    attributes: { status: "passed" } });
  execFileSync(process.execPath, [cli, "observe", "--project", root, "--html", "review.html"]);
  const html = fs.readFileSync(path.join(root, "review.html"), "utf8");
  assert.match(html, /ULTIMO RESULTADO REGISTRADO/);
  assert.match(html, /INTENTO HISTORICO/);
  assert.match(html, /Sin eventos de consumo del modelo/);
  assert.match(html, /No disponible tokens/);
  assert.match(html, /no vuelve a ejecutar tests ni verifica vigencia/);
  assert.match(html, /Resultado de validacion/);
  assert.match(html, /1\.50 s/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img|secretvalue|https?:\/\//);
  assert.match(html, /\[REDACTED\]/);
  assert.doesNotMatch(html, /\u001b/);
  assert.throws(() => execFileSync(process.execPath, [cli, "observe", "--project", root,
    "--html", "review.html"], { stdio: "pipe" }), /overwrite/);
  assert.throws(() => execFileSync(process.execPath, [cli, "observe", "--project", root,
    "--html", "../outside.html"], { stdio: "pipe" }), /inside the project/);
  fs.writeFileSync(path.join(reports, "invalid.json"), "{broken");
  assert.throws(() => execFileSync(process.execPath, [cli, "observe", "--project", root,
    "--html", "invalid.html"], { stdio: "pipe" }), /Cannot parse/);
  assert.equal(fs.existsSync(path.join(root, "invalid.html")), false);
});

test("human observation HTML shows missing declared checks without claiming approval", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-html-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: ">=24" } }));
  fs.writeFileSync(path.join(root, ".mcpee/workflows/pending.json"), JSON.stringify({
    workflow_id: "pending", task: "Pending validation", evidence: ["package.json"],
    steps: [{ id: "pending-check", label: "Required check", tool: "node",
      args: ["--version"], evidence: ["package.json"], covers_technologies: ["node"] }],
  }));
  execFileSync(process.execPath, [cli, "observe", "--project", root, "--html", "review.html"]);
  const html = fs.readFileSync(path.join(root, "review.html"), "utf8");
  assert.match(html, /Faltan resultados de checks declarados/);
  assert.match(html, /Required check/);
  assert.match(html, /No probado: sin resultado registrado/);
  assert.match(html, /No hay informes de workflows/);
  assert.match(html, /NO es una aprobacion humana/);
});

test("view explains run stages, other reports and pending human decisions without raw JSON", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-view-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  fs.writeFileSync(path.join(root, ".mcpee/reports/runs/run.json"), JSON.stringify({
    generated_by: "mcpee", status: "blocked", workflow_id: "deliver-feature", agent_id: "backend",
    stages: [{ id: "execute", status: "completed", evidence: [] },
      { id: "validate", status: "blocked", reason: "Approval missing", evidence: [] }],
  }));
  fs.writeFileSync(path.join(root, ".mcpee/reports/custom.json"), JSON.stringify({
    generated_by: "local-validation-host", status: "passed", model_execution: false,
    unknown_field: "<script>unsafe</script>", secret: "privatevalue",
  }));
  execFileSync(process.execPath, [cli, "view", "--project", root, "--html", "view.html"]);
  const html = fs.readFileSync(path.join(root, "view.html"), "utf8");
  assert.match(html, /Biblioteca de evidencias para personas/);
  assert.match(html, /Ciclo de ejecucion con agentes/);
  assert.match(html, /Planificar|Ejecutar/);
  assert.match(html, /Approval missing/);
  assert.match(html, /Se ejecuto un modelo/);
  assert.match(html, /Campo tecnico: unknown_field/);
  assert.match(html, /Propuestas de aprendizaje/);
  assert.match(html, /no se cierran automaticamente/);
  assert.doesNotMatch(html, /privatevalue|<script/);
  assert.throws(() => execFileSync(process.execPath, [cli, "view", "--project", root],
    { stdio: "pipe" }), /requires --html/);
});

test("human evidence explicitly limits long records and refuses oversized input", t => {
  assert.match(readable(Array.from({ length: 100 }, (_, index) => index)), /se muestran 40/);
  assert.match(readable(JSON.parse('{"constructor":"x","__proto__":"y"}')), /Campo tecnico: constructor/);
  assert.match(readable(JSON.parse('{"constructor":"x","__proto__":"y"}')), /Campo tecnico: __proto__/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-view-limit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  fs.writeFileSync(path.join(root, ".mcpee/reports/oversized.json"),
    JSON.stringify({ text: "x".repeat(1024 * 1024) }));
  assert.throws(() => execFileSync(process.execPath, [cli, "view", "--project", root,
    "--html", "view.html"], { stdio: "pipe" }), /exceeds/);
  assert.equal(fs.existsSync(path.join(root, "view.html")), false);
});

test("human evidence refuses linked report directories", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-view-linked-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  const target = path.join(root, "linked-reports");
  fs.mkdirSync(target);
  const link = path.join(root, ".mcpee/reports/asset-evaluations");
  if (fs.existsSync(link)) fs.rmdirSync(link);
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => execFileSync(process.execPath, [cli, "view", "--project", root,
    "--html", "linked.html"], { stdio: "pipe" }), /symbolic link/);
  assert.equal(fs.existsSync(path.join(root, "linked.html")), false);
});
test("view can explain a selected project JSON without following paths outside the project", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-view-selected-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  fs.writeFileSync(path.join(root, "custom-evidence.json"), JSON.stringify({
    status: "pending", decision: "Requires a human decision", duration_ms: 2500,
  }));
  execFileSync(process.execPath, [cli, "view", "--project", root,
    "--html", "view.html", "--report", "custom-evidence.json"]);
  const html = fs.readFileSync(path.join(root, "view.html"), "utf8");
  assert.match(html, /Informe seleccionado: custom-evidence.json/);
  assert.match(html, /Pendiente de decision/);
  assert.match(html, /2\.50 s/);
  assert.throws(() => execFileSync(process.execPath, [cli, "view", "--project", root,
    "--html", "outside.html", "--report", "../outside.json"], { stdio: "pipe" }), /inside the project/);
  assert.throws(() => execFileSync(process.execPath, [cli, "view", "--project", root,
    "--html", "missing.html", "--report", "missing.json"], { stdio: "pipe" }), /does not exist/);
  assert.equal(fs.existsSync(path.join(root, "outside.html")), false);
  assert.equal(fs.existsSync(path.join(root, "missing.html")), false);
});

test("human view calls only declared local checks complete after a real passing workflow", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-view-complete-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: ">=24" } }));
  fs.writeFileSync(path.join(root, ".mcpee/workflows/local-check.json"), JSON.stringify({
    workflow_id: "local-check", task: "Run detected local project validation checks for local-check: Check Node.",
    evidence: ["package.json"], steps: [{ id: "node-version", label: "Node executable responds",
      tool: "node", args: ["--version"], evidence: ["package.json"], covers_technologies: ["node"] }],
  }));
  const result = await runWorkflow(root, ".mcpee/workflows/local-check.json");
  assert.equal(result.status, "passed");
  execFileSync(process.execPath, [cli, "view", "--project", root, "--html", "view.html"]);
  const html = fs.readFileSync(path.join(root, "view.html"), "utf8");
  assert.match(html, /Con resultados registrados correctos; vigencia y suficiencia no verificadas/);
  assert.match(html, /Estado global del producto: no evaluado/);
  assert.match(html, /Spec de checks comunes/);
  assert.match(html, /NO demuestra que se haya ejecutado su procedimiento especializado/);
  assert.match(html, /NO es una aprobacion humana/);
  assert.match(html, /infraestructura desplegada/);
});
