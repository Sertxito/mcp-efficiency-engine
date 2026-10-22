"use strict";

const FAMILIES = [
  { id: "csharp", match: /\.cs$/i, evidence: "Declarations, lexical branches, calls and assertions", tests: "Simple annotated block-bodied methods", limits: "No type/DI resolution, inheritance or complete control-flow analysis" },
  { id: "react", match: /\.[jt]sx$/i, evidence: "Script observations and JSX event/binding syntax", tests: "Simple JS/TS test callbacks", limits: "No component tree, rendered DOM or hook lifecycle resolution" },
  { id: "javascript", match: /\.[cm]?js$/i, evidence: "Lexical branches, calls, assignments and assertions", tests: "Simple JS test callbacks", limits: "No AST, module resolution or async execution graph" },
  { id: "typescript", match: /\.[cm]?ts$/i, evidence: "Lexical branches, calls, assignments and assertions", tests: "Simple TS test callbacks", limits: "No type checker, overload or decorator resolution" },
  { id: "python", match: /\.py$/i, evidence: "Indented functions, conditions, returns, raises, calls and asserts", tests: "Simple test_ functions and self.assert calls", limits: "No dynamic dispatch, multiline suite resolution or fixture execution; tabs are not scoped" },
  { id: "sql", match: /\.sql$/i, evidence: "DDL, constraints, queries, mutations and transaction statements", tests: "Not associated", limits: "Lexical SQL evidence only; no dialect catalog, procedure flow or transaction proof" },
  { id: "powershell", match: /\.ps(?:1|m1)$/i, evidence: "Functions, parameters, conditions, commands, state commands and assertions", tests: "Simple Pester It scriptblocks", limits: "No pipeline binding, module resolution, here-string interpolation or remote execution proof" },
  { id: "bicep", match: /\.bicep(?:param)?$/i, evidence: "Resources, modules, parameters, outputs, conditions and dependency declarations", tests: "Not associated", limits: "No compiler, provider schema validation, deployed resource or evaluated-expression proof" },
  { id: "angular-template", match: /\.html?$/i, evidence: "Angular bindings, events, forms and control-template syntax", tests: "Not associated", limits: "No component resolution, browser rendering or accessibility certification" },
];

function stackCapability(sourcePath) {
  const family = FAMILIES.find((item) => item.match.test(sourcePath));
  const pipeline = /(?:^|\/)(?:\.github\/workflows\/|\.gitlab-ci|azure-pipelines|pipelines?\/)|(?:^|\/)[^/]*pipeline[^/]*\.ya?ml$/i.test(sourcePath) && /\.ya?ml$/i.test(sourcePath);
  if (!family && !pipeline) return null;
  const selected = family || {
    id: "pipeline-yaml", evidence: "Jobs, stages, steps, conditions, dependencies and command/action declarations",
    tests: "Not associated", limits: "No YAML expansion, template/action resolution, shell execution or secret evaluation",
  };
  return { family: selected.id, level: "static-syntax-partial", evidence: selected.evidence, tests: selected.tests, limitations: selected.limits };
}

// Language-specific masking keeps quotes/comments from becoming executable evidence.
function maskStack(text, family) {
  let result = "", quote = "", block = "", triple = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (block) {
      if (text.startsWith(block, index)) { result += " ".repeat(block.length); index += block.length - 1; block = ""; }
      else result += char === "\n" ? "\n" : " ";
    } else if (quote) {
      if (triple && text.startsWith(quote.repeat(3), index)) {
        result += "   "; index += 2; quote = ""; triple = false;
      } else if (!triple && char === quote) {
        if (next === quote && ["sql", "powershell"].includes(family)) { result += "  "; index += 1; }
        else { result += " "; quote = ""; }
      } else if (char === (family === "powershell" ? "`" : "\\") && next && family !== "sql") {
        result += " " + (next === "\n" ? "\n" : " "); index += 1;
      } else result += char === "\n" ? "\n" : " ";
    } else if (family === "powershell" && char === "<" && next === "#") {
      block = "#>"; result += "  "; index += 1;
    } else if (["sql", "bicep"].includes(family) && char === "/" && next === "*") {
      block = "*/"; result += "  "; index += 1;
    } else if ((family === "python" || family === "powershell") && char === "#" ||
        family === "sql" && char === "-" && next === "-" ||
        family === "bicep" && char === "/" && next === "/") {
      const end = text.indexOf("\n", index);
      const length = (end < 0 ? text.length : end) - index;
      result += " ".repeat(length); index += length - 1;
    } else if (family === "powershell" && char === "@" && (next === "'" || next === '"') && /\r?\n/.test(text.slice(index + 2, index + 4))) {
      block = `${next}@`; result += "  "; index += 1;
    } else if (char === "'" || char === '"') {
      quote = char; triple = family === "python" && text.startsWith(char.repeat(3), index);
      result += triple ? "   " : " "; if (triple) index += 2;
    } else result += char;
  }
  return result;
}

