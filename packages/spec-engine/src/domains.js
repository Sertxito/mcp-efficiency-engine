"use strict";

const path = require("node:path");

const MAX_SOURCES = 20;
const MAX_DECLARED_CASES = 40;
const MAX_FACTS = 4;
const CONTAINERS = /^(?:features?|modules?|domains?|core|requests?|responses?)$/i;
const GENERIC = /^(?:src|app|lib|tests?|e2e|unit|integration|public|shared|common|contracts|dtos?|components?|services?|models?|entities|interfaces|repositories|controllers|data|configurations?|backend|frontend|api|application|infrastructure|domain|index)$/i;
const TECHNICAL = /^(?:base|app|program|dependency|environment|extension|http|identity|content|social|design|accessibility|grid|button|badge|card|form|token|permission|role|main|scaffold|audit|batch|unit|repository|tech|angular|package|tsconfig|eslint|prettier|vite|webpack|playwright|karma|jest|vitest)$/;

function words(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function key(value) {
  return words(value).map((word) =>
    word.endsWith("ies") ? `${word.slice(0, -3)}y`
      : word.length > 3 && /[^s]s$/.test(word) ? word.slice(0, -1) : word).join("-");
}

function stem(sourcePath) {
  const name = path.posix.basename(sourcePath)
    .replace(/\.(?:test|spec)\.[^.]+$/, "").replace(/\.[^.]+$/, "")
    .replace(/^I(?=[A-Z])/, "");
  const tokens = words(name);
  while (tokens.length && /^(?:controller|service|repository|request|response|dto|configuration|component|guard|spec|test|tests|integration|unit|interface)$/.test(tokens.at(-1))) tokens.pop();
  return key(tokens.join("-")) || "shared";
}

function anchor(sourcePath) {
  const parts = sourcePath.split("/");
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (CONTAINERS.test(parts[index]) && !GENERIC.test(parts[index + 1])) return key(parts[index + 1]);
  }
  return null;
}

function partitionDomains(sources) {
  const familyCounts = new Map();
  for (const source of sources) {
    if (anchor(source.path) || source.category !== "source-code" ||
        /(?:^|\/)shared\//i.test(source.path) ||
        /\.(?:html?|s?css|less)$|\.stories\./i.test(source.path)) continue;
    const family = stem(source.path).split("-")[0];
    if (!GENERIC.test(family) && !TECHNICAL.test(family)) familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }
  const anchors = [...new Set([
    ...sources.map((source) => anchor(source.path)).filter(Boolean),
    ...[...familyCounts.entries()].filter(([, count]) => count >= 3).map(([family]) => family),
  ])]
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  const groups = new Map();
  for (const source of sources) {
    const direct = anchor(source.path);
    const name = stem(source.path);
    const matched = anchors.find((candidate) => name === candidate || name.startsWith(`${candidate}-`));
    let domain = direct || matched;
    let reason = direct ? "explicit-directory-name" : "filename-prefix-match";
    if (!domain) {
      reason = "technical-or-filename-fallback";
      if (/(?:^|\/)migrations?\//i.test(source.path)) domain = "persistence-migrations";
      else if (["infrastructure", "pipelines", "configuration"].includes(source.category)) domain = "platform";
      else if (["business", "documentation", "architecture", "decisions"].includes(source.category)) domain = "project-documentation";
      else if (/(?:^|\/)shared\//i.test(source.path)) domain = "shared";
      else domain = "shared-application";
    }
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push({ ...source, grouping: { basis: reason, certainty: "inferred" } });
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([domain, members]) => {
      const parts = [];
      let current = [];
      let cases = 0;
      for (const source of members.sort((left, right) => left.path.localeCompare(right.path))) {
        const count = Math.min(source.test_cases.length, MAX_DECLARED_CASES);
        if (current.length && (current.length >= MAX_SOURCES || cases + count > MAX_DECLARED_CASES)) {
          parts.push(current);
          current = [];
          cases = 0;
        }
        current.push(source);
        cases += count;
      }
      if (current.length) parts.push(current);
      return parts.map((part, index) => ({
        domain,
        part: index + 1,
        parts: parts.length,
        sources: part,
      }));
    });
}

function sourceFacts(text, sourcePath) {
  const facts = [];
  const lines = text.split(/\r?\n/);
  const csharp = /\.cs$/i.test(sourcePath);
  let pending = [];
  let inBlockComment = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("/*")) {
      inBlockComment = !line.includes("*/");
      continue;
    }
    if (line.startsWith("//")) continue;
    if (csharp) {
      const constraint = line.match(/^\[(Required|StringLength|MinLength|MaxLength|Range|EmailAddress)(?:\(([^)]*)\))?\]$/);
      if (constraint) pending.push({ constraint: constraint[1], arguments: constraint[2] || "", line: index + 1 });
      const property = line.match(/^public\s+([\w<>?,.\[\]]+)\s+(\w+)\s*\{\s*get;/);
      if (property) {
        for (const rule of pending) facts.push({
          kind: "validation-declaration",
          field: property[2],
          rule: rule.constraint,
          arguments: rule.arguments,
          line: rule.line,
          certainty: "observed-declaration",
          summary: `${property[2]} declares ${rule.constraint}${rule.arguments ? `(${rule.arguments})` : ""}; runtime enforcement not verified.`,
        });
        pending = [];
      } else if (line && !line.startsWith("[")) pending = [];
      const route = line.match(/^\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete|Route)(?:\(\s*"([^"]*)"\s*\))?\]$/);
      if (route) facts.push({
        kind: "route-declaration",
        line: index + 1,
        certainty: "observed-declaration",
        summary: `${route[1]}${route[2] ? `("${route[2]}")` : ""} is declared; effective route and authorization require review.`,
      });
      if (/^\[Authorize(?:\([^)]*\))?\]$/.test(line)) facts.push({
        kind: "authorization-declaration",
        line: index + 1,
        certainty: "observed-declaration",
        summary: `${line} is declared; effective access control and inherited policies require review.`,
      });
    }
  }
  return facts;
}

