"use strict";

const { executeRunSpec, loadRunSpec } = require("../../evaluation-engine/src/evaluate");
const { recordEvent } = require("../../core/src/telemetry");
const { analyzeImpacts } = require("../../knowledge-engine/src/unified");

async function runWorkflow(projectRoot, workflowSpecPath, options = {}) {
  const spec = loadRunSpec(projectRoot, workflowSpecPath);
  if (!spec.workflow_id) throw new Error("Workflow specification requires a workflow_id.");
  if (options.expectedWorkflowId && spec.workflow_id !== options.expectedWorkflowId) {
    throw new Error(`Validation workflow mismatch: expected '${options.expectedWorkflowId}', found '${spec.workflow_id}'.`);
  }
  const impactPreflight = analyzeImpacts(projectRoot, spec.evidence.map((source) => source.path));
  await options.beforeRun?.(impactPreflight);
  recordEvent(projectRoot, {
    event_name: "workflow.started",
    attributes: { workflow_id: spec.workflow_id, step_count: spec.checks.length },
  });
  return executeRunSpec(projectRoot, spec, {
    approveStep: options.approveStep,
    impactPreflight,
    reportDirectory: ".mcpee/reports/workflows",
    eventName: "workflow.completed",
  });
}

module.exports = { runWorkflow };
