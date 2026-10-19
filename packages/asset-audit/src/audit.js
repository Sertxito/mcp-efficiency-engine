"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_FILES = 2000;
const MAX_ENTRIES = 20_000;
const MAX_FILE_BYTES = 256 * 1024;
const AUDIT_FILES = [
  ".github/copilot-instructions.md",
  ".vscode/mcp.json",
  ".vscode/mcp.jsonc",
  ".cursor/mcp.json",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".opencode/opencode.json",
  ".codex/config.toml",
];
const AUDIT_DIRECTORIES = [
  ".github/agents",
  ".github/skills",
  ".github/instructions",
  ".github/prompts",
  ".github/hooks",
  ".agents/skills",
  ".agents/instructions",
  ".claude/agents",
  ".claude/skills",
  ".cursor/rules",
  ".opencode/agents",
  ".opencode/skills",
];

function withinRoot(root, relative) {
  const absolute = path.resolve(root, relative);
  const fromRoot = path.relative(root, absolute);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error(`Audit path escapes the project: ${relative}`);
  }
  return absolute;
}

function hasSymlinkInPath(root, relative) {
  let current = root;
  for (const part of relative.split(/[\\/]/)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) return false;
    if (fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function collectFiles(root) {
  const files = new Set();
  const skipped = [];
  let entriesSeen = 0;
  for (const relative of AUDIT_FILES) {
    const absolute = withinRoot(root, relative);
    if (!fs.existsSync(absolute)) continue;
    if (hasSymlinkInPath(root, relative)) {
      skipped.push(relative);
      continue;
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      skipped.push(relative);
      continue;
    }
    files.add(relative);
  }

  for (const relative of AUDIT_DIRECTORIES) {
    const start = withinRoot(root, relative);
    if (!fs.existsSync(start)) continue;
    if (hasSymlinkInPath(root, relative)) {
      skipped.push(relative);
      continue;
    }
    const rootStat = fs.lstatSync(start);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      skipped.push(relative);
      continue;
    }
    const pending = [{ absolute: start, relative }];
    while (pending.length && files.size < MAX_FILES && entriesSeen < MAX_ENTRIES) {
      const current = pending.pop();
      const directory = fs.opendirSync(current.absolute);
      try {
        let entry = directory.readSync();
        while (entry && files.size < MAX_FILES && entriesSeen < MAX_ENTRIES) {
          entriesSeen += 1;
          const childAbsolute = path.join(current.absolute, entry.name);
          const childRelative = path.join(current.relative, entry.name).split(path.sep).join("/");
          if (entry.isSymbolicLink()) {
            skipped.push(childRelative);
          } else if (entry.isDirectory()) {
            pending.push({ absolute: childAbsolute, relative: childRelative });
          } else if (entry.isFile() && /\.(?:md|mdc|json|jsonc|ya?ml|toml|cjs|mjs|js)$/i.test(entry.name)) {
            files.add(childRelative);
          }
          entry = directory.readSync();
        }
      } finally {
        directory.closeSync();
      }
    }
  }
  return {
    files: [...files].sort(),
    skipped,
    entriesSeen,
    truncated: files.size >= MAX_FILES || entriesSeen >= MAX_ENTRIES,
  };
}

function finding(rule, severity, confidence, file, line, title, detail) {
  return { rule, severity, confidence, file, line, title, detail };
}

function auditTextFile(relative, content) {
  const findings = [];
  const lines = content.split(/\r?\n/);
  const secretPattern = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,})\b/;
  const assignmentPattern = /\b(?:api[_-]?key|access[_-]?(?:token|key)|client[_-]?secret|credential|password|secret|token)\b\s*[:=]\s*["']?([A-Za-z0-9_./+-]{12,})/i;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (secretPattern.test(line) ||
        (assignmentPattern.test(line) &&
         !/\b(?:example|placeholder|change[_-]?me|your[_-]|redacted|dummy)\b|\$\{|process\.env|env\(/i.test(line))) {
      findings.push(finding(
        "literal-credential",
        "high",
        8,
        relative,
        lineNumber,
        "Possible literal credential in harness configuration",
        "The matching line is intentionally omitted. Replace the value with a secret-manager or environment reference and rotate it if it was real.",
      ));
    }
    if (/\b(?:curl|wget)\b[^\r\n|]*\|\s*(?:sudo\s+)?(?:sh|bash)\b/i.test(line)) {
      findings.push(finding(
        "download-pipe-to-shell",
        "high",
        8,
        relative,
        lineNumber,
        "Remote content is piped directly to a shell",
        "Pin and verify the downloaded artifact, then execute it through a reviewed installation step.",
      ));
    }
    if (/\bnpx\b.*(?:--yes|-y)\b/i.test(line) &&
        !/\b[A-Za-z0-9_.-]+@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/.test(line)) {
      findings.push(finding(
        "unpinned-npx-package",
        "medium",
        7,
        relative,
        lineNumber,
        "Harness command invokes an npm package without an exact version",
        "Pin the package to an exact reviewed version and use an integrity-checked lock or artifact source where supported.",
      ));
    }
    if (/\b(?:bypassPermissions|dangerouslyDisableSandbox|allowDangerouslySkipPermissions)\b\s*["']?\s*[:=]\s*(?:true|"true"|'true')/i.test(line) ||
        /\bdefaultMode\b["']?\s*:\s*["']bypassPermissions["']/i.test(line) ||
        /\b(?:Bash|shell|terminal)\s*\(\s*\*\s*\)/i.test(line) ||
        /\b(?:tools|allow)\b["']?\s*:\s*\[\s*["']\*["']/i.test(line)) {
      findings.push(finding(
        "unrestricted-agent-authority",
        "high",
        8,
        relative,
        lineNumber,
        "Harness configuration appears to grant unrestricted execution",
        "Replace broad or bypass permissions with the narrowest tool/action allowlist and retain explicit approval for mutations.",
      ));
    }
  }

  if (/\/(?:agents|skills)\//i.test(`/${relative}/`) && /\.(?:md)$/i.test(relative)) {
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) {
      findings.push(finding(
        "missing-agent-frontmatter",
        "medium",
        9,
        relative,
        1,
        "Agent or skill asset has no YAML frontmatter",
        "Add frontmatter with a stable name and a discoverable description so the host can identify and route the asset.",
      ));
    } else {
      const yaml = frontmatter[1];
      if (!/^name:\s*\S+/m.test(yaml)) {
        findings.push(finding("missing-asset-name", "medium", 9, relative, 1, "Asset frontmatter has no name", "Add a stable name matching the asset's intended identity."));
      }
      if (!/^description:\s*\S+/m.test(yaml)) {
        findings.push(finding("missing-asset-description", "medium", 9, relative, 1, "Asset frontmatter has no description", "Add a concise description with the intended task and activation context."));
      }
    }
  }
  return findings;
}