function table(value) {
  return String(value).replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/`/g, "'");
}

function syntaxTable(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "[": "&#91;", "]": "&#93;", "|": "&#124;", "`": "&#96;", "*": "&#42;", "_": "&#95;", "\\": "&#92;" };
  return String(value).replace(/[\r\n]+/g, " ").replace(/[&<>[\]|`*_\\]/g, (char) => entities[char]);
}

function sourceLink(sourcePath, line, from) {
  const relative = path.posix.relative(path.posix.dirname(from), sourcePath);
  return `[${table(sourcePath)}${line ? `:${line}` : ""}](${relative.split("/").map(encodeURIComponent).join("/")}${line ? `#L${line}` : ""})`;
}

function boundaryReview(fact) {
  const limit = fact.arguments.match(/^\s*(\d+)\s*(?:,|$)/);
  if (limit && ["StringLength", "MaxLength", "MinLength"].includes(fact.rule)) {
    const number = Number(limit[1]);
    const minimumMatch = fact.arguments.match(/\bMinimumLength\s*=\s*(\d+)/);
    const lengths = fact.rule === "MinLength"
      ? [Math.max(0, number - 1), number, number + 1]
      : [...(minimumMatch
        ? [Math.max(0, Number(minimumMatch[1]) - 1), Number(minimumMatch[1])]
        : [0]), number, number + 1];
    if (lengths.every(Number.isSafeInteger)) {
      return `Try input lengths ${[...new Set(lengths)].join(", ")}; verify accepted limits and rejected out-of-range values when this validator is active. Review required/nullability rules separately.`;
    }
  }
  return "Identify the declared limits; exercise below, at, and above each limit. Confirm the runtime outcome.";
}

function testCases(sources) {
  const declared = sources.flatMap((source) => source.test_cases.map((testCase) => ({
    kind: "declared",
    title: testCase.name,
    source: source.path,
    line: testCase.line,
    behavior: "not-assessed",
    automation: testCase.declaration === "disabled" ? "declared-disabled" : "declared",
    execution: testCase.declaration === "disabled" ? "disabled-not-run" : "not-verified",
    ...(testCase.body_evidence ? { body_evidence: testCase.body_evidence } : {}),
    review: testCase.body_evidence?.assertions.length
      ? `${testCase.body_evidence.assertions.length} assertion statements observed at ${testCase.body_evidence.assertions.map((item) => `L${item.line}`).join(", ")}; read exact expressions in the observation catalog. Inspect fixtures and execution; syntax is not proof of coverage or success.`
      : "Inspect the assertions and fixtures; a name is not an acceptance criterion.",
  })));
  const validationCases = sources.flatMap((source) => source.facts
    .filter((fact) => fact.kind === "validation-declaration").map((fact) => ({
      kind: fact.rule === "Required" || fact.rule === "EmailAddress" ? "negative-candidate" : "boundary-candidate",
      title: `${fact.field}: ${fact.rule}${fact.arguments ? `(${fact.arguments})` : ""}`,
      source: source.path,
      line: fact.line,
      behavior: "observed-declaration",
      automation: "not-assessed",
      execution: "not-run-by-discovery",
      review: fact.rule === "Required"
        ? "Try an omitted and null value; confirm rejection behavior and absence of unintended writes."
        : fact.rule === "EmailAddress"
          ? "Try a malformed address; confirm the validation error contract."
          : boundaryReview(fact),
    })));
  const authorizationCases = sources.flatMap((source) => source.facts
    .filter((fact) => fact.kind === "authorization-declaration")
    .map((fact) => ({
      kind: "negative-candidate",
      title: "Missing identity or wrong role/policy",
      source: source.path,
      line: fact.line,
      behavior: "observed-declaration",
      automation: "not-assessed",
      execution: "not-run-by-discovery",
      review: "Use isolated identities without the declared access; confirm rejection and no unauthorized side effects. Resolve the effective policy first.",
    })));
  const implementationCases = sources.filter((source) => source.category !== "tests")
    .flatMap((source) => source.facts.filter((fact) =>
      fact.kind === "implementation-observation" && fact.enclosing_conditions.length &&
      fact.observations.some((kind) => kind === "return" || kind === "throw"))
      .map((fact) => ({
        kind: "implementation-candidate",
        title: `${fact.scope}: ${fact.enclosing_conditions.map((guard) => guard.condition).join(" AND ")} -> ${fact.summary}`,
        source: source.path, line: fact.line,
        behavior: "observed-syntax", automation: "not-assessed", execution: "not-run-by-discovery",
        review: "A return/throw is lexically inside the cited if-condition(s). Inspect surrounding flow, inputs and dependencies before writing a characterization test; reachability and exact runtime outcome are not established.",
      })));
  const candidates = [
    {
      kind: "positive-candidate",
      title: "Owner-confirmed normal behavior",
      review: "Define a representative valid input and exact observable output; map it to an approved criterion.",
    },
    {
      kind: "negative-candidate",
      title: "Invalid or incomplete input",
      review: "Define invalid input and expected error/no-side-effects contract; determine applicability with the owner.",
    },
    {
      kind: "boundary-candidate",
      title: "Empty, minimum and maximum input",
      review: "Identify actual domain limits first; do not invent numeric thresholds.",
    },
    {
      kind: "negative-candidate",
      title: "Dependency failure or unavailable resource",
      review: "Confirm applicability, error result, bounded retry/timeout policy and recovery; do not call live services.",
    },
  ].map((item) => ({
    ...item, source: sources[0].path, line: 1,
    behavior: "not-assessed", automation: "not-assessed", execution: "not-run-by-discovery",
  }));
  return [...declared, ...validationCases, ...authorizationCases, ...implementationCases, ...candidates]
    .map((item, index) => ({ id: `TC-${String(index + 1).padStart(3, "0")}`, ...item }));
}

function caseStatus(item) {
  return `${item.behavior} | ${item.automation} | ${item.execution}`;
}

function renderObservationPages({ slug, sources, specPath, evidencePath, formatVersion = 8 }) {
  const cell = formatVersion >= 7 ? syntaxTable : table;
  const facts = sources.flatMap((source) => source.facts.map((fact) => ({ ...fact, source: source.path })));
  const count = Math.ceil(facts.length / 40);
  return Array.from({ length: count }, (_, index) => ({
    path: `${path.posix.dirname(specPath)}/${slug}.observations-${index + 1}.md`,
    content: [
      "<!-- MCPEE generated implementation evidence; not approved behavior -->", "",
      `# Implementation observations - page ${index + 1}/${count}`, "",
      `[Back to proposal](${path.posix.basename(specPath)})`,
      ...(index ? [`[Previous observations](${slug}.observations-${index}.md)`] : []),
      ...(index + 1 < count ? [`[Next observations](${slug}.observations-${index + 2}.md)`] : []),
      "",
      "Exact redacted source lines describe syntax, not executed behavior. Read surrounding code before interpreting conditions, return values, calls or side effects.",
      "Scope labels recognize simple block-bodied methods only. Calls are not resolved dependency edges; ordered lines are not a control-flow graph.",
      "Assertions express checks written in tests, not verified outcomes. Comments and quoted literals are masked during recognition; multiline statements and unsupported syntax may be missed.",
      "",
      "| ID | Observation | Enclosing scope | Lexical if-conditions | Source syntax / declaration | Evidence |",
      "| --- | --- | --- | --- | --- | --- |",
      ...facts.slice(index * 40, (index + 1) * 40).map((fact, offset) =>
        `| OBS-${String(index * 40 + offset + 1).padStart(3, "0")} | ${cell(fact.observations?.join(", ") || fact.kind)} | ${cell(fact.scope || "unresolved")} | ${cell(fact.enclosing_conditions?.map((guard) => `L${guard.line}: ${guard.condition}`).join("; ") || "not established")} | ${cell(fact.summary)} | ${sourceLink(fact.source, fact.line, specPath)}${formatVersion >= 8 && fact.target ? `; target: ${sourceLink(fact.target, null, specPath)}` : ""} |`),
      "",
      `All hashes and records: [evidence manifest](${path.posix.basename(evidencePath)}).`, "",
    ].join("\n"),
  }));
}

