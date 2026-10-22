"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { recordEvent, readEvents } = require("../../core/src/telemetry");
const { maskCode } = require("../../core/src/syntax");

const GRAPH_PATH = ".mcpee/graphs/unified/graph.json";
const MAX_RESULTS = 100;
const LOCAL_MODULE_EXTENSIONS = [
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py",
  ".json", ".jsonc", ".json5", ".css", ".scss", ".less", ".html", ".svg",
];
const LOCAL_MODULE_INDEX_EXTENSIONS = LOCAL_MODULE_EXTENSIONS.slice(0, 9);

function stableId(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function assertSafeProjectPath(root, relative, label, options = {}) {
  const normalized = relative.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) ||
      normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(`${label} path must stay inside the project: ${relative}`);
  }
  const absolute = path.resolve(root, normalized);
  const resolvedRelative = path.relative(root, absolute);
  if (!resolvedRelative || resolvedRelative === ".." ||
      resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)) {
    throw new Error(`${label} path must stay inside the project: ${relative}`);
  }
  let current = root;
  for (const segment of resolvedRelative.split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (options.allowMissing && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
        break;
      }
      if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        throw new Error(`${label} path does not exist: ${relative}`);
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} path cannot follow a symbolic link: ${relative}`);
    }
  }
  return absolute;
}

function readExtractedMetadata(root, source) {
  if (!["processed", "unchanged"].includes(source.status)) return null;
  if (typeof source.extracted_path !== "string" ||
      !source.extracted_path.replace(/\\/g, "/").startsWith("knowledge/extracted/")) {
    throw new Error(`Processed source has no valid extracted metadata path: ${source.path}`);
  }
  const metadataPath = assertSafeProjectPath(root, source.extracted_path, "Extracted metadata");
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read extracted metadata for ${source.path}: ${error.message}`);
  }
  if (metadata.generated_by !== "mcpee" || metadata.source_path !== source.path ||
      metadata.sha256 !== source.sha256) {
    throw new Error(`Extracted metadata does not match source manifest evidence: ${source.path}`);
  }
  return metadata;
}

function addNode(nodes, node) {
  nodes.set(node.id, node);
}

function markdownLinks(text) {
  const links = [];
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = "";
  for (const [lineIndex, line] of lines.entries()) {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;
    const pattern = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
    for (const match of line.matchAll(pattern)) {
      const target = match[1] || match[2];
      if (!target || target.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) ||
          target.startsWith("//")) continue;
      let decodedTarget;
      try {
        decodedTarget = decodeURIComponent(target);
      } catch {
        continue;
      }
      const [targetPath] = decodedTarget.split(/[?#]/, 1);
      if (!targetPath) continue;
      links.push({ targetPath, line: lineIndex + 1 });
    }
  }
  return links;
}

function localModuleReferences(text) {
  const references = [];
  const codeLines = maskCode(text).split(/\r?\n/);
  const pattern = /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s*)?["'](\.{1,2}\/[^"']+)["']|\brequire\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    if (/^\s*(?:\/\/|\/\*|\*|#)/.test(line)) continue;
    const namedImport = line.match(/\bimport\s+(?:type\s+)?\{([^}]+)\}\s+from\s*["'](\.{1,2}\/[^"']+)["']/);
    const destructuredRequire = line.match(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/);
    const binding = [namedImport, destructuredRequire].find((match) =>
      match && /\b(?:import|const|let|var)\b/.test(codeLines[lineIndex].slice(match.index, match.index + 12)));
    const importedSymbols = binding
      ? binding[1].split(",").flatMap((specifier) => {
        const match = specifier.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+[A-Za-z_$][\w$]*)?$/);
        return match ? [match[1]] : [];
      })
      : [];
    for (const match of line.matchAll(pattern)) {
      if (!/^(?:import|export|require)\b/.test(codeLines[lineIndex].slice(match.index))) continue;
      const targetPath = match[1] || match[2];
      if (targetPath) references.push({
        targetPath,
        line: lineIndex + 1,
        ...(binding && binding[2] === targetPath && importedSymbols.length
          ? { imported_symbols: importedSymbols }
          : {}),
      });
    }
  }
  return references;
}

function pythonModuleReferences(text) {
  const references = [];
  const maskedLines = [];
  let tripleQuote = null;
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    let line = "";
    for (let index = 0; index < rawLine.length;) {
      if (tripleQuote) {
        if (rawLine.startsWith(tripleQuote, index)) {
          line += "   ";
          index += 3;
          tripleQuote = null;
        } else {
          if (rawLine[index] === "\\") index += 1;
          line += " ";
          index += 1;
        }
        continue;
      }
      const character = rawLine[index];
      if (character === "#") break;
      if (character === "'" || character === '"') {
        const marker = character.repeat(3);
        if (rawLine.startsWith(marker, index)) {
          tripleQuote = marker;
          line += "   ";
          index += 3;
          continue;
        }
        line += " ";
        index += 1;
        while (index < rawLine.length) {
          if (rawLine[index] === "\\") {
            line += "  ";
            index += 2;
          } else if (rawLine[index] === character) {
            line += " ";
            index += 1;
            break;
          } else {
            line += " ";
            index += 1;
          }
        }
        continue;
      }
      line += character;
      index += 1;
    }

    maskedLines.push(line);
  }

  for (let lineIndex = 0; lineIndex < maskedLines.length; lineIndex += 1) {
    const sourceLine = lineIndex + 1;
    let statement = maskedLines[lineIndex].trim();
    if (!/^(?:import|from)\b/.test(statement)) continue;
    while (statement.endsWith("\\")) {
      statement = statement.slice(0, -1).trimEnd();
      lineIndex += 1;
      if (lineIndex >= maskedLines.length) break;
      statement += ` ${maskedLines[lineIndex].trim()}`;
    }

    const imported = statement.match(/^import\s+(.+?)\s*$/);
    if (imported) {
      for (const moduleText of imported[1].split(",")) {
        const module = moduleText.trim().split(/\s+as\s+/i, 1)[0];
        if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(module)) {
          references.push({ module, relative_level: 0, line: sourceLine });
        }
      }
      continue;
    }
    const from = statement.match(/^from\s+(\.*)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)?\s+import\b/);
    if (!from) continue;
    const dots = from[1].length;
    const module = from[2] || "";
    if (dots || module) references.push({ module, relative_level: dots, line: sourceLine });
  }
  return references;
}

