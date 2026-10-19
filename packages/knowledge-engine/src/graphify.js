"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { discoverTools, invokeTool } = require("../../tool-manager/src/tools");
const { recordEvent } = require("../../core/src/telemetry");

const GRAPHIFY_DIRECTORY = ".mcpee/graphs/graphify";
const GRAPHIFY_STATE = ".mcpee/state/graphify.json";
const OWNERSHIP_MARKER = ".mcpee-owned";
const GRAPHIFY_TIMEOUT_MS = 15 * 60 * 1000;
const SEARCH_TOKENS = /[\p{L}\p{N}_$.-]{2,}/gu;

function safeProjectPath(root, relativePath, label) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) ||
      normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(`${label} path must stay inside the project: ${relativePath}`);
  }
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)) {
    throw new Error(`${label} path must stay inside the project: ${relativePath}`);
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`${label} path cannot follow a symbolic link: ${relativePath}`);
      }
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
      throw error;
    }
  }
  return absolute;
}

function atomicWrite(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

function writeState(root, state) {
  const statePath = safeProjectPath(root, GRAPHIFY_STATE, "Graphify state");
  if (fs.existsSync(statePath)) {
    const existing = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (existing.generated_by !== "mcpee") {
      throw new Error(`Refusing to overwrite non-MCPEE Graphify state: ${GRAPHIFY_STATE}`);
    }
  }
  atomicWrite(statePath, `${JSON.stringify({
    schema_version: 1,
    generated_by: "mcpee",
    ...state,
    updated_at: new Date().toISOString(),
  }, null, 2)}\n`);
}

function readGraphifyState(projectRoot) {
  const root = path.resolve(projectRoot);
  const statePath = safeProjectPath(root, GRAPHIFY_STATE, "Graphify state");
  if (!fs.existsSync(statePath)) return null;
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (state.generated_by !== "mcpee" || state.schema_version !== 1 ||
      !["ready", "unavailable", "failed"].includes(state.status)) {
    throw new Error(`Invalid or non-MCPEE Graphify state: ${GRAPHIFY_STATE}`);
  }
  return state;
}

function ensureOwnedOutput(root) {
  const directory = safeProjectPath(root, GRAPHIFY_DIRECTORY, "Graphify output");
  const marker = path.join(directory, OWNERSHIP_MARKER);
  if (fs.existsSync(directory)) {
    if (fs.lstatSync(directory).isSymbolicLink()) {
      throw new Error(`Refusing to use Graphify output through a symbolic link: ${directory}`);
    }
    if (fs.existsSync(marker) && fs.lstatSync(marker).isSymbolicLink()) {
      throw new Error(`Refusing to use Graphify ownership marker through a symbolic link: ${marker}`);
    }
    if (!fs.existsSync(marker) ||
        fs.readFileSync(marker, "utf8") !== "MCPEE-owned Graphify output\n") {
      throw new Error(`Refusing to overwrite an unowned Graphify output directory: ${directory}`);
    }
  } else {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(marker, "MCPEE-owned Graphify output\n", { encoding: "utf8", flag: "wx" });
  }
  return directory;
}

function localGraphifyTool(root, options) {
  if (options.installed !== undefined) {
    return options.installed
      ? { available: true, invokable: true }
      : { available: false, invokable: false };
  }
  const tool = (options.discoverTools || discoverTools)(root).tools.find((item) => item.id === "graphify");
  const installation = tool?.installation;
  const installedLocally = typeof installation?.environment === "string" &&
    typeof installation?.version === "string";
  return {
    available: Boolean(installedLocally && tool.available),
    invokable: Boolean(installedLocally && tool.invokable),
    reason: installedLocally && tool.available && !tool.invokable
      ? "The installed Graphify executable cannot be launched safely on this platform."
      : undefined,
  };
}

function graphCounts(graph) {
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes) ||
      !Array.isArray(graph.links)) {
    throw new Error("Graphify output must contain node and link arrays.");
  }
  if (graph.nodes.some((node) => !node || typeof node !== "object" ||
        typeof node.id !== "string" || !node.id || typeof node.label !== "string") ||
      graph.links.some((link) => !link || typeof link !== "object" ||
        typeof link.source !== "string" || typeof link.target !== "string")) {
    throw new Error("Graphify output contains an invalid node or link.");
  }
  return { node_count: graph.nodes.length, edge_count: graph.links.length };
}