function auditHarness(projectRoot) {
  const root = path.resolve(projectRoot);
  const { files, skipped, entriesSeen, truncated } = collectFiles(root);
  const findings = [];
  let oversized = 0;
  for (const relative of files) {
    const absolute = withinRoot(root, relative);
    if (hasSymlinkInPath(root, relative)) {
      skipped.push(relative);
      continue;
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      skipped.push(relative);
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      oversized += 1;
      continue;
    }
    findings.push(...auditTextFile(relative, fs.readFileSync(absolute, "utf8")));
  }
  findings.sort((a, b) =>
    ["critical", "high", "medium", "low"].indexOf(a.severity) -
      ["critical", "high", "medium", "low"].indexOf(b.severity) ||
    a.file.localeCompare(b.file) || a.line - b.line);
  return {
    schema_version: 1,
    generated_by: "mcpee",
    mode: "read-only-heuristic",
    scanned_files: files.length,
    scanned_directory_entries: entriesSeen,
    skipped_paths: [...new Set(skipped)].sort(),
    skipped_oversized_files: oversized,
    truncated,
    coverage: [
      "Only known project-local agent, skill, instruction, hook, and tool-configuration paths are scanned.",
      "Checks are static heuristics; absence of findings is not proof that a harness is safe.",
      "File contents and matched credential values are never included in findings.",
    ],
    findings,
    summary: {
      critical: findings.filter((item) => item.severity === "critical").length,
      high: findings.filter((item) => item.severity === "high").length,
      medium: findings.filter((item) => item.severity === "medium").length,
      low: findings.filter((item) => item.severity === "low").length,
    },
  };
}

module.exports = { auditHarness, MAX_FILES, MAX_FILE_BYTES };
