"use strict";

const { stackFacts, maskStack } = require("./stack-evidence");
const { maskCode } = require("../../core/src/syntax");

function closingBrace(code, opening) {
  let depth = 0;
  for (let index = opening; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    if (code[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function conditionalBlocks(text, code) {
  const guards = [];
  for (const match of code.matchAll(/\bif\s*\(/g)) {
    const opening = match.index + match[0].lastIndexOf("(");
    let depth = 1, end = opening + 1;
    while (end < code.length && depth) {
      if (code[end] === "(") depth += 1;
      if (code[end] === ")") depth -= 1;
      end += 1;
    }
    if (depth) continue;
    let body = end;
    while (/\s/.test(code[body] || "") && body < code.length) body += 1;
    const closing = code[body] === "{" ? closingBrace(code, body) : code.indexOf(";", body);
    if (closing < 0) continue;
    if (code[body] !== "{" && !/^(?:return|throw)\b/.test(code.slice(body))) continue;
    guards.push({
      line: lineAt(code, match.index), end_line: lineAt(code, closing),
      condition: text.slice(opening + 1, end - 1).trim(),
      start_offset: body, end_offset: closing,
    });
  }
  return guards;
}

function behaviorFacts(text, sourcePath) {
  if (!/\.(?:[cm]?[jt]sx?|cs)$/i.test(sourcePath)) return stackFacts(text, sourcePath);
  const code = maskCode(text), rawLines = text.split(/\r?\n/);
  const guards = conditionalBlocks(text, code);
  const scopes = [];
  // Only simple block-bodied method/function declarations; this is not a call graph.
  const methods = /^[ \t]*(?:(?:public|private|protected|internal|static|async|override|virtual|sealed|readonly|export)\s+)*(?:function\s+|[\w<>,.[\]?]+\s+)?([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?::[^{;=\n]+)?\s*\{/gm;
  for (const match of code.matchAll(methods)) {
    if (/^(?:if|for|foreach|while|switch|catch|using|lock)$/.test(match[1])) continue;
    const opening = match.index + match[0].lastIndexOf("{"), end = closingBrace(code, opening);
    if (end >= 0) scopes.push({ name: match[1], start: lineAt(code, match.index), end: lineAt(code, end), opening, closing: end });
  }
  const callables = [...scopes];
  for (const match of code.matchAll(/=>\s*\{|\bfunction(?:\s+\w+)?\s*\([^{}]*\)\s*\{/g)) {
    const opening = match.index + match[0].lastIndexOf("{"), closing = closingBrace(code, opening);
    if (closing >= 0) callables.push({ opening, closing });
  }
  let lineOffset = 0;
  return code.split("\n").flatMap((line, index) => {
    const offset = lineOffset;
    lineOffset += line.length + 1;
    const kinds = [];
    if (/\.[jt]sx$/i.test(sourcePath) && /<[A-Za-z][\w.]*(?:\s|>)/.test(line)) kinds.push("jsx-element-declaration");
    if (/\.[jt]sx$/i.test(sourcePath) && /\bon[A-Z]\w*\s*=\s*\{/.test(line)) kinds.push("jsx-event-binding");
    if (/\b(?:if|switch|case|for|foreach|while)\b/.test(line)) kinds.push("control-flow");
    if (/\breturn\b/.test(line)) kinds.push("return");
    if (/\bthrow\b/.test(line)) kinds.push("throw");
    if (/\bcatch\s*(?:\(|\{)/.test(line)) kinds.push("exception-handler");
    if (/\b(?:expect(?:\.soft)?|assert(?:\.\w+)?|Assert\.\w+)\s*(?:<[^>]+>)?\s*\(/.test(line)) kinds.push("assertion");
    if (/\b(?:this|[A-Za-z_]\w*)(?:\??\.[A-Za-z_]\w*)+\s*(?:<[^;{}()]+>)?\s*\(/.test(line)) kinds.push("call-site");
    if (/\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*(?:\?\?=|=(?!=|>))/.test(line)) kinds.push("assignment");
    if (/\b(?:localStorage|sessionStorage)\.(?:setItem|removeItem|clear)\s*\(|\b(?:SaveChangesAsync|SaveChanges|AddAsync|Remove|Update)\s*\(/.test(line)) kinds.push("state-operation-call");
    if (!kinds.length) return [];
    const scope = scopes.filter((item) => item.start <= index + 1 && item.end >= index + 1).at(-1);
    const terminals = [...line.matchAll(/\b(?:return|throw)\b/g)].map((match) => offset + match.index);
    const positions = terminals.length ? terminals :
      [...line.matchAll(/[A-Za-z_$][\w$]*/g)].map((match) => offset + match.index);
    return [{
      kind: "implementation-observation", observations: kinds, line: index + 1,
      scope: scope?.name || "unresolved", certainty: "observed-syntax",
      enclosing_conditions: /\belse\b/.test(line) ? [] : guards.filter((guard) =>
        positions.length && positions.every((position) =>
          position >= guard.start_offset && position <= guard.end_offset &&
          !callables.some((callable) => callable.opening > guard.start_offset &&
            callable.opening < position && callable.closing >= position)))
        .map(({ line: start, end_line, condition }) => ({ line: start, end_line, condition })),
      summary: rawLines[index].trim(),
    }];
  });
}

function testBodyAssertions(text, declarationLine, facts, sourcePath = "test.js") {
  const inspected = (first, last) => ({
    status: "block-inspected",
    assertions: facts.filter((fact) => fact.observations?.includes("assertion") &&
      fact.line >= first && fact.line <= last).map(({ line, summary }) => ({ line, expression: summary })),
  });
  const unsupported = () => ({ status: "unsupported-body", assertions: [] });
  if (/\.py$/i.test(sourcePath)) {
    const lines = maskStack(text, "python").split(/\r?\n/);
    const declaration = lines[declarationLine - 1];
    if (!declaration || declaration.includes("\t") || !/^\s*(?:async\s+)?def\s+test_\w+\s*\(.*\)\s*(?:->[^:]+)?\s*:\s*$/.test(declaration)) return unsupported();
    const indent = declaration.length - declaration.trimStart().length;
    let last = declarationLine;
    for (let index = declarationLine; index < lines.length; index += 1) {
      if (lines[index].trim() && lines[index].length - lines[index].trimStart().length <= indent) break;
      if (lines[index].includes("\t")) return unsupported();
      if (/^\s*(?:async\s+)?def\b|^\s*class\b/.test(lines[index])) return unsupported();
      last = index + 1;
    }
    return inspected(declarationLine + 1, last);
  }
  if (/\.cs$|\.ps1$/i.test(sourcePath)) {
    const code = /\.cs$/i.test(sourcePath) ? maskCode(text) : maskStack(text, "powershell");
    const lines = code.split(/\r?\n/);
    let startLine = declarationLine - 1;
    if (/\.cs$/i.test(sourcePath)) {
      while (startLine < Math.min(lines.length, declarationLine + 5) &&
          !/^\s*(?:\[[^\]]+\]\s*)*(?:public|internal|private|protected)\s+(?:[\w<>,[\]?]+\s+)+\w+\s*\(/.test(lines[startLine])) startLine += 1;
      if (startLine >= Math.min(lines.length, declarationLine + 5)) return unsupported();
    } else if (!/^\s*It\s+/i.test(text.split(/\r?\n/)[startLine])) return unsupported();
    const start = code.split("\n").slice(0, startLine).join("\n").length + (startLine ? 1 : 0);
    const opening = code.indexOf("{", start);
    if (opening < 0 || code.slice(start, opening).includes(";") || code.slice(start, opening).includes("=>")) return unsupported();
    if (/\.ps1$/i.test(sourcePath) && /\n\s*It\b/i.test(code.slice(start, opening))) return unsupported();
    const end = closingBrace(code, opening);
    if (end < 0) return unsupported();
    return inspected(lineAt(code, opening), lineAt(code, end));
  }
  const code = maskCode(text);
  const start = text.split("\n").slice(0, declarationLine - 1).join("\n").length + (declarationLine > 1 ? 1 : 0);
  const remaining = code.slice(start);
  const declaration = /^\s*(?:it|test)(?:\.(?:only|skip|todo))?\s*\(/.exec(remaining);
  if (!declaration) return { status: "unsupported-body", assertions: [] };
  const callback = /(?:=>|function\s*\([^)]*\))\s*\{/.exec(remaining);
  const nextTest = /\b(?:it|test)(?:\.(?:only|skip|todo))?\s*\(/g;
  nextTest.lastIndex = declaration.index + declaration[0].length;
  const next = nextTest.exec(remaining);
  if (!callback || (next && next.index < callback.index)) return { status: "unsupported-body", assertions: [] };
  const opening = start + callback.index + callback[0].lastIndexOf("{"), end = closingBrace(code, opening);
  if (end < 0) return { status: "unsupported-body", assertions: [] };
  const firstLine = lineAt(code, opening), lastLine = lineAt(code, end);
  // Same-line neighboring callbacks cannot be attributed reliably by line evidence.
  if (next && lineAt(code, start + next.index) <= lastLine) return { status: "unsupported-body", assertions: [] };
  return {
    status: "block-inspected",
    assertions: facts.filter((fact) => fact.observations?.includes("assertion") &&
      fact.line >= firstLine && fact.line <= lastLine).map(({ line, summary }) => ({ line, expression: summary })),
  };
}

module.exports = { behaviorFacts, testBodyAssertions, maskCode };