function updateGraphifyGraph(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const tool = localGraphifyTool(root, options);
  if (!tool.available || !tool.invokable) {
    const state = {
      status: "unavailable",
      operation: "skipped",
      graph_directory: GRAPHIFY_DIRECTORY,
      reason: tool.reason || "Graphify is not installed in this project's isolated tool directory.",
    };
    writeState(root, state);
    recordEvent(root, {
      event_name: "knowledge.graphify.completed",
      attributes: { status: state.status, operation: state.operation },
    });
    return state;
  }

  try {
    const outputDirectory = ensureOwnedOutput(root);
    const graphPath = path.join(outputDirectory, "graph.json");
    const updating = fs.existsSync(graphPath);
    const args = [
      "extract",
      root,
      "--code-only",
      "--out",
      outputDirectory,
      ...(updating ? ["--update"] : []),
    ];
    const result = (options.invokeTool || invokeTool)(root, "graphify", args, {
      cwd: root,
      timeoutMs: options.timeoutMs || GRAPHIFY_TIMEOUT_MS,
      env: {
        GRAPHIFY_OUT: outputDirectory,
        DO_NOT_TRACK: "1",
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
        DEEPSEEK_API_KEY: "",
        KIMI_API_KEY: "",
        AZURE_OPENAI_API_KEY: "",
        AWS_ACCESS_KEY_ID: "",
        AWS_SECRET_ACCESS_KEY: "",
      },
    });
    if (result.status !== "success") {
      throw new Error(result.error || result.stderr?.trim() ||
        `Graphify exited with code ${result.exit_code ?? "unknown"}`);
    }
    if (!fs.existsSync(graphPath) || fs.lstatSync(graphPath).isSymbolicLink()) {
      throw new Error("Graphify completed without producing a safe graph.json.");
    }
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    const counts = graphCounts(graph);
    const state = {
      status: "ready",
      operation: updating ? "update-code-only" : "build-code-only",
      graph_directory: GRAPHIFY_DIRECTORY,
      graph_file: `${GRAPHIFY_DIRECTORY}/graph.json`,
      graph_sha256: crypto.createHash("sha256").update(fs.readFileSync(graphPath)).digest("hex"),
      graphify_version: graph.graph?.graphify_version || null,
      ...counts,
    };
    writeState(root, state);
    recordEvent(root, {
      event_name: "knowledge.graphify.completed",
      attributes: {
        status: state.status,
        operation: state.operation,
        node_count: state.node_count,
        edge_count: state.edge_count,
        mode: "code-only",
      },
    });
    return state;
  } catch (error) {
    const state = {
      status: "failed",
      operation: "code-only",
      graph_directory: GRAPHIFY_DIRECTORY,
      error: error.message,
    };
    writeState(root, state);
    recordEvent(root, {
      event_name: "knowledge.graphify.completed",
      attributes: { status: state.status, operation: state.operation, error: error.message },
    });
    return state;
  }
}

function searchGraphify(projectRoot, query, limit = 10) {
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("Graphify query must not be empty.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Graphify result limit must be an integer between 1 and 100.");
  }
  const root = path.resolve(projectRoot);
  const state = readGraphifyState(root);
  if (state?.status !== "ready") return [];
  const graphPath = safeProjectPath(root, `${GRAPHIFY_DIRECTORY}/graph.json`, "Graphify graph");
  if (!fs.existsSync(graphPath) || fs.lstatSync(graphPath).isSymbolicLink()) {
    throw new Error("Graphify graph is missing or unsafe; run mcpee sync to rebuild it.");
  }
  const bytes = fs.readFileSync(graphPath);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== state.graph_sha256) {
    throw new Error("Graphify graph changed outside MCPEE; run mcpee sync before searching it.");
  }
  const graph = JSON.parse(bytes.toString("utf8"));
  graphCounts(graph);
  const queryTerms = new Set(query.toLocaleLowerCase().match(SEARCH_TOKENS) || []);
  if (!queryTerms.size) return [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const linksByNode = new Map();
  for (const link of graph.links) {
    for (const nodeId of [link.source, link.target]) {
      const links = linksByNode.get(nodeId) || [];
      links.push(link);
      linksByNode.set(nodeId, links);
    }
  }
  const matches = [];
  for (const node of graph.nodes) {
    if (typeof node.label !== "string") continue;
    const label = node.label.toLocaleLowerCase();
    const source = typeof node.source_file === "string" ? node.source_file
      : typeof node.file_path === "string" ? node.file_path
        : typeof node.filePath === "string" ? node.filePath : null;
    const tokens = new Set(`${label} ${source || ""}`.match(SEARCH_TOKENS) || []);
    let score = 0;
    for (const term of queryTerms) {
      if (tokens.has(term)) score += 2;
      else if (label.includes(term)) score += 1;
    }
    if (!score || !source) continue;
    const relative = source.replace(/\\/g, "/");
    const absolute = path.isAbsolute(source) || /^[A-Za-z]:[\\/]/.test(source)
      ? path.resolve(source)
      : path.resolve(root, source);
    const relativeToRoot = path.relative(root, absolute);
    if (!relativeToRoot || relativeToRoot === ".." ||
        relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) continue;
    const normalizedPath = relativeToRoot.split(path.sep).join("/");
    const sourcePath = safeProjectPath(root, normalizedPath, "Graphify source");
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;
    const relations = (linksByNode.get(node.id) || []).slice(0, 5).flatMap((link) => {
      const neighborId = link.source === node.id ? link.target : link.source;
      const neighbor = nodesById.get(neighborId);
      return neighbor && typeof neighbor.label === "string"
        ? [{ relation: link.relation || link.type || "connected", symbol: neighbor.label,
          confidence: link.confidence || "EXTRACTED" }]
        : [];
    });
    matches.push({
      source_path: normalizedPath,
      symbol: node.label,
      symbol_kind: node.kind || node.type || null,
      start_line: node.start_line ?? node.line ?? null,
      score,
      relations,
    });
  }
  return matches.sort((left, right) => right.score - left.score ||
    left.source_path.localeCompare(right.source_path) || left.symbol.localeCompare(right.symbol))
    .slice(0, limit);
}

module.exports = {
  GRAPHIFY_DIRECTORY,
  GRAPHIFY_STATE,
  readGraphifyState,
  searchGraphify,
  updateGraphifyGraph,
};