function renderCasePages({ slug, cases, specPath, evidencePath, formatVersion = 8 }) {
  const legacy = formatVersion < 5;
  const cell = formatVersion >= 7 ? syntaxTable : table;
  const pages = [];
  const count = Math.ceil(cases.length / 40);
  for (let page = 1; page <= count; page += 1) {
    const basename = `${slug}.cases-${page}.md`;
    pages.push({
      path: `${path.posix.dirname(specPath)}/${basename}`,
      content: [
        "<!-- MCPEE generated test-case evidence; not approved outcomes -->", "",
        `# Test cases - page ${page}/${count}`, "",
        `[Back to proposal](${path.posix.basename(specPath)})`,
        ...(page > 1 ? [`[Previous cases](${slug}.cases-${page - 1}.md)`] : []),
        ...(page < count ? [`[Next cases](${slug}.cases-${page + 1}.md)`] : []),
        "",
        "Declared tests are observations of names only: inspect assertions and fixtures before claiming coverage.",
        ...(legacy ? [
          "Candidates are unimplemented review scenarios. The owner must decide applicability and exact expected outcomes in the proposal's acceptance criteria.",
        ] : [
          "Behavior, test automation and execution are separate evidence dimensions; no status here means that product functionality is missing. observed-declaration means a cited validation or authorization declaration exists in product code, not verified runtime enforcement.",
          "Automation not-assessed means coverage has not been linked or ruled out, not that no test exists. not-run-by-discovery means this extraction did not execute the scenario.",
          formatVersion === 5
            ? "Generic scenarios have behavior not-assessed; their source link provides context only, not evidence that the scenario is implemented. The owner must decide applicability and exact expected outcomes in the proposal's acceptance criteria."
            : "observed-syntax scenarios cite returns/throws lexically inside if-blocks, not proven execution paths. Generic scenarios have behavior not-assessed; their source link provides context only, not implementation evidence. The owner must confirm applicability and expected outcomes.",
        ]),
        "These generated evidence pages are not hand-authored specifications; do not edit them to imply a passing test.",
        "",
        legacy
          ? "| ID | Type | Scenario / input | Evidence | Execution | Expected outcome / decision needed |"
          : "| ID | Type | Scenario / input | Evidence | Product behavior | Test automation | Execution | Expected outcome / decision needed |",
        legacy ? "| --- | --- | --- | --- | --- | --- |" : "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...cases.slice((page - 1) * 40, page * 40).map((item) =>
          `| ${item.id} | ${item.kind} | ${cell(item.title)} | ${sourceLink(item.source, item.line, specPath)} | ${legacy ? item.execution : caseStatus(item)} | ${cell(item.review)} |`),
        "",
        `Source hashes and case records: [evidence manifest](${path.posix.basename(evidencePath)}).`,
        "",
      ].join("\n"),
    });
  }
  return pages;
}

