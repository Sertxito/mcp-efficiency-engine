"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { initializeProject } = require("../packages/core/src/project");
const { readCatalog } = require("../packages/copilot-renderer/src/render");
const { routeTask } = require("../packages/routing-engine/src/route");
const { readEvents } = require("../packages/core/src/telemetry");
const { runCopilotTask } = require("../packages/execution-engine/src/copilot");

const requests = {
  "analyze-business-rules": "Analyze business rules",
  "deliver-frontend-change": "Review a frontend change",
  "deliver-data-pipeline": "Review a data pipeline",
  "evaluate-ai-feature": "Review an AI feature",
  "understand-project": "Understand the project",
  "ingest-knowledge": "Ingest knowledge",
  "deliver-feature": "Implement a feature",
  "refine-backlog": "Refine the backlog",
  "resolve-bug": "Fix a bug",
  "refactor-code": "Refactor code",
  "change-architecture": "Review architecture",
  "review-security": "Review security",
  "modernize-legacy": "Modernize legacy",
  "synchronize-documentation": "Synchronize documentation",
  "diagnose-operation": "Diagnose operation",
  "evaluate-execution": "Evaluate execution",
  "architecture-challenge": "Challenge architecture",
  "technical-debt-assessment": "Assess technical debt",
  "technical-due-diligence": "Perform technical due diligence",
  "performance-forensics": "Perform performance forensics",
  "create-or-update-work-items": "Update work item",
  "cross-stack-feature-review": "Perform cross-stack review",
  "database-change-with-baseline": "Review a database baseline",
  "design-and-accessibility-gate": "Perform accessibility review",
  "build-and-promote": "Build and promote",
  "deploy-with-approval": "Deploy with approval",
  "respond-to-incident": "Coordinate incident response",
  "close-loop-and-learn": "Close the loop",
  "forensic-assessment": "Perform forensic assessment",
  "validate-change": "Validate change",
  "evaluate-agent-assets": "Evaluate agent assets",
};

test("all catalogue workflows route with their declared skills, guidance and observable selection", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-catalog-routing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject(root);
  const { catalog } = readCatalog();
  assert.deepEqual(Object.keys(requests).sort(), catalog.workflows.map(item => item.id).sort(),
    "new catalogue workflows require an independent request fixture");
  for (const workflow of catalog.workflows) {
    await t.test(workflow.id, () => {
      const plan = routeTask(root, requests[workflow.id]);
      assert.equal(plan.workflow.id, workflow.id);
      assert.ok(plan.workflow.guidance?.trim());
      assert.equal(plan.agent.id, workflow.agent, "ordinary requests retain the workflow's intended role");
      const agent = catalog.agents.find(item => item.id === plan.agent.id);
      if (agent.source_path) assert.ok(plan.agent.guidance?.trim());
      assert.deepEqual(plan.agent.focus, agent.focus);
      const selected = new Set(plan.skills.map(item => item.id));
      for (const id of workflow.skills) assert.ok(selected.has(id), `missing workflow skill: ${id}`);
      for (const skill of plan.skills) {
        const declared = catalog.skills.find(item => item.id === skill.id);
        if (declared.source_path) assert.ok(skill.guidance?.trim(), `missing guidance: ${skill.id}`);
        assert.deepEqual(skill.procedure, declared.procedure || [], `missing procedure: ${skill.id}`);
      }
      assert.equal(plan.execution, "plan-only; no agent or tool was invoked");
      const event = readEvents(root).findLast(item => item.event_name === "routing.plan.created");
      assert.equal(event.attributes.workflow, workflow.id);
      assert.equal(event.attributes.agent, plan.agent.id);
      assert.equal(event.attributes.task_sha256, plan.task_sha256);
      assert.deepEqual(event.payload.selected.skill_ids, plan.skills.map(item => item.id));
    });
  }
  await t.test("asset evaluation uses QA even when the asset's domain names another specialist", () => {
    for (const request of ["Evaluate agent assets", "Evaluate skill quality",
      "Evaluate workflow quality", "Evaluate agent assets for an AI model", "Evaluate agent assets for frontend"]) {
      const plan = routeTask(root, request);
      assert.equal(plan.workflow.id, "evaluate-agent-assets");
      assert.equal(plan.agent.id, "qa");
    }
  });
  await t.test("skill procedures reach the executor prompt, not just the routing report", async () => {
    const request = requests["deliver-feature"];
    const plan = routeTask(root, request);
    let prompt;
    await runCopilotTask(root, request, plan, {
      approved: true,
      clientFactory: () => ({
        async start() {},
        async createSession() {
          return {
            sessionId: "20000000-0000-4000-8000-000000000008",
            on() {},
            async sendAndWait(message) {
              prompt = message.prompt;
              return { data: { content: "Fixture response; no implementation performed." } };
            },
            async disconnect() {},
          };
        },
        async stop() {},
      }),
    });
    for (const skill of plan.skills) {
      for (const step of skill.procedure) assert.ok(prompt.includes(step), `undelivered step: ${skill.id}`);
    }
  });
});
