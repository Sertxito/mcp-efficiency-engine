"use strict";

const { spawn } = require("node:child_process");

let reporter;
let paused = false;

async function pauseActivity() {
  paused = true;
  const child = reporter;
  if (!child?.connected) return;
  await new Promise(resolve => {
    const done = () => {
      child.removeListener("message", onMessage);
      child.removeListener("exit", done);
      child.removeListener("error", done);
      resolve();
    };
    const onMessage = message => { if (message.paused) done(); };
    child.on("message", onMessage);
    child.once("exit", done);
    child.once("error", done);
    child.send({ paused: true });
  });
}

function resumeActivity() {
  paused = false;
  if (reporter?.connected) reporter.send({ paused: false });
}

function reportActivity(phase) {
  if (reporter?.connected) reporter.send({ phase });
}

function reportEmbeddingProgress(progress, stream = process.stderr) {
  const count = Number.isInteger(progress.completed) && Number.isInteger(progress.total)
    ? ` ${progress.completed}/${progress.total}` : "";
  const cached = Number.isInteger(progress.cached) ? `; cached=${progress.cached}` : "";
  const batch = Number.isInteger(progress.batch_size) && Number.isInteger(progress.max_tokens)
    ? `; batch=${progress.batch_size}; max_tokens=${progress.max_tokens}` : "";
  const message = `BGE-M3: ${progress.phase}${count}${cached}${batch}`;
  reportActivity(message);
  stream.write(`[mcpee] ${message}\n`);
}

function startActivity(args, stream = process.stderr) {
  if (!stream.isTTY || !args[0] || args[0] === "help" ||
      args.includes("--help") || args.includes("-h") || args.includes("--version") ||
      args.includes("--json") || args.includes("--chat-json")) return () => {};
  const child = spawn(process.execPath, [__filename, "--activity-worker", args[0]], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true,
  });
  reporter = child;
  if (paused) child.send({ paused: true });
  child.on("error", error => stream.write(`[mcpee] Activity indicator failed: ${error.message}\n`));
  return () => {
    reporter = undefined;
    child.kill();
  };
}

if (require.main === module && process.argv[2] === "--activity-worker") {
  let phase = process.argv[3];
  let paused = false;
  const started = Date.now();
  const tick = () => !paused && process.stderr.write(
    `[mcpee] Working: ${phase}; elapsed ${Math.floor((Date.now() - started) / 1000)}s (no percentage available).\n`,
  );
  process.on("message", message => {
    if (typeof message?.paused === "boolean") {
      paused = message.paused;
      if (paused && process.connected) process.send({ paused: true });
    }
    if (typeof message?.phase === "string") {
      phase = message.phase;
      tick();
    }
  });
  process.on("disconnect", () => process.exit(0));
  setInterval(tick, 10_000);
}

module.exports = { startActivity, reportActivity, reportEmbeddingProgress, pauseActivity, resumeActivity };
