"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateReleaseVersion } = require("../scripts/check-release-version");

function fixture(version = "0.1.22") {
  const metadata = { name: "mcp-efficiency-engine", version,
    bin: { mcpee: "cli.js", "mcp-efficiency-engine": "cli.js" } };
  const lock = { name: metadata.name, version, packages: {
    "": { name: metadata.name, version },
  } };
  return { metadata, lock };
}

test("release preserves npm identity and validates increasing committed versions without CI drift", () => {
  const { metadata, lock } = fixture();
  assert.equal(validateReleaseVersion(metadata, lock, "0.1.21"), "0.1.22");
  assert.equal(validateReleaseVersion(metadata, lock, "0.1.21", "0.1.22"), "0.1.22");
  assert.throws(() => validateReleaseVersion(metadata, lock, "0.1.22"), /newer than npm/);
  assert.throws(() => validateReleaseVersion(metadata, lock, "0.2.0"), /newer than npm/);
  assert.throws(() => validateReleaseVersion(metadata, lock, "0.1.21", "0.1.23"), /Dispatch version/);
  assert.throws(() => validateReleaseVersion(metadata, lock, null));
  assert.throws(() => validateReleaseVersion(metadata, { ...lock, version: "0.1.0" }, "0.1.21"));
  assert.throws(() => validateReleaseVersion({ ...metadata, name: "@mcpee/cli" }, lock, "0.1.21"));
  const stable = fixture("1.0.0");
  assert.throws(() => validateReleaseVersion(stable.metadata, stable.lock, "0.1.21"), /pre-1.0/);
});
