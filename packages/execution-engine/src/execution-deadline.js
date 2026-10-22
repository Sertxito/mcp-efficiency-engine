"use strict";

const ACTIVE_TIMEOUT_MS = 10 * 60_000;
const WALL_TIMEOUT_MS = 30 * 60_000;

function createExecutionDeadline({ activeMs = ACTIVE_TIMEOUT_MS, wallMs = WALL_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(activeMs) || activeMs <= 0 ||
      !Number.isInteger(wallMs) || wallMs < activeMs) {
    throw new Error("Execution deadlines require positive integer limits with wallMs >= activeMs.");
  }
  let remaining = activeMs;
  let activeSince;
  let activeTimer;
  let wallTimer;
  let waiting = 0;
  let started = false;
  let disposed = false;
  let expiry;
  let rejectDeadline;

  function dispose() {
    disposed = true;
    clearTimeout(activeTimer);
    clearTimeout(wallTimer);
  }

  function expire(message) {
    expiry = new Error(message);
    expiry.code = "MCPEE_EXECUTION_TIMEOUT";
    dispose();
    rejectDeadline(expiry);
  }

  function resume() {
    if (!started || disposed || waiting) return;
    activeSince = Date.now();
    activeTimer = setTimeout(() => expire(
      `Copilot execution exceeded ${activeMs}ms of active time (human approval waits excluded).`,
    ), remaining);
  }

  return {
    start() {
      if (started || disposed) throw new Error("Execution deadline can only start once.");
      started = true;
      return new Promise((resolve, reject) => {
        rejectDeadline = reject;
        wallTimer = setTimeout(() => expire(
          `Copilot execution exceeded the ${wallMs}ms total deadline, including approval waits.`,
        ), wallMs);
        resume();
      });
    },
    async waitForApproval(callback) {
      if (disposed) throw expiry || new Error("Copilot execution has already ended.");
      if (waiting === 0 && started) {
        remaining = Math.max(0, remaining - (Date.now() - activeSince));
        clearTimeout(activeTimer);
      }
      waiting += 1;
      try {
        const decision = await callback();
        if (disposed) throw expiry || new Error("Copilot execution has already ended.");
        return decision;
      } finally {
        waiting -= 1;
        resume();
      }
    },
    dispose,
  };
}

module.exports = { ACTIVE_TIMEOUT_MS, WALL_TIMEOUT_MS, createExecutionDeadline };
