"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { assessCopilotToolCall } = require("../packages/core/src/approval");

test("exact MCPEE task transport, status and cancellation bypass redundant outer approval", () => {
  for (const tool of ["mcpee_run", "mcpee_run_status", "mcpee_run_cancel", "mcpee_specs_status",
    "mcpee_specs_decide", "mcpee_specs_revise_decision", "mcpee_specs_approve"]) {
    for (const name of [tool, `mcp__mcpee__${tool}`, `mcp_mcpee_${tool}`, `mcpee-${tool}`]) {
      const result = assessCopilotToolCall({ toolName: name }, { nonInteractive: true });
      assert.equal(result.decision, "allow", name);
      assert.match(result.reason, /nested actions retain/);
    }
  }
});

test("MCPEE-looking unknown tools and nested risky operations remain denied without approval", () => {
  for (const name of ["mcpee_run_shell", "mcpee_install", "mcp__other__mcpee_run",
    "mcp__mcpee__deploy", "deploy", "delete_file", "install", "send_message"]) {
    assert.equal(assessCopilotToolCall({ toolName: name }, { nonInteractive: true }).decision, "deny", name);
  }
  assert.equal(assessCopilotToolCall({
    toolName: "powershell", toolArgs: { command: "npm install untrusted-package" },
  }, { nonInteractive: true }).decision, "deny");
});

test("reading an existing shell result needs no execution approval but cannot send input or stop it", () => {
  assert.equal(assessCopilotToolCall({
    toolName: "read_powershell", toolArgs: { shellId: "1", delay: 120 },
  }, { nonInteractive: true }).decision, "allow");
  for (const args of [{ shellId: "1", command: "npm install" }, { shellId: "1", input: "yes" },
    { shellId: "../other" }, { shellId: "1", delay: 900 }]) {
    assert.equal(assessCopilotToolCall({ toolName: "read_powershell", toolArgs: args },
      { nonInteractive: true }).decision, "deny");
  }
  assert.equal(assessCopilotToolCall({ toolName: "stop_powershell", toolArgs: { shellId: "1" } },
    { nonInteractive: true }).decision, "deny");
});

test("canonical implementation denies nested MCPEE invocations without prompting", () => {
  for (const command of [
    "& .\\node_modules\\.bin\\mcpee.cmd specs status --slug feature",
    "mcpee workflow run --spec .mcpee/workflows/spec-feature.json",
    "node .\\node_modules\\mcp-efficiency-engine\\packages\\cli\\bin\\mcpee.js sync",
    "npx mcpee specs status",
    "npm exec -- mcpee run --task anything",
    "echo ready; mcpee sync",
    "'C:\\Program Files\\mcpee.cmd' specs status",
  ]) {
    const result = assessCopilotToolCall({ toolName: "powershell", toolArgs: { command } },
      { canonicalImplementation: true });
    assert.equal(result.decision, "deny", command);
    assert.match(result.reason, /owns canonical/);
  }
  for (const name of ["mcpee_run", "mcp__mcpee__mcpee_specs_approve"]) {
    assert.equal(assessCopilotToolCall({ toolName: name }, { canonicalImplementation: true }).decision, "deny");
    assert.equal(assessCopilotToolCall({ toolName: name }).decision, "allow");
  }
  assert.equal(assessCopilotToolCall({ toolName: "mcpee_specs_manual_review" },
    { canonicalImplementation: true }).decision, "deny");
  assert.equal(assessCopilotToolCall({ toolName: "mcpee_specs_manual_review" }).decision, "ask");
  assert.equal(assessCopilotToolCall({ toolName: "powershell", toolArgs: { command: "npm install next" } },
    { canonicalImplementation: true }).decision, "ask");
});
