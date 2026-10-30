"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { assessCopilotToolCall } = require("../packages/core/src/approval");

test("exact MCPEE task transport, status and cancellation bypass redundant outer approval", () => {
  for (const tool of ["mcpee_run", "mcpee_run_status", "mcpee_run_cancel"]) {
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
