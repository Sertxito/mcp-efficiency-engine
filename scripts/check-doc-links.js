"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([
  ".codegraph", ".git", ".mcpee", "build", "dist", "node_modules",
]);
const ignoredPaths = new Set([
  "docs/generated",
  "knowledge/extracted",
  "knowledge/generated",
  "knowledge/normalized",
  "knowledge/traceability",
]);
const markdownFiles = [];
const problems = [];

function walk(directory, relativeDirectory = "") {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name.toLowerCase()) &&
          !ignoredPaths.has(relative.replace(/\\/g, "/").toLowerCase())) {
        walk(absolute, relative);
      }
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      markdownFiles.push(absolute);
    }
  }
}

function anchorsFor(contents) {
  const anchors = new Set();
  const counts = new Map();
  const markdown = contents
    .replace(/^```[\s\S]*?^```.*$/gm, "")
    .replace(/`[^`\r\n]*`/g, "");
  for (const match of markdown.matchAll(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm)) {
    const heading = match[2]
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .trim()
      .toLowerCase();
    const slug = heading
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s/g, "-")
      .replace(/-+/g, "-");
    const occurrence = counts.get(slug) ?? 0;
    counts.set(slug, occurrence + 1);
    anchors.add(occurrence === 0 ? slug : `${slug}-${occurrence}`);
  }
  for (const match of markdown.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) {
    anchors.add(decodeURIComponent(match[1]));
  }
  return anchors;
}

function resolveMarkdownTarget(sourceFile, target) {
  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return { error: `invalid URL encoding: ${target}` };
  }
  const [pathname, rawAnchor = ""] = decoded.split("#", 2);
  const localTarget = pathname
    ? (pathname.startsWith("/")
      ? path.resolve(root, `.${pathname}`)
      : path.resolve(path.dirname(sourceFile), pathname))
    : sourceFile;
  if (localTarget !== root &&
      !localTarget.startsWith(`${root}${path.sep}`)) {
    return { error: `target escapes MCPEE: ${target}` };
  }
  let resolved = localTarget;
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const readme = ["README.md", "readme.md", "index.md"]
      .map((name) => path.join(resolved, name))
      .find((candidate) => fs.existsSync(candidate));
    if (readme) resolved = readme;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { error: `missing target: ${target}` };
  }
  if (rawAnchor && /\.md$/i.test(resolved)) {
    const anchors = anchorsFor(fs.readFileSync(resolved, "utf8"));
    if (!anchors.has(rawAnchor)) {
      return { error: `missing anchor '#${rawAnchor}' in ${path.relative(root, resolved)}` };
    }
  }
  return {};
}

walk(root);
const contentByFile = new Map();
for (const sourceFile of markdownFiles) {
  const raw = fs.readFileSync(sourceFile, "utf8");
  if (path.relative(root, sourceFile).startsWith(`instructions${path.sep}`)) {
    const normalized = raw.replace(/\*/g, "").replace(/\s+/g, " ");
    const hasScope = /\bScope:/i.test(normalized);
    const hasVersionBoundary = /\bVersion boundary:/i.test(normalized);
    const hasReviewDate = /\bReferences checked:\s*\d{4}-\d{2}-\d{2}\b/i.test(normalized);
    const hasOfficialReferences = /Official references:/i.test(raw) && /https:\/\//i.test(raw);
    if (!hasScope || !hasVersionBoundary || !hasReviewDate || !hasOfficialReferences) {
      problems.push(`${path.relative(root, sourceFile)}: missing scope, version boundary, dated review, or official references`);
    }
  }
  const content = raw
    .replace(/^```[\s\S]*?^```.*$/gm, "")
    .replace(/`[^`\r\n]*`/g, "");
  contentByFile.set(sourceFile, content);
}

for (const [sourceFile, content] of contentByFile) {
  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    const result = resolveMarkdownTarget(sourceFile, target);
    if (result.error) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      problems.push(`${path.relative(root, sourceFile)}:${line}: ${result.error}`);
    }
  }
}

if (problems.length) {
  process.stderr.write(`Found ${problems.length} broken local Markdown link(s):\n${problems.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated local Markdown links and anchors in ${markdownFiles.length} files and guidance metadata in ${markdownFiles.filter((file) => path.relative(root, file).startsWith(`instructions${path.sep}`)).length} guides.\n`);
}