function renderDomainProposal({ slug, domain, part, parts, sources, cases, snapshotHash, specPath, evidencePath, marker }) {
  const declared = cases.filter((item) => item.kind === "declared");
  const validations = cases.filter((item) => item.kind !== "declared" && item.title !== "Owner-confirmed normal behavior");
  const facts = sources.flatMap((source) => source.facts.map((fact) => ({ ...fact, source: source.path })));
  const shownFacts = facts.slice(0, 10 * MAX_FACTS);
  const shownCases = [...declared.slice(0, MAX_DECLARED_CASES), ...cases.filter((item) => item.kind !== "declared").slice(0, 12)];
  const implementationCases = cases.filter((item) => item.kind === "implementation-candidate");
  return [
    marker, "",
    `# ${domain}${parts > 1 ? ` - part ${part}/${parts}` : ""}`,
    "",
    "**Status:** proposed — not an approved specification  ",
    `**Proposal ID:** \`${slug}\`  `,
    `**Source snapshot:** \`${snapshotHash}\``,
    "",
    `**Scope:** ${sources.length} sources; ${declared.length} test declarations; ${facts.length} static observations.`,
    "Domain membership is a path/name-based inference, not a confirmed business boundary.",
    "",
    "## Intended behavior", "",
    "<!-- Replace this prompt with behavior confirmed by the accountable owner. -->",
    "",
    "## Acceptance criteria", "",
    "<!-- Add observable, testable criteria and link each criterion to evidence. -->",
    "",
    "## Observed declarations", "",
    "These are static observations, not proof of intended behavior or runtime enforcement.",
    "",
    ...(shownFacts.length ? shownFacts.map((fact, index) =>
      `- **OBS-${String(index + 1).padStart(3, "0")}** ${syntaxTable(fact.summary)} ${sourceLink(fact.source, fact.line, specPath)}`)
      : ["- No supported contract declarations extracted. Review the sources below; absence of extracted facts is not absence of business rules."]),
    ...(facts.length ? [
      `[Read all ${facts.length} implementation and test observations](${slug}.observations-1.md).`,
      "The catalog includes recognized branches, returns, throws, exception handlers, call sites, state-operation calls and assertions. It does not reconstruct a complete execution path.",
    ] : []),
    ...(implementationCases.length ? [
      "",
      "## Implementation-derived characterization", "",
      "These are source-backed review scenarios, not approved requirements or proven execution paths.",
      ...implementationCases.slice(0, 6).map((item) =>
        `- **${item.id}** ${syntaxTable(item.title)} ${sourceLink(item.source, item.line, specPath)}`),
      `[Read all ${implementationCases.length} implementation-derived scenarios in the case catalog](${slug}.cases-1.md).`,
    ] : []),
    "",
    "## Test cases", "",
    "**Declared** means a test name was found, not that its assertions are sufficient or it passed.",
    "**Candidate** means a proposed review scenario, not missing product functionality. Confirm applicability and expected results.",
    "**Product behavior:** observed-declaration cites a declaration; observed-syntax cites code inside lexical if-conditions. Neither proves runtime behavior; not-assessed makes no implementation claim.",
    "**Test automation:** declared/declared-disabled identifies an existing test; not-assessed means coverage is unknown, not absent.",
    "**Execution:** discovery does not run these cases. Generic scenario links provide context only, not implementation evidence.",
    "",
    "| ID | Type | Scenario | Evidence | Product behavior | Test automation | Execution | Expected outcome / review |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...shownCases.map((item) =>
      `| ${item.id} | ${item.kind} | ${syntaxTable(item.title)} | ${sourceLink(item.source, item.line, specPath)} | ${caseStatus(item)} | ${syntaxTable(item.review)} |`),
    "",
    `[Read all ${cases.length} test cases, including negative and boundary candidates](${slug}.cases-1.md).`,
    ...(cases.length > shownCases.length
      ? [`The table above is a preview; ${cases.length - shownCases.length} more cases are in the paginated Markdown catalog, not hidden in JSON.`] : []),
    "",
    "## Review gaps", "",
    "- Owner and domain boundaries: unconfirmed.",
    "- Behavior and acceptance criteria: require owner-authored decisions.",
    `- Declared tests: ${declared.length}; implemented coverage and execution results: not verified.`,
    `- Suggested characterization/input/boundary reviews: ${validations.length}; expected outcomes remain unapproved.`,
    "- Cross-domain interactions and contradictions: not inferred from filenames; inspect connected code and documentation.",
    "",
    "## Source map", "",
    ...sources.map((source) => {
      const locators = [
        ...source.headings.slice(0, 2).map((heading) => `${table(heading.title)}:${heading.line ?? "?"}`),
        ...source.symbols.slice(0, 2).map((symbol) => `${table(symbol.name)}:${symbol.line ?? "?"}`),
      ].join("; ");
      return `- ${sourceLink(source.path, null, specPath)} - ${source.category}${locators ? `; ${locators}` : ""}`;
    }),
    "",
    `Hashes, all observations and case records: [evidence manifest](${path.posix.basename(evidencePath)}).`,
    "Do not ratify until behavior, acceptance criteria, expected outcomes and unresolved decisions have been reviewed.",
    "",
  ].join("\n");
}

module.exports = { partitionDomains, renderCasePages, renderObservationPages, renderDomainProposal, sourceFacts, testCases };
