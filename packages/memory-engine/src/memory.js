"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { recordEvent, redact } = require("../../core/src/telemetry");

const MEMORY_FILE = ".mcpee/memory/entries.jsonl";
const MEMORY_KINDS = new Set(["decision", "constraint", "pattern", "insight"]);
const TOKEN_PATTERN = /[\p{L}\p{N}_-]{2,}/gu;

function sourceEvidence(projectRoot, sources, expectedSources = []) {
  if (!Array.isArray(sources) || sources.length === 0 ||
      sources.some((source) => typeof source !== "string" || !source.trim())) {
    throw new Error("Memory requires at least one source path inside the project");
  }
  const root = path.resolve(projectRoot);
  const expectedByPath = new Map(expectedSources.map((source) => [source.path, source.sha256]));
  return sources.map((source) => {
    if (path.isAbsolute(source) || /^[A-Za-z]:[\\/]/.test(source) || /^\\\\/.test(source)) {
      throw new Error(`Memory source must be project-relative: ${source}`);
    }
    const normalized = source.replace(/\\/g, "/");
    const absolute = path.resolve(root, source);
    const relative = path.relative(root, absolute);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`Memory source must remain inside the project: ${source}`);
    }
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if (!fs.existsSync(current)) throw new Error(`Memory source does not exist: ${source}`);
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Memory source cannot follow symbolic links: ${source}`);
      }
    }
    if (!fs.statSync(absolute).isFile()) throw new Error(`Memory source is not a file: ${source}`);
    const bytes = fs.readFileSync(absolute);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    const expectedDigest = expectedByPath.get(normalized);
    if (expectedDigest && expectedDigest !== digest) {
      throw new Error(`Memory evidence changed since evaluation: ${source}`);
    }
    return { path: normalized, sha256: digest };
  });
}

function addMemory(projectRoot, { kind, text, sources = [], expectedSources = [], evaluationId = null }) {
  if (!MEMORY_KINDS.has(kind)) {
    throw new Error(`Unsupported memory kind '${kind}'. Use: ${[...MEMORY_KINDS].join(", ")}`);
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Memory text must not be empty");
  }
  if (evaluationId !== null && (typeof evaluationId !== "string" || !evaluationId.trim())) {
    throw new Error("Memory evaluationId must be a non-empty string when provided");
  }
  const evidence = sourceEvidence(projectRoot, sources, expectedSources);
  const entry = {
    schema_version: 1,
    id: crypto.randomUUID(),
    kind,
    text: redact(text),
    sources: evidence,
    evaluation_id: evaluationId,
    created_at: new Date().toISOString(),
  };
  const destination = path.join(projectRoot, MEMORY_FILE);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.appendFileSync(destination, `${JSON.stringify(entry)}\n`, "utf8");
  recordEvent(projectRoot, {
    event_name: "memory.entry_added",
    attributes: { kind, source_count: evidence.length, evaluation_id: evaluationId },
  });
  return entry;
}

function searchMemory(projectRoot, query, limit = 10) {
  if (typeof query !== "string" || query.trim().length === 0) throw new Error("Memory search query must not be empty");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Memory search limit must be an integer between 1 and 100");
  const queryTerms = new Set(query.toLowerCase().match(TOKEN_PATTERN) || []);
  const ranked = listMemory(projectRoot).map((entry) => {
    const text = `${entry.kind} ${entry.text} ${(entry.sources || []).map((source) =>
      typeof source === "string" ? source : source.path).join(" ")}`.toLowerCase();
    const terms = text.match(TOKEN_PATTERN) || [];
    let score = 0;
    for (const term of terms) if (queryTerms.has(term)) score += 1;
    const evidence = (entry.sources || []).map((source) => {
      const reference = typeof source === "string" ? { path: source, sha256: null } : source;
      const absolute = path.resolve(projectRoot, reference.path);
      const root = path.resolve(projectRoot);
      const relative = path.relative(root, absolute);
      let status = "missing";
      if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && fs.existsSync(absolute)) {
        try {
          let current = root;
          const safe = relative.split(path.sep).filter(Boolean).every((segment) => {
            current = path.join(current, segment);
            return !fs.lstatSync(current).isSymbolicLink();
          });
          if (safe && fs.statSync(absolute).isFile()) {
            const bytes = fs.readFileSync(absolute);
            const digest = crypto.createHash("sha256").update(bytes).digest("hex");
            status = !reference.sha256 || digest === reference.sha256 ? "current" : "changed";
          }
        } catch (error) {
          if (error.code !== "ENOENT" && error.code !== "EISDIR" && error.code !== "ENOTDIR") throw error;
        }
      }
      return { ...reference, status };
    });
    return { ...entry, score, evidence_status: evidence };
  }).filter((entry) => entry.score > 0);
  return ranked.sort((left, right) => right.score - left.score || right.created_at.localeCompare(left.created_at))
    .slice(0, limit);
}

function listMemory(projectRoot, kind) {
  if (kind && !MEMORY_KINDS.has(kind)) {
    throw new Error(`Unsupported memory kind '${kind}'. Use: ${[...MEMORY_KINDS].join(", ")}`);
  }
  const source = path.join(projectRoot, MEMORY_FILE);
  if (!fs.existsSync(source)) return [];
  return fs.readFileSync(source, "utf8").split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      throw new Error(`Corrupt memory JSONL at ${source}:${index + 1}: ${error.message}`);
    }
    if (entry.schema_version !== 1 || typeof entry.id !== "string" ||
        !MEMORY_KINDS.has(entry.kind) || typeof entry.text !== "string") {
      throw new Error(`Invalid memory record at ${source}:${index + 1}`);
    }
    return !kind || entry.kind === kind ? [entry] : [];
  });
}

module.exports = { MEMORY_FILE, MEMORY_KINDS, addMemory, listMemory, searchMemory, sourceEvidence };
