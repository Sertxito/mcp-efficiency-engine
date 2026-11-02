"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const manifest = require("./toolchain.json");

function download(url, redirects = 0, signal = AbortSignal.timeout(45000)) {
  return new Promise((resolve, reject) => {
    if (redirects > 5 || new URL(url).protocol !== "https:") {
      reject(new Error("Unexpected native-tool download redirect."));
      return;
    }
    const request = https.get(url, { signal, headers: { "User-Agent": "mcpee-pipeline-oracle" } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location) return reject(new Error("Download redirect has no location."));
        resolve(download(new URL(response.headers.location, url).href, redirects + 1, signal));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Native-tool download returned HTTP ${response.statusCode}.`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) {
          response.destroy(new Error("Native-tool archive exceeds the bounded download size."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(30000, () => request.destroy(new Error("Native-tool download timed out.")));
    request.on("error", reject);
  });
}

function nativeEnvironment(directory) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (["path", "systemroot", "windir", "pathext", "comspec"].includes(key.toLowerCase())) env[key] = value;
  }
  return { ...env, HOME: directory, USERPROFILE: directory, TMPDIR: directory, TEMP: directory, TMP: directory };
}

async function prepare(directory) {
  const platform = `${process.platform}-${process.arch}`;
  const archive = manifest.archives[platform];
  if (!archive) throw new Error(`No pinned actionlint archive for ${platform}.`);
  const cache = path.join(__dirname, ".oracle-tools");
  fs.mkdirSync(cache, { recursive: true });
  const archivePath = path.join(cache, archive.file);
  const bytes = fs.existsSync(archivePath) ? fs.readFileSync(archivePath) :
    await download(manifest.release + archive.file);
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== archive.sha256) {
    throw new Error("Pinned actionlint archive SHA256 mismatch.");
  }
  if (!fs.existsSync(archivePath)) fs.writeFileSync(archivePath, bytes, { flag: "wx" });
  const executableName = process.platform === "win32" ? "actionlint.exe" : "actionlint";
  const result = spawnSync("tar", ["-xf", archivePath, "-C", directory, executableName], {
    env: nativeEnvironment(directory), encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Cannot extract pinned actionlint using tar: ${result.error?.message || result.stderr}`);
  }
  const executable = path.join(directory, executableName);
  const version = spawnSync(executable, ["-version"], {
    env: nativeEnvironment(directory), encoding: "utf8", timeout: 10000,
  });
  if (version.error || version.status !== 0 ||
      version.stdout.split(/\r?\n/)[0].trim() !== manifest.version) {
    throw new Error("Extracted actionlint did not report the pinned version.");
  }
  return executable;
}

module.exports = { prepare, nativeEnvironment };