function resolvePythonModuleReference(sourcePath, reference, knownPaths) {
  const modulePath = reference.module.replace(/\./g, "/");
  let base;
  if (reference.relative_level > 0) {
    const directory = path.posix.dirname(sourcePath);
    const segments = directory === "." ? [] : directory.split("/");
    for (let level = 1; level < reference.relative_level; level += 1) {
      if (!segments.length) return null;
      segments.pop();
    }
    base = path.posix.join(...segments, modulePath);
  } else {
    const suffix = modulePath ? `/${modulePath}` : "";
    const matches = [...knownPaths].filter((candidate) =>
      (candidate === `${modulePath}.py` || candidate === `${modulePath}/__init__.py` ||
        candidate.endsWith(`${suffix}.py`) || candidate.endsWith(`${suffix}/__init__.py`)) &&
      (modulePath || candidate.endsWith("/__init__.py")));
    return matches.length === 1 ? matches[0] : null;
  }
  const candidates = modulePath
    ? [`${base}.py`, `${base}/__init__.py`]
    : [`${base}/__init__.py`];
  const matches = candidates.filter((candidate) => knownPaths.has(candidate));
  return matches.length === 1 ? matches[0] : null;
}

function domainFileReferences(text, category) {
  const references = [];
  const patterns = {
    infrastructure: [
      { pattern: /\bsource\s*=\s*["'](\.{1,2}\/[^"']+)["']/g, edgeType: "declares_local_module", directory: true },
      { pattern: /\bmodule\s+[A-Za-z0-9_-]+\s+["'](\.{1,2}\/[^"']+\.bicep)["']/g, edgeType: "declares_local_module", directory: false },
    ],
    "api-contracts": [
      { pattern: /\$ref\s*:\s*["']?(\.{1,2}\/[^"' \t\r\n]+)/g, edgeType: "references_api_schema", directory: false },
    ],
    pipelines: [
      { pattern: /\buses:\s*["']?(\.{1,2}\/[^"' \t\r\n#]+)/g, edgeType: "uses_local_action", directory: true, rootRelative: true },
    ],
    configuration: [
      { pattern: /["']?\$ref["']?\s*:\s*["']?(\.{1,2}\/[^"' \t\r\n]+)/g, edgeType: "references_local_schema", directory: false },
    ],
  };
  for (const { pattern, edgeType, directory, rootRelative } of patterns[category] || []) {
    for (const match of text.matchAll(pattern)) {
      const prefix = text.slice(0, match.index);
      const line = prefix.split(/\r?\n/).length;
      references.push({ targetPath: match[1], line, edgeType, directory, rootRelative: Boolean(rootRelative) });
    }
  }
  return references;
}

function sqlTableReferences(text) {
  const identifier = String.raw`(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z_][\w$#]*))`;
  const readIdentifier = (match, start) => match.slice(start, start + 3).find(Boolean);
  const tables = [];
  const foreignKeys = [];
  const patterns = [
    {
      expression: new RegExp(String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${identifier})(?:\s*\.\s*(${identifier}))?`, "gi"),
      kind: "table",
    },
    {
      expression: new RegExp(String.raw`\bREFERENCES\s+(${identifier})(?:\s*\.\s*(${identifier}))?`, "gi"),
      kind: "reference",
    },
  ];
  for (const { expression, kind } of patterns) {
    for (const match of text.matchAll(expression)) {
      const first = readIdentifier(match, 2);
      const second = readIdentifier(match, 6);
      const table = second || first;
      const schema = second ? first : null;
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      (kind === "table" ? tables : foreignKeys).push({ schema, table, line });
    }
  }
  return { tables, foreignKeys };
}

function dotnetProjectReferences(text, sourcePath) {
  const references = [];
  const addMatches = (pattern, edgeType) => {
    for (const match of text.matchAll(pattern)) {
      references.push({
        targetPath: match[1].replace(/\\/g, "/"),
        line: text.slice(0, match.index).split(/\r?\n/).length,
        edgeType,
        directory: false,
        rootRelative: false,
      });
    }
  };
  if (/\.slnx$/i.test(sourcePath)) {
    addMatches(/<Project\b[^>]*\bPath\s*=\s*["']([^"']+\.(?:csproj|fsproj|vbproj))["']/gi, "contains_dotnet_project");
  } else if (/\.sln$/i.test(sourcePath)) {
    addMatches(/Project\([^)]*\)\s*=\s*"[^"]*"\s*,\s*"([^"]+\.(?:csproj|fsproj|vbproj))"/gi, "contains_dotnet_project");
  } else {
    addMatches(/<ProjectReference\b[^>]*\bInclude\s*=\s*["']([^"']+\.(?:csproj|fsproj|vbproj))["']/gi, "references_dotnet_project");
    addMatches(/<Import\b[^>]*\bProject\s*=\s*["']([^"']+\.(?:props|targets))["']/gi, "imports_build_file");
  }
  return references;
}

function packageManifestDependencies(text) {
  const manifest = JSON.parse(text);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const references = [];
  for (const section of sections) {
    const dependencies = manifest[section];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === "string" &&
          (version.startsWith("workspace:") || version.startsWith("file:") || version.startsWith("link:"))) {
        const sectionExpression = new RegExp(`${JSON.stringify(section)}\\s*:\\s*\\{([^}]*)\\}`, "s");
        const sectionMatch = sectionExpression.exec(text);
        const escapedName = JSON.stringify(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const escapedVersion = JSON.stringify(version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const dependencyMatch = sectionMatch &&
          new RegExp(`${escapedName}\\s*:\\s*${escapedVersion}`).exec(sectionMatch[1]);
        if (!sectionMatch || !dependencyMatch) {
          throw new Error(`Cannot locate ${section} dependency evidence for ${name}`);
        }
        const evidenceOffset = sectionMatch.index + sectionMatch[0].indexOf(sectionMatch[1]) + dependencyMatch.index;
        const line = text.slice(0, evidenceOffset).split(/\r?\n/).length;
        references.push({
          packageName: name,
          version,
          line,
        });
      }
    }
  }
  return {
    name: typeof manifest.name === "string" && manifest.name.trim() ? manifest.name : null,
    references,
  };
}

function documentedClaims(text, source) {
  const claims = [];
  let inFence = false;
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (/^\s*(```+|~~~+)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line) continue;
    const anchors = [...line.matchAll(/`([^`\r\n]{1,100})`/g)]
      .map((match) => match[1].trim().toLocaleLowerCase("en-US"))
      .filter((anchor) => /[a-z]/i.test(anchor) && !/\s/.test(anchor));
    if (!anchors.length) continue;
    const lower = line.toLocaleLowerCase("en-US");
    const statements = [
      {
        topic: "requirement",
        positive: /\b(?:required|mandatory|must(?:\s+(?:be|remain))?|obligatorio(?:s)?|debe(?:n)?)\b/i,
        negative: /\b(?:optional|not required|must not(?:\s+be)?|opcional(?:es)?|no\s+(?:es\s+)?obligatorio(?:s)?)\b/i,
      },
      {
        topic: "availability",
        positive: /\b(?:enabled|active|available|habilitado(?:s)?|activo(?:s)?|disponible(?:s)?)\b/i,
        negative: /\b(?:disabled|inactive|unavailable|not enabled|deshabilitado(?:s)?|inactivo(?:s)?|no\s+disponible(?:s)?)\b/i,
      },
      {
        topic: "support",
        positive: /\b(?:supported|support(?:ed)?|compatible|soportado(?:s)?|compatible)\b/i,
        negative: /\b(?:unsupported|not supported|incompatible|no soportado(?:s)?|no compatible)\b/i,
      },
      {
        topic: "permission",
        positive: /\b(?:allowed|permitted|autorizado(?:s)?|permitido(?:s)?|allowed)\b/i,
        negative: /\b(?:forbidden|prohibited|not allowed|denied|prohibido(?:s)?|no permitido(?:s)?)\b/i,
      },
    ];
    for (const statement of statements) {
      const negative = statement.negative.test(lower);
      const positive = statement.positive.test(lower.replace(statement.negative, " "));
      if (positive === negative) continue;
      const value = positive ? "positive" : "negative";
      for (const anchor of new Set(anchors)) {
        claims.push({
          source_path: source.path,
          line: index + 1,
          sha256: source.sha256 || null,
          anchor,
          topic: statement.topic,
          value,
        });
      }
    }
  }
  return claims;
}

function capabilityFlag(value) {
  return /(?:feature|enabled?|available|supported|allowed|optional|required|active|disabled|forbidden)/i.test(value);
}

function booleanClaims(text, source, category) {
  const claims = [];
  const patterns = category === "configuration"
    ? [/^\s*(?:["']?)([A-Za-z][\w.-]*)(?:["']?)\s*:\s*(true|false)\s*,?\s*(?:#.*)?$/i]
    : category === "source-code"
      ? [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*boolean)?\s*=\s*(true|false)\b/]
      : [
        /\bassert(?:\.strict)?\.(?:equal|strictEqual|deepEqual)\(\s*([A-Za-z_$][\w$]*)\s*,\s*(true|false)\s*\)/,
        /\bexpect\(\s*([A-Za-z_$][\w$]*)\s*\)\.(?:toBe|toEqual)\(\s*(true|false)\s*\)/,
      ];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (/^\s*(?:\/\/|\/\*|\*|#)/.test(line)) continue;
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match || !capabilityFlag(match[1])) continue;
      claims.push({
        source_path: source.path,
        line: index + 1,
        sha256: source.sha256 || null,
        anchor: match[1].toLocaleLowerCase("en-US"),
        topic: "availability",
        value: match[2].toLowerCase() === "true" ? "positive" : "negative",
      });
      break;
    }
  }
  return claims;
}

function latestCodeGraphRuntimeClaim(projectRoot) {
  const sourcePath = ".mcpee/telemetry/events/copilot.jsonl";
  const events = readEvents(projectRoot);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.event_name !== "knowledge.codegraph.completed" ||
        !["ready", "failed"].includes(event.attributes?.status)) continue;
    const serialized = JSON.stringify(event);
    return [{
      source_path: sourcePath,
      evidence_kind: "telemetry_event",
      line: index + 1,
      sha256: crypto.createHash("sha256").update(serialized).digest("hex"),
      anchor: "codegraph",
      topic: "availability",
      value: event.attributes.status === "ready" ? "positive" : "negative",
    }];
  }
  return [];
}

function resolveKnownSourcePath(root, sourcePath, targetPath, knownPaths) {
  const pathOnly = targetPath.split(/[?#]/, 1)[0];
  const targetAbsolute = path.resolve(root, path.dirname(sourcePath), pathOnly);
  const relativeTarget = path.relative(root, targetAbsolute);
  if (!relativeTarget || relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeTarget)) return null;
  const target = relativeTarget.split(path.sep).join("/");
  const candidates = [target];
  const extension = path.posix.extname(target);
  const extensionReplacements = {
    ".js": [".ts", ".tsx"],
    ".jsx": [".tsx"],
    ".mjs": [".mts"],
    ".cjs": [".cts"],
  };
  for (const replacement of extensionReplacements[extension] || []) {
    candidates.push(`${target.slice(0, -extension.length)}${replacement}`);
  }
  if (!extension) {
    for (const candidateExtension of LOCAL_MODULE_EXTENSIONS) {
      candidates.push(`${target}${candidateExtension}`);
    }
    for (const candidateExtension of LOCAL_MODULE_INDEX_EXTENSIONS) {
      candidates.push(`${target}/index${candidateExtension}`);
    }
  }
  return candidates.find((candidate) => knownPaths.has(candidate)) || null;
}

function missingLocalReference(root, sourcePath, reference, referenceBase = sourcePath, evidenceSource = reference.source) {
  const targetPath = reference.targetPath.split(/[?#]/, 1)[0];
  const absoluteTarget = path.resolve(root, path.dirname(referenceBase), targetPath);
  const relativeTarget = path.relative(root, absoluteTarget);
  if (!relativeTarget || relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeTarget) || fs.existsSync(absoluteTarget)) return null;
  return {
    id: stableId(`missing-local-reference:${sourcePath}:${reference.line}:${relativeTarget}`),
    type: "missing_local_reference",
    status: "needs_review",
    source_path: sourcePath,
    target_path: relativeTarget.split(path.sep).join("/"),
    line: reference.line,
    sha256: evidenceSource?.sha256 || null,
  };
}

function buildUnifiedGraph(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const manifestPath = path.join(root, "knowledge/traceability/source-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Source manifest is missing; run mcpee sync before building the unified graph.");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.generated_by !== "mcpee" || !Array.isArray(manifest.sources)) {
    throw new Error("Source manifest is invalid or not owned by MCPEE; refusing to build the unified graph.");
  }

  const nodes = new Map();
  const edges = [];
  const findings = [];
  const categories = new Set();
  const sourceIdsByPath = new Map();
  const sourceCategoriesByPath = new Map();
  const symbolIdsBySourcePath = new Map();
  const markdownReferences = [];
  const moduleReferences = [];
  const pythonReferences = [];
  const domainReferences = [];
  const packageReferences = [];
  const packageManifestsByName = new Map();
  const databaseDeclarations = [];
  const databaseReferences = [];
  const databaseTables = new Map();
  const sourceClaims = [];
  sourceClaims.push(...latestCodeGraphRuntimeClaim(root));
  const projectId = stableId("project");
  addNode(nodes, { id: projectId, type: "project", label: path.basename(root) });
  const relationshipProvenance = (type) => {
    if (["contains_source", "classified_as"].includes(type)) return "source_manifest";
    if (type === "normalized_as") return "generated_artifact";
    if (type === "contains_section") return "parsed_document_structure";
    if (/^(?:links_to_|imports_|tests_source$|tests_imports_|references_|depends_on_)/.test(type)) {
      return "explicit_source_reference";
    }
    return "source_extraction";
  };
  const addEdge = (from, to, type, source, locator = null) => {
    edges.push({
      id: stableId(`${from}:${type}:${to}:${locator || ""}`),
      from,
      to,
      type,
      provenance: {
        kind: relationshipProvenance(type),
        inferred: false,
      },
      evidence: source ? {
        source_path: source.path,
        sha256: source.sha256 || null,
        ...(locator ? { line: Number(locator.split(":").at(-1)), locator } : {}),
      } : null,
    });
  };

  for (const source of manifest.sources) {
    if (typeof source.path !== "string" || typeof source.category !== "string" ||
        typeof source.status !== "string") {
      throw new Error("Source manifest contains an entry without a path, category, or status.");
    }
    const sourcePath = source.path.replace(/\\/g, "/");
    const absoluteSource = assertSafeProjectPath(root, sourcePath, "Source");
    if (!fs.statSync(absoluteSource).isFile()) {
      throw new Error(`Source path is not a file: ${sourcePath}`);
    }
    if (source.sha256 && !/^[a-f0-9]{64}$/i.test(source.sha256)) {
      throw new Error(`Source manifest contains an invalid checksum: ${sourcePath}`);
    }
    if (source.sha256) {
      const currentDigest = crypto.createHash("sha256").update(fs.readFileSync(absoluteSource)).digest("hex");
      if (currentDigest !== source.sha256) {
        throw new Error(`Source changed after sync; rebuild graph with mcpee sync: ${sourcePath}`);
      }
    }
    const sourceId = stableId(`source:${sourcePath}`);
    sourceIdsByPath.set(sourcePath, sourceId);
    sourceCategoriesByPath.set(sourcePath, source.category);
    addNode(nodes, {
      id: sourceId,
      type: "source",
      label: sourcePath,
      source_path: sourcePath,
      category: source.category,
      status: source.status,
      sha256: source.sha256 || null,
    });
    addEdge(projectId, sourceId, "contains_source", source);

    const categoryId = stableId(`category:${source.category}`);
    if (!categories.has(source.category)) {
      categories.add(source.category);
      addNode(nodes, { id: categoryId, type: "category", label: source.category });
    }
    addEdge(sourceId, categoryId, "classified_as", source);

    const metadata = readExtractedMetadata(root, source);
    if (!metadata) continue;
    if (typeof source.normalized_path !== "string" ||
        !source.normalized_path.replace(/\\/g, "/").startsWith("knowledge/normalized/")) {
      throw new Error(`Processed source has no valid normalized artifact path: ${source.path}`);
    }
    const normalizedPath = source.normalized_path.replace(/\\/g, "/");
    assertSafeProjectPath(root, normalizedPath, "Normalized source");
    const normalizedId = stableId(`normalized:${normalizedPath}`);
    addNode(nodes, { id: normalizedId, type: "normalized", label: normalizedPath, source_path: sourcePath });
    addEdge(sourceId, normalizedId, "normalized_as", source);

    const sectionStack = [];
    for (const [index, heading] of (metadata.headings || []).entries()) {
      if (typeof heading.title !== "string" || !Number.isInteger(heading.level)) {
        throw new Error(`Invalid heading evidence in extracted metadata for ${source.path}`);
      }
      const headingLine = Number.isInteger(heading.line) ? heading.line : null;
      const headingId = stableId(`heading:${sourcePath}:${headingLine ?? index}:${heading.title}`);
      addNode(nodes, {
        id: headingId,
        type: "heading",
        label: heading.title,
        source_path: sourcePath,
        level: heading.level,
        ...(headingLine ? { line: headingLine } : {}),
      });
      addEdge(sourceId, headingId, "contains_heading", source, headingLine ? `line:${headingLine}` : null);
      while (sectionStack.length && sectionStack.at(-1).level >= heading.level) sectionStack.pop();
      const parent = sectionStack.at(-1);
      if (parent) addEdge(parent.id, headingId, "contains_section", source, headingLine ? `line:${headingLine}` : null);
      sectionStack.push({ id: headingId, level: heading.level });
    }
    if (metadata.symbol_locations !== undefined &&
        (!Array.isArray(metadata.symbol_locations) ||
         metadata.symbol_locations.length !== (metadata.symbols || []).length)) {
      throw new Error(`Invalid symbol location evidence in extracted metadata for ${source.path}`);
    }
    const symbolIdsByName = new Map();
    for (const [index, symbol] of (metadata.symbols || []).entries()) {
      if (typeof symbol !== "string") {
        throw new Error(`Invalid symbol evidence in extracted metadata for ${source.path}`);
      }
      const location = metadata.symbol_locations?.[index];
      if (location && (location.name !== symbol || !Number.isInteger(location.line) || location.line < 1)) {
        throw new Error(`Invalid symbol location evidence in extracted metadata for ${source.path}`);
      }
      const symbolId = stableId(`symbol:${sourcePath}:${index}:${symbol}`);
      addNode(nodes, {
        id: symbolId,
        type: "symbol",
        label: symbol,
        source_path: sourcePath,
        ...(location ? { line: location.line } : {}),
      });
      addEdge(sourceId, symbolId, "defines_symbol", source,
        location ? `line:${location.line}` : null);
      const symbolIds = symbolIdsByName.get(symbol) || [];
      symbolIds.push(symbolId);
      symbolIdsByName.set(symbol, symbolIds);
    }
    if (symbolIdsByName.size) symbolIdsBySourcePath.set(sourcePath, symbolIdsByName);
    if (metadata.tabular_fields !== undefined) {
      if (!Array.isArray(metadata.tabular_fields)) {
        throw new Error(`Invalid tabular field evidence in extracted metadata for ${source.path}`);
      }
      if (metadata.tabular_fields.length > 500) {
        throw new Error(`Tabular field evidence exceeds the extraction limit for ${source.path}`);
      }
      const datasetId = stableId(`dataset:${sourcePath}`);
      addNode(nodes, {
        id: datasetId,
        type: "dataset",
        label: path.posix.basename(sourcePath),
        source_path: sourcePath,
      });
      addEdge(sourceId, datasetId, "describes_dataset", source);
      for (const field of metadata.tabular_fields) {
        if (!field || typeof field.name !== "string" || !field.name.trim() ||
            field.name.length > 500 || !Number.isInteger(field.line) || field.line < 1 ||
            !Number.isInteger(field.position) || field.position < 0) {
          throw new Error(`Invalid tabular field evidence in extracted metadata for ${source.path}`);
        }
        const fieldId = stableId(`data-field:${sourcePath}:${field.line}:${field.position}:${field.name}`);
        addNode(nodes, {
          id: fieldId,
          type: "data_field",
          label: field.name,
          source_path: sourcePath,
          line: field.line,
          position: field.position,
        });
        addEdge(datasetId, fieldId, "defines_field", source, `line:${field.line}`);
      }
    }
    if (source.processor === "markdown" && ["processed", "unchanged"].includes(source.status)) {
      const sourceText = fs.readFileSync(absoluteSource, "utf8");
      markdownReferences.push(...markdownLinks(sourceText).map((reference) => ({ source, sourcePath, reference })));
      if (["documentation", "business", "architecture", "external"].includes(source.category)) {
        sourceClaims.push(...documentedClaims(sourceText, source));
      }
    }
    if (source.category === "configuration" && ["processed", "unchanged"].includes(source.status)) {
      const sourceText = fs.readFileSync(absoluteSource, "utf8");
      sourceClaims.push(...booleanClaims(sourceText, source, "configuration"));
      if (path.posix.basename(sourcePath) === "package.json") {
        try {
          const packageManifest = packageManifestDependencies(sourceText);
          if (packageManifest.name) {
            const manifests = packageManifestsByName.get(packageManifest.name) || [];
            manifests.push(sourcePath);
            packageManifestsByName.set(packageManifest.name, manifests);
          }
          packageReferences.push(...packageManifest.references.map((reference) => ({
            source,
            sourcePath,
            reference,
          })));
        } catch (error) {
          findings.push({
            id: stableId(`invalid-package-manifest:${sourcePath}`),
            type: "invalid_package_manifest",
            status: "needs_review",
            source_path: sourcePath,
            line: 1,
            sha256: source.sha256 || null,
            reason: error.message,
          });
        }
      }
    }
    if (["source-code", "tests"].includes(source.category) &&
        /\.(?:[cm]?[jt]sx?)$/i.test(sourcePath) && ["processed", "unchanged"].includes(source.status)) {
      const sourceText = fs.readFileSync(absoluteSource, "utf8");
      moduleReferences.push(...localModuleReferences(sourceText).map((reference) => ({ source, sourcePath, reference })));
      sourceClaims.push(...booleanClaims(sourceText, source, source.category));
    }
    if (["source-code", "tests"].includes(source.category) &&
        /\.pyi?$/i.test(sourcePath) && ["processed", "unchanged"].includes(source.status)) {
      const sourceText = fs.readFileSync(absoluteSource, "utf8");
      pythonReferences.push(...pythonModuleReferences(sourceText)
        .map((reference) => ({ source, sourcePath, reference })));
    }
    if (["infrastructure", "api-contracts", "pipelines", "configuration"].includes(source.category) &&
        ["processed", "unchanged"].includes(source.status)) {
      const sourceText = fs.readFileSync(absoluteSource, "utf8");
      domainReferences.push(...domainFileReferences(sourceText, source.category)
        .map((reference) => ({ source, sourcePath, reference })));
    }
    if (["source-code", "infrastructure"].includes(source.category) &&
        /\.(?:slnx?|csproj|fsproj|vbproj|props|targets)$/i.test(sourcePath) &&
        ["processed", "unchanged"].includes(source.status)) {
      const sourceText = fs.readFileSync(absoluteSource, "utf8");
      domainReferences.push(...dotnetProjectReferences(sourceText, sourcePath)
        .map((reference) => ({ source, sourcePath, reference })));
    }
    if (source.category === "database" && ["processed", "unchanged"].includes(source.status)) {
      const { tables, foreignKeys } = sqlTableReferences(fs.readFileSync(absoluteSource, "utf8"));
      for (const declaration of tables) {
        const name = declaration.schema
          ? `${declaration.schema}.${declaration.table}`
          : declaration.table;
        const key = name.toLocaleLowerCase("en-US");
        if (!databaseTables.has(key)) {
          databaseTables.set(key, {
            id: stableId(`database-table:${key}`),
            type: "database_table",
            label: name,
            source_path: sourcePath,
          });
        }
        databaseDeclarations.push({ source, sourcePath, declaration, key });
      }
      databaseReferences.push(...foreignKeys.map((reference) => ({ source, sourcePath, reference })));
    }
  }

  const databaseTableIdsByName = new Map();
  for (const [key, node] of databaseTables) {
    addNode(nodes, node);
    const basename = key.split(".").at(-1);
    const matches = databaseTableIdsByName.get(basename) || [];
    matches.push(node.id);
    databaseTableIdsByName.set(basename, matches);
  }
  for (const { source, sourcePath, declaration, key } of databaseDeclarations) {
    const sourceId = sourceIdsByPath.get(sourcePath);
    const table = databaseTables.get(key);
    if (sourceId && table) {
      addEdge(sourceId, table.id, "defines_database_table", source, `line:${declaration.line}`);
    }
  }
  for (const { source, sourcePath, reference } of databaseReferences) {
    const key = (reference.schema ? `${reference.schema}.${reference.table}` : reference.table)
      .toLocaleLowerCase("en-US");
    const target = databaseTables.get(key) ||
      (!reference.schema && databaseTableIdsByName.get(key)?.length === 1
        ? nodes.get(databaseTableIdsByName.get(key)[0])
        : null);
    const sourceId = sourceIdsByPath.get(sourcePath);
    if (target && sourceId) {
      addEdge(sourceId, target.id, "references_database_table", source, `line:${reference.line}`);
    }
  }

  const knownSourcePaths = new Set(sourceIdsByPath.keys());
  for (const { source, sourcePath, reference } of markdownReferences) {
    const targetPath = resolveKnownSourcePath(root, sourcePath, reference.targetPath, knownSourcePaths);
    const targetId = sourceIdsByPath.get(targetPath);
    const sourceId = sourceIdsByPath.get(sourcePath);
    if (sourceId && targetId) {
      addEdge(sourceId, targetId, "links_to_source", source, `line:${reference.line}`);
    } else {
      const absoluteTarget = path.resolve(root, path.dirname(sourcePath), reference.targetPath);
      const relativeTarget = path.relative(root, absoluteTarget);
      const finding = missingLocalReference(root, sourcePath, reference, sourcePath, source);
      if (finding) findings.push(finding);
    }
  }
  const claimsByKey = new Map();
  for (const claim of sourceClaims) {
    const key = `${claim.anchor}:${claim.topic}`;
    const group = claimsByKey.get(key) || [];
    group.push(claim);
    claimsByKey.set(key, group);
  }
  for (const [key, claims] of claimsByKey) {
    const positive = claims.filter((claim) => claim.value === "positive");
    const negative = claims.filter((claim) => claim.value === "negative");
    for (const first of positive) {
      const second = negative.find((claim) =>
        claim.source_path !== first.source_path || claim.line !== first.line);
      if (!second) continue;
      const pair = [first, second].sort((left, right) =>
        left.source_path.localeCompare(right.source_path) || left.line - right.line);
      findings.push({
        id: stableId(`conflicting-source-claims:${key}:${pair.map((claim) => `${claim.source_path}:${claim.line}`).join(":")}`),
        type: "conflicting_source_claims",
        status: "needs_review",
        anchor: first.anchor,
        topic: first.topic,
        claims: pair,
      });
    }
  }
  findings.sort((left, right) =>
    left.type.localeCompare(right.type) ||
    (left.source_path || left.claims?.[0]?.source_path || "").localeCompare(right.source_path || right.claims?.[0]?.source_path || "") ||
    (left.line || left.claims?.[0]?.line || 0) - (right.line || right.claims?.[0]?.line || 0));
  for (const { source, sourcePath, reference } of moduleReferences) {
    const targetPath = resolveKnownSourcePath(root, sourcePath, reference.targetPath, knownSourcePaths);
    const targetId = sourceIdsByPath.get(targetPath);
    const sourceId = sourceIdsByPath.get(sourcePath);
    if (sourceId && targetId) {
      const edgeType = source.category === "tests" && sourceCategoriesByPath.get(targetPath) !== "tests"
        ? "tests_source"
        : "imports_source";
      addEdge(sourceId, targetId, edgeType, source, `line:${reference.line}`);
      if (source.category === "tests") {
        for (const symbol of reference.imported_symbols || []) {
          const matches = symbolIdsBySourcePath.get(targetPath)?.get(symbol) || [];
          if (matches.length === 1) {
            addEdge(sourceId, matches[0], "tests_imports_symbol", source, `line:${reference.line}`);
          }
        }
      }
    } else if (sourceId) {
      const pathOnly = reference.targetPath.split(/[?#]/, 1)[0];
      const absoluteTarget = path.resolve(root, path.dirname(sourcePath), pathOnly);
      const extension = path.extname(pathOnly);
      const candidates = extension
        ? [absoluteTarget]
        : [
          ...LOCAL_MODULE_EXTENSIONS.map((candidateExtension) => `${absoluteTarget}${candidateExtension}`),
          ...LOCAL_MODULE_INDEX_EXTENSIONS
            .map((candidateExtension) => path.join(absoluteTarget, `index${candidateExtension}`)),
        ];
      if (!candidates.some((candidate) => fs.existsSync(candidate))) {
        const finding = missingLocalReference(root, sourcePath, reference, sourcePath, source);
        if (finding) findings.push(finding);
      }
    }
  }
  for (const { source, sourcePath, reference } of pythonReferences) {
    const targetPath = resolvePythonModuleReference(sourcePath, reference, knownSourcePaths);
    const targetId = sourceIdsByPath.get(targetPath);
    const sourceId = sourceIdsByPath.get(sourcePath);
    if (sourceId && targetId) {
      const edgeType = source.category === "tests" && sourceCategoriesByPath.get(targetPath) !== "tests"
        ? "tests_source"
        : "imports_source";
      addEdge(sourceId, targetId, edgeType, source, `line:${reference.line}`);
    }
  }
  for (const { source, sourcePath, reference } of domainReferences) {
    const referenceBase = reference.rootRelative ? "." : sourcePath;
    const resolved = resolveKnownSourcePath(root, referenceBase, reference.targetPath, knownSourcePaths);
    const targetPaths = resolved
      ? [resolved]
      : reference.directory
        ? [...knownSourcePaths].filter((candidate) => candidate.startsWith(`${path.posix.normalize(
          path.posix.join(path.posix.dirname(referenceBase), reference.targetPath),
        )}/`)).sort()
        : [];
    const sourceId = sourceIdsByPath.get(sourcePath);
    for (const targetPath of targetPaths) {
      const targetId = sourceIdsByPath.get(targetPath);
      if (sourceId && targetId) {
        addEdge(sourceId, targetId, reference.edgeType, source, `line:${reference.line}`);
      }
    }
    if (!targetPaths.length && !reference.directory) {
      const finding = missingLocalReference(root, sourcePath, reference, referenceBase, source);
      if (finding) findings.push(finding);
    }
  }
  for (const { source, sourcePath, reference } of packageReferences) {
    let targetPath = null;
    if (reference.version.startsWith("workspace:")) {
      const matches = packageManifestsByName.get(reference.packageName) || [];
      if (matches.length === 1) targetPath = matches[0];
      else if (matches.length !== 0) {
        findings.push({
          id: stableId(`ambiguous-local-package:${sourcePath}:${reference.line}:${reference.packageName}`),
          type: "ambiguous_local_package_reference",
          status: "needs_review",
          source_path: sourcePath,
          target_name: reference.packageName,
          line: reference.line,
          sha256: source.sha256 || null,
        });
      } else {
        findings.push({
          id: stableId(`missing-local-package:${sourcePath}:${reference.line}:${reference.packageName}`),
          type: "missing_local_package_reference",
          status: "needs_review",
          source_path: sourcePath,
          target_name: reference.packageName,
          line: reference.line,
          sha256: source.sha256 || null,
        });
      }
    } else {
      const localPath = reference.version.slice(reference.version.indexOf(":") + 1);
      if (localPath && !path.posix.isAbsolute(localPath) && !/^[A-Za-z]:[\\/]/.test(localPath)) {
        const packagePath = path.posix.normalize(
          path.posix.join(path.posix.dirname(sourcePath), localPath, "package.json"),
        );
          if (knownSourcePaths.has(packagePath)) {
            targetPath = packagePath;
          } else {
            const finding = missingLocalReference(root, sourcePath, {
              targetPath: packagePath,
              line: reference.line,
              source,
            }, ".");
            if (finding) findings.push(finding);
          }
        }
    }
    const sourceId = sourceIdsByPath.get(sourcePath);
    const targetId = targetPath && sourceIdsByPath.get(targetPath);
    if (sourceId && targetId && sourceId !== targetId) {
      addEdge(sourceId, targetId, "depends_on_local_package", source, `line:${reference.line}`);
    }
  }

  const graph = {
    schema_version: 1,
    generated_by: "mcpee",
    generated_at: new Date().toISOString(),
    strategy: "local-evidence-unified",
    evidence_policy: "Every edge carries source evidence and a provenance kind: source-manifest fact, generated artifact, parsed document structure, source extraction, or explicit source reference. inferred is always false; uncertain or inferred cross-source relationships are omitted rather than presented as facts.",
    node_count: nodes.size,
    edge_count: edges.length,
    findings,
    nodes: [...nodes.values()].sort((left, right) =>
      left.type.localeCompare(right.type) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) =>
      left.from.localeCompare(right.from) || left.type.localeCompare(right.type) || left.to.localeCompare(right.to)),
  };
  const relativeOutput = options.outputPath || GRAPH_PATH;
  const outputPath = assertSafeProjectPath(root, relativeOutput, "Unified graph output", { allowMissing: true });
  if (fs.existsSync(outputPath)) {
    const current = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (current.generated_by !== "mcpee") {
      throw new Error(`Refusing to overwrite non-MCPEE graph artifact: ${relativeOutput}`);
    }
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, outputPath);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
  recordEvent(root, {
    event_name: "knowledge.unified_graph.built",
    attributes: {
      node_count: graph.node_count,
      edge_count: graph.edge_count,
      source_count: manifest.sources.length,
      document_drift_findings: findings.length,
    },
  });
  return { status: "ready", file: relativeOutput, node_count: graph.node_count, edge_count: graph.edge_count, finding_count: findings.length };
}

function getDocumentDrift(projectRoot) {
  const graphPath = path.join(path.resolve(projectRoot), GRAPH_PATH);
  if (!fs.existsSync(graphPath)) throw new Error("Unified graph is missing; run mcpee sync before checking document drift.");
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  if (graph.generated_by !== "mcpee" || !Array.isArray(graph.findings)) {
    throw new Error("Unified graph has no valid document-drift findings; run mcpee sync to rebuild it.");
  }
  const findings = graph.findings.filter((finding) =>
    finding?.type === "missing_local_reference" && finding.status === "needs_review");
  if (findings.some((finding) => !finding || typeof finding !== "object" ||
      typeof finding.source_path !== "string" ||
      typeof finding.target_path !== "string" || !Number.isInteger(finding.line) ||
      !/^[a-f0-9]{64}$/i.test(finding.sha256 || ""))) {
    throw new Error("Unified graph contains a malformed document-drift finding; run mcpee sync to rebuild it.");
  }
  for (const finding of findings) {
    const root = path.resolve(projectRoot);
    const source = assertSafeProjectPath(root, finding.source_path, "Drift evidence");
    if (!fs.existsSync(source) || !fs.statSync(source).isFile() ||
        crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex") !== finding.sha256) {
      throw new Error(`Document drift evidence is stale; run mcpee sync before reviewing: ${finding.source_path}`);
    }
    const target = assertSafeProjectPath(root, finding.target_path, "Drift target", { allowMissing: true });
    if (fs.existsSync(target)) {
      throw new Error(`Document drift target changed after sync; run mcpee sync before reviewing: ${finding.target_path}`);
    }
  }
  return findings;
}

function getDocumentContradictions(projectRoot) {
  const root = path.resolve(projectRoot);
  const graphPath = path.join(root, GRAPH_PATH);
  if (!fs.existsSync(graphPath)) throw new Error("Unified graph is missing; run mcpee sync before checking document contradictions.");
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  if (graph.generated_by !== "mcpee" || !Array.isArray(graph.findings)) {
    throw new Error("Unified graph has no valid contradiction findings; run mcpee sync to rebuild it.");
  }
  const findings = graph.findings.filter((finding) =>
    ["conflicting_document_claims", "conflicting_source_claims"].includes(finding.type) &&
    finding.status === "needs_review");
  for (const finding of findings) {
    if (!Array.isArray(finding.claims) || finding.claims.length !== 2 ||
        finding.claims.some((claim) =>
          typeof claim.source_path !== "string" || !Number.isInteger(claim.line) ||
          !/^[a-f0-9]{64}$/i.test(claim.sha256 || "") ||
          !["positive", "negative"].includes(claim.value) ||
          typeof claim.anchor !== "string" || typeof claim.topic !== "string")) {
      throw new Error("Unified graph contains malformed contradiction evidence; run mcpee sync to rebuild it.");
    }
    for (const claim of finding.claims) {
      const source = assertSafeProjectPath(root, claim.source_path, "Contradiction evidence");
      if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
        throw new Error(`Document contradiction evidence is stale; run mcpee sync before reviewing: ${claim.source_path}`);
      }
      if (claim.evidence_kind === "telemetry_event") {
        const current = latestCodeGraphRuntimeClaim(root).find((item) =>
          item.line === claim.line && item.sha256 === claim.sha256);
        if (!current || current.value !== claim.value) {
          throw new Error(`Runtime contradiction evidence is stale; run mcpee sync before reviewing: ${claim.source_path}`);
        }
      } else if (crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex") !== claim.sha256) {
        throw new Error(`Document contradiction evidence is stale; run mcpee sync before reviewing: ${claim.source_path}`);
      }
    }
  }
  return findings;
}

function searchUnifiedGraph(projectRoot, query, limit = 10) {
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("Unified graph query must not be empty.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
    throw new Error(`Unified graph result limit must be an integer between 1 and ${MAX_RESULTS}.`);
  }
  const root = path.resolve(projectRoot);
  const graphPath = path.join(root, GRAPH_PATH);
  if (!fs.existsSync(graphPath)) throw new Error("Unified graph is missing; run mcpee sync first.");
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  if (graph.generated_by !== "mcpee" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("Unified graph is invalid or not owned by MCPEE.");
  }
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [])];
  const scores = [];
  for (const node of graph.nodes) {
    if (!["source", "heading", "symbol"].includes(node.type) || typeof node.label !== "string") continue;
    const text = `${node.label} ${node.source_path || ""} ${node.category || ""}`.toLowerCase();
    const score = terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
    if (!score) continue;
    scores.push({
      source_path: node.source_path || node.label,
      symbol: node.type === "source" ? node.label : node.label,
      symbol_kind: node.type,
      score,
      node_id: node.id,
    });
  }
  return scores.sort((left, right) =>
    right.score - left.score || left.source_path.localeCompare(right.source_path) ||
    left.symbol.localeCompare(right.symbol)).slice(0, limit);
}

function analyzeImpact(projectRoot, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error("Impact analysis requires a project-relative source path.");
  }
  const normalizedTarget = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (path.posix.isAbsolute(normalizedTarget) || /^[A-Za-z]:\//.test(normalizedTarget) ||
      normalizedTarget.split("/").some((segment) => segment === "..")) {
    throw new Error(`Impact path must stay inside the project: ${relativePath}`);
  }
  const root = path.resolve(projectRoot);
  const graphPath = path.join(root, GRAPH_PATH);
  if (!fs.existsSync(graphPath)) throw new Error("Unified graph is missing; run mcpee sync first.");
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  if (graph.generated_by !== "mcpee" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("Unified graph is invalid or not owned by MCPEE.");
  }
  const sourceNodes = new Map(graph.nodes
    .filter((node) => node.type === "source" && typeof node.source_path === "string")
    .map((node) => [node.source_path, node]));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const verifiedSources = new Set();
  const verifySource = (sourcePath) => {
    if (verifiedSources.has(sourcePath)) return;
    const source = sourceNodes.get(sourcePath);
    if (!source) return;
    const absolute = assertSafeProjectPath(root, sourcePath, "Impact source");
    if (!fs.statSync(absolute).isFile()) throw new Error(`Impact source is not a file: ${sourcePath}`);
    if (source.sha256) {
      const digest = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
      if (digest !== source.sha256) {
        throw new Error(`Source changed after sync; run mcpee sync before impact analysis: ${sourcePath}`);
      }
    }
    verifiedSources.add(sourcePath);
  };
  verifySource(normalizedTarget);
  if (!sourceNodes.has(normalizedTarget)) {
    throw new Error(`Impact target is not an indexed source: ${normalizedTarget}`);
  }

  const importersByDependency = new Map();
  const referencesByTarget = new Map();
  const dependencyEdges = new Set([
    "imports_source",
    "contains_dotnet_project",
    "references_dotnet_project",
    "imports_build_file",
    "declares_local_module",
    "references_api_schema",
    "uses_local_action",
    "references_local_schema",
    "references_database_table",
    "depends_on_local_package",
  ]);
  for (const edge of graph.edges) {
    const from = sourceNodes.get(nodesById.get(edge.from)?.source_path);
    const to = sourceNodes.get(nodesById.get(edge.to)?.source_path);
    if (!from || !to) continue;
    if (dependencyEdges.has(edge.type)) {
      const importers = importersByDependency.get(to.source_path) || [];
      importers.push({ source_path: from.source_path, evidence: edge.evidence });
      importersByDependency.set(to.source_path, importers);
    } else if (edge.type === "links_to_source") {
      if (to.source_path === normalizedTarget) {
        verifySource(from.source_path);
        verifySource(to.source_path);
      }
      const references = referencesByTarget.get(to.source_path) || [];
      references.push({ source_path: from.source_path, evidence: edge.evidence });
      referencesByTarget.set(to.source_path, references);
    }
  }

  const bestDepth = new Map([[normalizedTarget, 0]]);
  const queue = [{ source_path: normalizedTarget, chain: [normalizedTarget], evidence: [] }];
  const affected = new Map();
  while (queue.length) {
    const current = queue.shift();
    for (const importer of importersByDependency.get(current.source_path) || []) {
      verifySource(current.source_path);
      verifySource(importer.source_path);
      const depth = current.chain.length;
      const previousDepth = bestDepth.get(importer.source_path);
      if (previousDepth !== undefined && previousDepth <= depth) continue;
      const chain = [...current.chain, importer.source_path];
      const evidence = [...current.evidence, importer.evidence];
      bestDepth.set(importer.source_path, depth);
      affected.set(importer.source_path, { source_path: importer.source_path, depth, chain, evidence });
      queue.push({ source_path: importer.source_path, chain, evidence });
    }
  }
  const sortEvidence = (left, right) => left.source_path.localeCompare(right.source_path) ||
    (left.evidence?.line || 0) - (right.evidence?.line || 0);
  return {
    generated_at: graph.generated_at,
    target: normalizedTarget,
    affected_sources: [...affected.values()].sort((left, right) =>
      left.depth - right.depth || left.source_path.localeCompare(right.source_path)),
    referencing_sources: (referencesByTarget.get(normalizedTarget) || []).sort(sortEvidence),
  };
}

function analyzeImpacts(projectRoot, relativePaths) {
  if (!Array.isArray(relativePaths)) throw new Error("Impact preflight paths must be an array.");
  const graphPath = path.join(path.resolve(projectRoot), GRAPH_PATH);
  if (!fs.existsSync(graphPath)) {
    return { status: "unavailable", reason: "Unified graph is missing; run mcpee sync first.", targets: [], unindexed: [] };
  }
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  if (graph.generated_by !== "mcpee" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("Unified graph is invalid or not owned by MCPEE.");
  }
  const indexedPaths = new Set(graph.nodes
    .filter((node) => node.type === "source" && typeof node.source_path === "string")
    .map((node) => node.source_path));
  const paths = [...new Set(relativePaths)];
  const unindexed = paths.filter((sourcePath) => !indexedPaths.has(sourcePath));
  const targets = paths.filter((sourcePath) => indexedPaths.has(sourcePath))
    .map((sourcePath) => analyzeImpact(projectRoot, sourcePath));
  const status = targets.length === 0 ? "unavailable" : unindexed.length ? "partial" : "ready";
  return {
    status,
    ...(status === "unavailable"
      ? { reason: "No indexed evidence source is available for impact analysis." }
      : status === "partial"
        ? { reason: "Some evidence sources are not indexed; state-changing actions must wait for mcpee sync." }
        : {}),
    targets,
    unindexed,
  };
}

module.exports = {
  analyzeImpact,
  analyzeImpacts,
  buildUnifiedGraph,
  getDocumentContradictions,
  getDocumentDrift,
  searchUnifiedGraph,
  GRAPH_PATH,
};
