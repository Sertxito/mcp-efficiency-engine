const { spawnSync } = require("node:child_process");

function hasCommand(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error && result.error.code === "ENOENT") {
    return false;
  }
  return !result.error;
}

function hasHeadroomViaUv() {
  const candidates = [
    ["py", ["-3", "-m", "uv", "tool", "run", "headroom", "--version"]],
    ["python", ["-m", "uv", "tool", "run", "headroom", "--version"]],
  ];

  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, { stdio: "ignore" });
    if (result.error && result.error.code === "ENOENT") {
      continue;
    }

    if (!result.error && (result.status ?? 1) === 0) {
      return true;
    }
  }

  return false;
}

function isHeadroomEnabled() {
  if (hasCommand("headroom") || hasCommand("headroom-ai")) {
    return true;
  }

  return hasHeadroomViaUv();
}

function detectOptimizers() {
  return [
    {
      name: "Token Saver",
      enabled: true,
      optional: false,
    },
    {
      name: "Caveman",
      enabled: true,
      optional: false,
    },
    {
      name: "Budget Optimizer",
      enabled: true,
      optional: false,
    },
    {
      name: "Headroom",
      enabled: isHeadroomEnabled(),
      optional: true,
    },
  ];
}

module.exports = {
  detectOptimizers,
};
