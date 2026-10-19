"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function validateReleaseVersion(metadata, lock, published, requested = "") {
  assert.equal(metadata.name, "mcp-efficiency-engine");
  assert.match(metadata.version, /^0\.\d+\.\d+$/, "Release must remain in the pre-1.0 sequence");
  assert.equal(lock.name, metadata.name);
  assert.equal(lock.version, metadata.version);
  assert.equal(lock.packages[""].name, metadata.name);
  assert.equal(lock.packages[""].version, metadata.version);
  assert.equal(metadata.bin.mcpee, metadata.bin["mcp-efficiency-engine"]);
  if (requested) assert.equal(requested, metadata.version, "Dispatch version must match the committed version");
  assert.match(published, /^\d+\.\d+\.\d+$/, "Registry must return a stable version");
  const current = metadata.version.split(".").map(Number);
  const previous = published.split(".").map(Number);
  const differing = current.findIndex((part, index) => part !== previous[index]);
  assert.ok(differing >= 0 && current[differing] > previous[differing],
    "Committed release version must be newer than npm; do not silently bump in CI");
  return metadata.version;
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const registryFile = process.argv[2];
  assert.ok(registryFile, "Pass the JSON file returned by npm view");
  const version = validateReleaseVersion(
    require(path.join(root, "package.json")),
    require(path.join(root, "package-lock.json")),
    JSON.parse(fs.readFileSync(registryFile, "utf8")),
    process.env.REQUESTED_VERSION,
  );
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  }
  process.stdout.write(`Validated committed release ${version}\n`);
}

module.exports = { validateReleaseVersion };
