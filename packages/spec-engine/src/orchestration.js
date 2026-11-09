"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { renameAtomicSync } = require("../../core/src/atomic-file");
const { projectPath, ensureDirectory } = require("./brownfield");
const { workspace, featureStatus } = require("./lifecycle");
const { recordEvent } = require("../../core/src/telemetry");

async function runSpecificationLifecycle(root, { slug, task, through, execute }) {
  if (!["tasks", "verification"].includes(through) || typeof task !== "string" || !task.trim() ||
      typeof execute !== "function") throw new Error("Lifecycle execution requires a feature, task and explicit tasks/verification endpoint.");
  const record = {
    schema_version: 1, generated_by: "mcpee", id: crypto.randomUUID(), feature: slug,
    task_sha256: crypto.createHash("sha256").update(task).digest("hex"),
    through, started_at: new Date().toISOString(), status: "running", phases: [],
    product_acceptance: "not-verified",
  };
  const report = `.mcpee/reports/lifecycles/${record.id}.json`;
  ensureDirectory(root, ".mcpee/reports/lifecycles");
  const save = () => {
    const filename = projectPath(root, report);
    const temporary = projectPath(root, `${report}.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
      renameAtomicSync(temporary, filename);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
  save();
  const seen = new Set();
  try {
    for (let count = 0; count < 4; count++) {
      const directory = workspace(slug, root);
      const present = fs.existsSync(projectPath(root, `${directory}/manifest.json`));
      if (!present && fs.existsSync(projectPath(root, `${directory}/spec.md`))) {
        throw new Error("Lifecycle cannot overwrite an existing manual draft; reconcile its canonical specification first.");
      }
      const status = present ? featureStatus(root, slug) : null;
      if (status && status.specification_approved && (through === "tasks" && status.reviews.tasks.approved ||
          through === "verification" && status.implementation_verified)) {
        record.status = "completed";
        break;
      }
      const phase = !status ? "specification" : {
        "author-plan": "plan", "author-tasks": "tasks", "implement-and-verify": "implementation",
      }[status.next];
      if (!phase) {
        record.status = "blocked";
        record.reason = `Canonical lifecycle requires ${status.next}; no automatic decision or approval was fabricated.`;
        break;
      }
      if (seen.has(phase)) throw new Error(`Lifecycle phase ${phase} did not advance; no duplicate paid execution was started.`);
      seen.add(phase);
      const prefix = {
        specification: `Generate atomic functional specifications for ${slug}. Required slug: ${slug}.`,
        plan: `Create technical plan for ${slug}.`,
        tasks: `Create tasks for ${slug}.`,
        implementation: `Implement ${slug} and execute its canonical verification checks.`,
      }[phase];
      const phaseTask = `${prefix}\nAuthoritative original request and constraints:\n${task}\n` +
        `Use ${directory}/ as the canonical workspace; resolve its current state from docs/specifications/README.md. This invocation covers only ${phase}; do not execute other phases yourself. ` +
        "Do not fabricate decisions, grant risky approvals, weaken requirements, deploy or publish. MCPEE controls validated advancement.";
      const entry = { phase, status: "running", started_at: new Date().toISOString() };
      record.phases.push(entry);
      save();
      recordEvent(root, { event_name: "specification.lifecycle.phase.started", attributes: { feature: slug, phase, report } });
      const code = await execute(phaseTask, phase);
      entry.status = code === 0 ? "completed" : "failed";
      entry.exit_code = code;
      entry.completed_at = new Date().toISOString();
      save();
      if (code !== 0) {
        record.status = "failed";
        record.reason = `${phase} failed; inspect its existing run/candidate evidence. No automatic rerun was attempted.`;
        break;
      }
    }
    if (record.status === "running") {
      const status = featureStatus(root, slug);
      record.status = through === "tasks" ? status.specification_approved && status.reviews.tasks.approved ? "completed" : "blocked"
        : status.implementation_verified ? "completed" : "blocked";
      if (record.status === "blocked") record.reason = `Lifecycle endpoint not verified; next action is ${status.next}.`;
    }
  } catch (error) {
    record.status = "failed";
    record.reason = error.message;
    const active = record.phases.find(phase => phase.status === "running");
    if (active) {
      active.status = "failed";
      active.completed_at = new Date().toISOString();
      active.reason = error.message;
    }
    throw error;
  } finally {
    record.completed_at = new Date().toISOString();
    save();
    recordEvent(root, { event_name: "specification.lifecycle.completed",
      attributes: { feature: slug, status: record.status, report, phase_count: record.phases.length,
        product_acceptance: "not-verified" } });
  }
  return { ...record, report, exitCode: record.status === "completed" ? 0 : 1 };
}

function reconcileInterruptedLifecycle(root, reportId, runId) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!uuid.test(reportId || "") || !uuid.test(runId || "")) throw new Error("Lifecycle and run IDs must be UUIDs.");
  const reportPath = `.mcpee/reports/lifecycles/${reportId}.json`;
  const runPath = `.mcpee/state/runs/${runId}.json`;
  const filename = projectPath(root, reportPath);
  const previous = fs.readFileSync(filename);
  const report = JSON.parse(previous.toString("utf8"));
  const run = JSON.parse(fs.readFileSync(projectPath(root, runPath), "utf8"));
  if (report.generated_by !== "mcpee" || report.id !== reportId || report.status !== "running" ||
      run.generated_by !== "mcpee" || run.run_id !== runId || !["cancelled", "failed"].includes(run.status) ||
      run.task_sha256 !== report.task_sha256 || !Number.isFinite(run.started_at) || !Number.isFinite(run.updated_at) ||
      !Number.isFinite(Date.parse(report.started_at)) || Date.parse(report.started_at) < run.started_at ||
      Date.parse(report.started_at) > run.updated_at || !Number.isInteger(run.child_pid) || run.child_pid <= 0 ||
      !Array.isArray(report.phases)) {
    throw new Error("Lifecycle and terminal run evidence do not match; reconciliation is blocked.");
  }
  try {
    process.kill(run.child_pid, 0);
    throw new Error("The recorded lifecycle process may still be running; reconciliation is blocked.");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  const archive = `${reportPath}.${crypto.createHash("sha256").update(previous).digest("hex")}.original`;
  if (fs.existsSync(projectPath(root, archive))) {
    if (!fs.readFileSync(projectPath(root, archive)).equals(previous)) throw new Error("Lifecycle archive conflicts with existing evidence.");
  } else fs.writeFileSync(projectPath(root, archive), previous, { flag: "wx" });
  report.status = "interrupted";
  report.completed_at = new Date(run.updated_at).toISOString();
  report.reason = `The linked MCPEE run ${runId} ended ${run.status}; the lifecycle did not persist a terminal result. Inspect the run and session evidence before resuming.`;
  report.reconciliation = { run_id: runId, run_path: runPath, previous_report: archive,
    reconciled_at: new Date().toISOString() };
  for (const phase of report.phases.filter(item => item.status === "running")) {
    phase.status = "interrupted";
    phase.completed_at = report.completed_at;
    phase.reason = "Execution ended without a persisted phase result.";
  }
  const temporary = `${reportPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(projectPath(root, temporary), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    if (!fs.readFileSync(filename).equals(previous)) throw new Error("Lifecycle report changed during reconciliation.");
    renameAtomicSync(projectPath(root, temporary), filename);
  } finally {
    if (fs.existsSync(projectPath(root, temporary))) fs.unlinkSync(projectPath(root, temporary));
  }
  return { ...report, report: reportPath };
}

module.exports = { runSpecificationLifecycle, reconcileInterruptedLifecycle };