function observation(line, raw, kinds, scope = "unresolved", guards = []) {
  return {
    kind: "implementation-observation", observations: kinds, line, scope,
    certainty: "observed-syntax", enclosing_conditions: guards, summary: raw.trim(),
  };
}

function pythonEvidence(text) {
  const raw = text.split(/\r?\n/), lines = maskStack(text, "python").split(/\r?\n/);
  const scopes = [], guards = [], facts = [];
  let continuationDepth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index], trimmed = line.trim();
    if (!trimmed) continue;
    const continued = continuationDepth > 0;
    for (const char of line) {
      if ("([{".includes(char)) continuationDepth += 1;
      if (")]}".includes(char)) continuationDepth = Math.max(0, continuationDepth - 1);
    }
    if (continued) continue;
    const indent = line.length - line.trimStart().length;
    while (scopes.length && indent <= scopes.at(-1).indent) scopes.pop();
    while (guards.length && indent <= guards.at(-1).indent) guards.pop();
    const method = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
    if ((method || /^class\s+/.test(trimmed)) && !line.includes("\t") && /:\s*$/.test(trimmed)) {
      scopes.push({ name: method?.[1] || "unresolved", indent });
    }
    const condition = trimmed.match(/^if\s+(.+):\s*$/);
    const active = guards.filter((guard) => guard.indent > (scopes.at(-1)?.indent ?? -1))
      .map(({ line: start, condition: expression }) => ({ line: start, condition: expression }));
    const kinds = [];
    if (method) kinds.push("function-declaration");
    if (/^(?:if|elif|else|for|while|match|case)\b/.test(trimmed)) kinds.push("control-flow");
    if (/^return\b/.test(trimmed)) kinds.push("return");
    if (/^raise\b/.test(trimmed)) kinds.push("throw");
    if (/^(?:with|async\s+with)\b/.test(trimmed)) kinds.push("context-manager");
    if (/\bawait\b/.test(trimmed)) kinds.push("async-call");
    if (/^except\b/.test(trimmed)) kinds.push("exception-handler");
    if (/^assert\b|\bself\.assert\w+\s*\(/.test(trimmed)) kinds.push("assertion");
    if (/\b\w+(?:\.\w+)*\s*\(/.test(trimmed) && !method) kinds.push("call-site");
    if (/^[\w.]+\s*(?::[^=]+)?=(?!=)/.test(trimmed)) kinds.push("assignment");
    if (/\.(?:commit|rollback|save|delete|write_text|write_bytes)\s*\(/.test(trimmed)) kinds.push("state-operation-call");
    if (kinds.length) facts.push(observation(index + 1, raw[index], kinds, line.includes("\t") ? "unresolved" : scopes.at(-1)?.name, line.includes("\t") ? [] : active));
    if (condition && !line.includes("\t")) guards.push({ indent, line: index + 1, condition: raw[index].trim().replace(/^if\s+/, "").replace(/:\s*$/, "") });
  }
  return facts;
}

function stackFacts(text, sourcePath) {
  const capability = stackCapability(sourcePath);
  if (!capability || ["csharp", "javascript", "typescript", "react"].includes(capability.family)) return [];
  const family = capability.family;
  if (family === "python") return pythonEvidence(text);
  if (family === "angular-template") {
    const stripped = text.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi, (comment) => comment.replace(/[^\r\n]/g, " "));
    const tags = [...stripped.matchAll(/<[A-Za-z][\w:-]*(?:\s+(?:"[^"]*"|'[^']*'|[^'">])*)?\s*\/?>/g)];
    const tagLines = new Map();
    let cursor = 0, currentLine = 1;
    for (const match of tags) {
      currentLine += stripped.slice(cursor, match.index).split("\n").length - 1;
      const parts = match[0].replace(/"[^"]*"|'[^']*'/g, (value) => value.replace(/[^\r\n]/g, " ")).split(/\r?\n/);
      parts.forEach((part, offset) =>
        tagLines.set(currentLine + offset, `${tagLines.get(currentLine + offset) || ""} ${part}`));
      currentLine += parts.length - 1;
      cursor = match.index + match[0].length;
    }
    return stripped.split(/\r?\n/).flatMap((line, index) => {
      const kinds = [];
      const tag = tagLines.get(index + 1) || "";
      if (/\([\w.:-]+\)\s*=/.test(tag)) kinds.push("template-event-binding");
      if (/\[[\w.:-]+\]\s*=/.test(tag) || /\{\{.*?\}\}/.test(line)) kinds.push("template-property-binding");
      if (/\*(?:ngIf|ngFor|ngSwitchCase)\b/.test(tag) || /@(?:if|for|switch)\s*\(/.test(line)) kinds.push("template-control");
      if (/<form\b|\b(?:formControlName|formGroup|ngModel|required|minlength|maxlength|pattern)\b/.test(tag)) kinds.push("template-form-declaration");
      return kinds.length ? [observation(index + 1, line, kinds)] : [];
    });
  }
  if (family === "pipeline-yaml") return pipelineFacts(text);
  const raw = text.split(/\r?\n/), lines = maskStack(text, family).split(/\r?\n/);
  return lines.flatMap((line, index) => {
    const kinds = [], trimmed = line.trim();
    if (family === "sql") {
      if (/^(?:CREATE|ALTER|DROP)\s+(?:OR\s+(?:ALTER|REPLACE)\s+)?(?:TABLE|VIEW|PROCEDURE|PROC|FUNCTION|INDEX|TRIGGER)\b/i.test(trimmed)) kinds.push("schema-declaration");
      if (/\b(?:PRIMARY\s+KEY|FOREIGN\s+KEY|REFERENCES|CHECK|NOT\s+NULL|UNIQUE)\b/i.test(trimmed)) kinds.push("constraint-declaration");
      if (/^(?:SELECT|WITH)\b/i.test(trimmed)) kinds.push("query-declaration");
      if (/^(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i.test(trimmed)) kinds.push("state-operation-call");
      if (/^(?:BEGIN\s+(?:TRAN|TRANSACTION)|COMMIT|ROLLBACK)\b/i.test(trimmed)) kinds.push("transaction-statement");
      if (/^(?:THROW|RAISERROR)\b/i.test(trimmed)) kinds.push("throw");
      if (/^(?:EXEC|EXECUTE)\b/i.test(trimmed)) kinds.push("call-site");
    } else if (family === "powershell") {
      if (/^(?:function|filter)\s+[\w-]+/i.test(trimmed)) kinds.push("function-declaration");
      if (/^param\s*\(|^\[(?:Parameter|Validate\w+)/i.test(trimmed)) kinds.push("parameter-declaration");
      if (/^(?:if|elseif|switch|foreach|for|while)\s*\(/i.test(trimmed)) kinds.push("control-flow");
      if (/^return\b/i.test(trimmed)) kinds.push("return");
      if (/^throw\b/i.test(trimmed)) kinds.push("throw");
      if (/^catch\b/i.test(trimmed)) kinds.push("exception-handler");
      if (/\|\s*Should\b/i.test(trimmed)) kinds.push("assertion");
      if (/(?:^|[|;=]\s*)\s*[A-Za-z]+-[A-Za-z][\w-]*\b/.test(trimmed)) kinds.push("command-call");
      if (/\b(?:Set|Remove|New|Add|Clear|Out)-[\w-]+\b/i.test(trimmed)) kinds.push("state-operation-call");
      if (/^\$[\w:]+\s*=(?!=)/.test(trimmed)) kinds.push("assignment");
    } else if (family === "bicep") {
      if (/^(?:resource|module)\s+\w+/.test(trimmed)) kinds.push("resource-declaration");
      if (/^(?:param|output|var|using)\b/.test(trimmed)) kinds.push("configuration-declaration");
      if (/^dependsOn\s*:/.test(trimmed)) kinds.push("dependency-declaration");
      if (/\bif\s*\(|\bfor\s+\w+\s+in\b/.test(trimmed)) kinds.push("control-flow");
      if (/^@(?:allowed|minLength|maxLength|minValue|maxValue|secure)\s*\(/.test(trimmed)) kinds.push("constraint-declaration");
    }
    return kinds.length ? [observation(index + 1, raw[index], kinds)] : [];
  });
}

function pipelineFacts(text) {
  let scalarIndent = null, scriptScalar = false;
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return [];
    const indent = line.length - line.trimStart().length;
    if (scalarIndent !== null && indent > scalarIndent) {
      return scriptScalar ? [observation(index + 1, line, ["pipeline-script-line"])] : [];
    }
    scalarIndent = null;
    const key = line.match(/^\s*(?:-\s+)?([A-Za-z_][\w-]*)\s*:/)?.[1];
    if (!key) return [];
    if (/:\s*[|>](?:[-+]?[1-9]?|[1-9][-+]?)\s*(?:#.*)?$/.test(line)) {
      scalarIndent = line.indexOf(key, indent);
      scriptScalar = ["run", "script", "bash", "pwsh", "powershell"].includes(key);
    }
    const kinds = [];
    if (["jobs", "job", "stages", "stage", "steps"].includes(key)) kinds.push("pipeline-structure");
    if (["if", "condition", "rules", "needs", "dependsOn"].includes(key)) kinds.push("pipeline-condition-or-dependency");
    if (["run", "script", "bash", "pwsh", "powershell", "uses", "task"].includes(key)) kinds.push("pipeline-command-declaration");
    if (["permissions", "environment", "env", "variables", "trigger", "on"].includes(key)) kinds.push("pipeline-configuration");
    return kinds.length ? [observation(index + 1, line, kinds)] : [];
  });
}

module.exports = { stackCapability, stackFacts, maskStack };
