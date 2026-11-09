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
  let adapterPath;
  if (options.canonicalFeature) {
    const canonical = require("../../spec-engine/src/phases").prepareImplementationValidation(projectRoot, options.canonicalFeature, { allowPending: true });
    if (spec.workflow_id !== canonical.spec.workflow_id) throw new Error("Canonical validation workflow ID does not match the feature.");
    adapterPath = canonical.explicit_workflow;
    if (adapterPath && !spec.evidence.some(source => source.path === adapterPath && source.sha256 === canonical.workflow_sha256)) {
      throw new Error("Canonical workflow adapter evidence does not match its validated digest.");
    }
  }
  const impactPreflight = analyzeImpacts(projectRoot, spec.evidence
    .filter(source => source.path !== adapterPath).map(source => source.path));
  if (adapterPath) {
    recordEvent(projectRoot, { event_name: "workflow.adapter.validated",
      attributes: { workflow_id: spec.workflow_id, path: adapterPath,
        basis: "digest-bound-execution-configuration; not an application impact target" } });
  }
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
