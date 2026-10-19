#!/usr/bin/env node
"use strict";

const { run } = require("../src/cli");
const { startActivity } = require("../src/activity");

const stopActivity = startActivity(process.argv.slice(2));
run(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error) => {
  process.stderr.write(`[mcpee] ${error.message}\n`);
  process.exitCode = 1;
}).finally(stopActivity);
