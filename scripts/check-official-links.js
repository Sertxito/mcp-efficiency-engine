"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const guidanceRoot = path.join(root, "instructions");
const officialHosts = [
  "learn.microsoft.com",
  "docs.python.org",
  "packaging.python.org",
  "nodejs.org",
  "docs.aws.amazon.com",
  "developer.hashicorp.com",
  "docs.github.com",
  "kubernetes.io",
  "angular.dev",
  "react.dev",
  "www.w3.org",
];
const urls = new Set();
const errors = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      const markdown = fs.readFileSync(absolute, "utf8")
        .replace(/^```[\s\S]*?^```.*$/gm, "");
      for (const match of markdown.matchAll(/https:\/\/[^\s)>]+/g)) {
        urls.add(match[0].replace(/[.,;]+$/, ""));
      }
    }
  }
}

function isOfficial(hostname) {
  return officialHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

async function checkUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    errors.push(`${url}: invalid URL (${error.message})`);
    return;
  }
  if (parsed.protocol !== "https:" || !isOfficial(parsed.hostname)) {
    errors.push(`${url}: not an approved HTTPS official documentation host`);
    return;
  }
  try {
    const response = await fetch(url, {
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (!response.ok) errors.push(`${url}: HTTP ${response.status}`);
  } catch (error) {
    errors.push(`${url}: ${error.message}`);
  }
}

walk(guidanceRoot);
Promise.all([...urls].map(checkUrl)).then(() => {
  if (errors.length) {
    process.stderr.write(`Unable to verify ${errors.length} official documentation URL(s):\n${errors.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Verified ${urls.size} official HTTPS documentation URLs.\n`);
  }
}).catch((error) => {
  process.stderr.write(`Official-link validation failed: ${error.message}\n`);
  process.exitCode = 1;
});
