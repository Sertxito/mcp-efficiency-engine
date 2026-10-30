"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const metadata = require(path.join(root, "package.json"));
const entry = require.resolve("@github/copilot-sdk");
const sdkRoot = path.resolve(path.dirname(entry), "../..");
const sdk = require(path.join(sdkRoot, "package.json"));
const sdkRequire = createRequire(entry);
const zodManifest = sdkRequire.resolve("zod/package.json");
const zod = require(zodManifest);
assert.equal(sdk.version, metadata.devDependencies["@github/copilot-sdk"]);
assert.equal(zod.version, metadata.dependencies.zod, "The SDK must build against the patched Zod");
assert.equal(sdk.dependencies.koffi, metadata.dependencies.koffi);
assert.deepEqual(sdk.optionalDependencies, metadata.optionalDependencies,
  "Native runtime packages must exactly match the bundled SDK version and supported platforms");

const outputDirectory = path.join(root, "packages", "execution-engine", "runtime");
const outfile = path.join(outputDirectory, "copilot-sdk.cjs");
const result = buildSync({
  absWorkingDir: root,
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["koffi"],
  legalComments: "eof",
  metafile: true,
  write: false,
});
const bundledPackages = new Set(Object.keys(result.metafile.inputs).map((file) => {
  const parts = file.replace(/\\/g, "/").split("/node_modules/").at(-1).replace(/^node_modules\//, "").split("/");
  return parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}));
assert.ok(bundledPackages.has("@github/copilot-sdk"));
assert.ok(bundledPackages.has("vscode-jsonrpc"));
assert.deepEqual([...bundledPackages].filter((name) =>
  !["@github/copilot-sdk", "vscode-jsonrpc", "zod"].includes(name)), []);

const jsonRpcRoot = path.resolve(path.dirname(sdkRequire.resolve("vscode-jsonrpc/node.js")));
const jsonRpc = require(path.join(jsonRpcRoot, "package.json"));
const notices = [
  ["@github/copilot-sdk", fs.readFileSync(path.join(__dirname, "licenses", "copilot-sdk.txt"), "utf8")],
  ["zod", fs.readFileSync(path.join(path.dirname(zodManifest), "LICENSE"), "utf8")],
  ["vscode-jsonrpc", fs.readFileSync(path.join(jsonRpcRoot, "License.txt"), "utf8")],
];
fs.mkdirSync(outputDirectory, { recursive: true });
const output = result.outputFiles.find((file) => file.path === outfile);
assert.ok(output, "The SDK bundle was not produced");
fs.writeFileSync(outfile, output.contents);
fs.writeFileSync(path.join(outputDirectory, "THIRD-PARTY-NOTICES.txt"),
  notices.map(([name, text]) => `## ${name}\n\n${text.trim()}\n`).join("\n"));
const provenance = {
  sdk: { name: sdk.name, version: sdk.version },
  zod: { version: zod.version, bundled: bundledPackages.has("zod") },
  jsonrpc: { version: jsonRpc.version },
  external: ["koffi"],
  sha256: crypto.createHash("sha256").update(output.contents).digest("hex"),
};
fs.writeFileSync(path.join(outputDirectory, "build.json"), `${JSON.stringify(provenance, null, 2)}\n`);
process.stderr.write(`Bundled Copilot SDK ${sdk.version} with Zod ${zod.version}; native runtime remains platform-selected.\n`);
