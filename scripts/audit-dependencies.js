"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) {
  throw new Error("Run the dependency audit through npm so npm_execpath is available.");
}

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^npm_config_allow_scripts$/i.test(key)) delete env[key];
}

const result = spawnSync(process.execPath, [npmCli, "audit", "--ignore-scripts", "--audit-level=low"], {
  cwd: path.resolve(__dirname, ".."),
  env,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
