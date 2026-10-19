"use strict";

const { spawn } = require("node:child_process");

let reporter;

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
  child.on("error", error => stream.write(`[mcpee] Activity indicator failed: ${error.message}\n`));
  return () => {
    reporter = undefined;
    child.kill();
  };
}

if (require.main === module && process.argv[2] === "--activity-worker") {
  let phase = process.argv[3];
  const started = Date.now();
  const tick = () => process.stderr.write(
    `[mcpee] Working: ${phase}; elapsed ${Math.floor((Date.now() - started) / 1000)}s (no percentage available).\n`,
  );
  process.on("message", message => {
    if (typeof message?.phase === "string") {
      phase = message.phase;
      tick();
    }
  });
  process.on("disconnect", () => process.exit(0));
  setInterval(tick, 10_000);
}

module.exports = { startActivity, reportActivity, reportEmbeddingProgress };
