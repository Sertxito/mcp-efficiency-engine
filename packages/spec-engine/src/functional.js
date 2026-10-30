"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");
const { projectPath, ensureDirectory, isScaffolding, listBrownfieldSpecs, readProposal } = require("./brownfield");

const text = z.string().trim().min(8).max(4000).refine((value) =>
  !/<!--|\b(?:TODO|TBD|placeholder|lorem ipsum)\b|Owner-confirmed normal behavior|Define a representative valid input/i.test(value),
"Replace placeholders with source-specific behavior or an explicit open question.");
const items = z.array(text).min(1).max(100);
const identifier = z.string().regex(/^[A-Z]+-\d{3}$/);
const caseTitle = text.refine((value) =>
  !/^(?:valid input|invalid input|normal behavio[u]?r|happy path|boundary case|error handling|entrada valida|entrada invalida|caso positivo|caso negativo|comportamiento normal)$/i.test(
    value.normalize("NFKD").replace(/\p{Diacritic}/gu, "")),
"Use a concrete business action, not a generic test category.");
const evidence = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  quote: text,
}).strict();
const schema = z.object({
  language: z.enum(["es", "en"]),
  title: text,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  summary: text,
  scope: items,
  non_goals: items,
  actors: z.array(z.object({ id: identifier, name: z.string().trim().min(2).max(120), goal: text }).strict()).min(1).max(30),
  use_cases: z.array(z.object({
    id: identifier,
    title: caseTitle,
    actor: identifier,
    basis: z.enum(["documented", "observed", "proposed"]),
    trigger: text,
    preconditions: items,
    main_flow: z.array(text).min(2).max(30),
    alternatives: items,
    postconditions: items,
    rules: items,
    acceptance_criteria: z.array(z.object({ given: text, when: text, then: text }).strict()).min(1).max(30),
    evidence: z.array(evidence).min(1).max(20),
  }).strict()).min(1).max(100),
  open_questions: z.array(text).max(100),
  coverage: z.array(z.object({
    path: z.string().min(1),
    line: z.number().int().positive(),
    status: z.enum(["covered", "deferred", "out-of-scope"]),
    use_cases: z.array(identifier).max(100),
    reason: text,
  }).strict()).min(1).max(1000),
}).strict();

function isSpecificationTask(task) {
  const normalized = task.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const artifact = /\b(?:functional spec(?:ification)?s?|use cases?|casos de uso|especificaciones?(?: funcional(?:es)?)?)\b/.test(normalized);
  const authoring = /\b(?:create|write|draft|generate|prepare|derive|produce|crear?|genera\w*|redacta\w*|prepara\w*|elabora\w*|define|definir|saca\w*)\b/.test(normalized);
  return artifact && authoring ||
    /^\s*(?:(?:haz(?:me)?|ejecuta|lanza|run)\s+(?:(?:el|un)\s+)?|(?:el\s+)?)(?:greenfield|brownfield)\b/.test(normalized);
}

function digest(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function prepareFunctionalSources(root, files) {
  let bytes = 0;
  const sources = [...new Set(files)].filter((file) => !isScaffolding(root, file)).map((file) => {
    let original = null;
    if (/\.(?:pdf|docx?|pptx?|xlsx?|odt|ods|odp|rtf|png|jpe?g|gif|webp)$/i.test(file)) {
      const manifestFile = projectPath(root, "knowledge/traceability/source-manifest.json");
      if (!fs.existsSync(manifestFile)) throw new Error(`Functional specification blocked: synchronize and convert ${file} before authoring.`);
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      const entry = manifest.generated_by === "mcpee" && Array.isArray(manifest.sources)
        ? manifest.sources.find((source) => source.path === file) : null;
      if (!entry || !["processed", "unchanged"].includes(entry.status) || !entry.normalized_path ||
          digest(fs.readFileSync(projectPath(root, file))) !== entry.sha256) {
        throw new Error(`Functional specification blocked: no current converted text for ${file}; run mcpee sync and resolve document-processing failures.`);
      }
      original = { original_path: file, original_sha256: entry.sha256 };
      file = entry.normalized_path;
    }
    const filename = projectPath(root, file);
    bytes += fs.statSync(filename).size;
    if (bytes > 2 * 1024 * 1024) {
      throw new Error("Functional specification sources exceed the 2 MiB limit. Narrow the task to one product area before starting a paid execution.");
    }
    const buffer = fs.readFileSync(filename);
    if (buffer.includes(0)) throw new Error(`Functional specification blocked: ${file} is not readable text; convert it before authoring.`);
    const contents = buffer.toString("utf8");
    const lines = contents.split(/\r?\n/);
    const allHeadings = /\.mdx?$/i.test(file)
      ? lines.flatMap((line, index) => {
        const heading = line.match(/^(#{1,2})\s+(.+?)\s*#*\s*$/);
        return heading ? [{ line: index + 1, title: heading[2], level: heading[1].length }] : [];
      }) : [];
    const topLevel = allHeadings.filter(({ level }) => level === 1);
    const headings = topLevel.length > 1 ? topLevel
      : allHeadings.some(({ level }) => level === 2) ? allHeadings.filter(({ level }) => level === 2) : topLevel;
    return { path: file, sha256: digest(buffer), headings, lines, ...original };
  });
  if (!sources.length) {
    throw new Error("Functional specification blocked: no product sources selected. Add or explicitly name the requirements document for greenfield, or the relevant application sources for brownfield; MCPEE configuration is not product evidence.");
  }
  return sources;
}

function functionalPrompt(sources, mode) {
  return [
    `Functional specification authoring (${mode}). Static discovery is an evidence inventory, NOT the requested deliverable.`,
    "Read the selected product sources once. Write in the user's language. Do not implement application code, install dependencies, approve requirements, or run specs discover as a substitute for analysis.",
    "The final assistant message MUST be one JSON object with the shape below (no commentary). MCPEE validates it and renders a readable Markdown specification under docs/specifications/. Do not write that file yourself.",
    "Use concrete business actors, goals, triggers, numbered flows, alternatives, postconditions, business rules and observable Given/When/Then criteria. Do not provide generic valid/invalid-input scenarios. Keep uncertain rules as open questions; label proposed behavior. Brownfield observations are not automatically desired behavior.",
    "Every use case needs an exact source-line quote. Evidence proves provenance, not semantic correctness. Account for EVERY supplied top-level source section in coverage, including its subsections, using its exact path and line. Mark covered only with related use-case IDs; deferred or out-of-scope requires a concrete reason. Do not hide omissions by calling a partial draft exhaustive.",
    "IDs use ACT-001 for actors and UC-001 for use cases. Keep the slug descriptive and stable; existing different files are preserved, not overwritten. If blocked by missing or contradictory sources, explain the blocker instead of fabricating this object; validation will report the task incomplete.",
    JSON.stringify({
      language: "en",
      title: "Specific product functional specification",
      slug: "specific-product-functional-specification",
      summary: "Describe the product outcome and the boundary of this draft.",
      scope: ["Concrete included product behavior."],
      non_goals: ["Concrete behavior explicitly excluded or not authorized."],
      actors: [{ id: "ACT-001", name: "Concrete actor", goal: "The actor's specific product goal." }],
      use_cases: [{
        id: "UC-001", title: "Concrete business action", actor: "ACT-001", basis: "documented",
        trigger: "Specific event that initiates the use case.",
        preconditions: ["State required before the action."],
        main_flow: ["The actor performs a specific action.", "The system returns an observable product result."],
        alternatives: ["Specific unavailable or exceptional state and its visible outcome."],
        postconditions: ["Observable state after completion."],
        rules: ["Business rule supported by the source, not a technical invention."],
        acceptance_criteria: [{ given: "Concrete initial state.", when: "Concrete actor action.", then: "Exact observable outcome." }],
        evidence: [{ path: "Selected source path", line: 1, quote: "Exact excerpt from that source line" }],
      }],
      open_questions: ["A specific unresolved decision; use an empty array if none."],
      coverage: [{ path: "Selected source path", line: 1, status: "covered", use_cases: ["UC-001"], reason: "How the use case addresses this source section." }],
    }),
    "Selected sources and required section coverage (read source files for their full content):",
    JSON.stringify(sources.map(({ lines, ...source }) => source)),
    "Structural validation and quote matching do not certify business completeness or correctness; the result remains a draft for human review.",
  ].join("\n\n");
}

function validateFunctionalSpec(root, response, sources) {
  let document;
  try {
    document = schema.parse(JSON.parse(response.trim().replace(/^```json\s*\n([\s\S]*?)\n```\s*$/, "$1")));
  } catch (error) {
    throw new Error(`Functional specification incomplete: expected the structured deliverable with non-empty, concrete use cases. ${error.message}`, { cause: error });
  }
  const byPath = new Map(sources.map((source) => [source.path, source]));
  const actors = new Set(document.actors.map(({ id }) => id));
  const cases = new Set(document.use_cases.map(({ id }) => id));
  if (actors.size !== document.actors.length || cases.size !== document.use_cases.length) {
    throw new Error("Functional specification incomplete: duplicate actor or use-case IDs.");
  }
  for (const source of sources) {
    if (digest(fs.readFileSync(projectPath(root, source.path))) !== source.sha256 ||
        source.original_path && digest(fs.readFileSync(projectPath(root, source.original_path))) !== source.original_sha256) {
      throw new Error(`Functional specification source changed during execution: ${source.path}. Review the new source before retrying.`);
    }
  }
  for (const useCase of document.use_cases) {
    if (!actors.has(useCase.actor)) throw new Error(`Unknown actor in ${useCase.id}: ${useCase.actor}`);
    for (const reference of useCase.evidence) {
      const source = byPath.get(reference.path);
      if (!source || !source.lines[reference.line - 1]?.includes(reference.quote)) {
        throw new Error(`Unsupported evidence in ${useCase.id}: ${reference.path}:${reference.line}; an exact selected-source quote is required.`);
      }
    }
  }
  const covered = new Set();
  for (const section of document.coverage) {
    const source = byPath.get(section.path);
    if (!source || (source.headings.length
      ? !source.headings.some(({ line }) => line === section.line) : section.line !== 1)) {
      throw new Error(`Unknown source section in coverage: ${section.path}:${section.line}`);
    }
    const key = `${section.path}:${section.line}`;
    if (covered.has(key)) throw new Error(`Duplicate source section in coverage: ${key}`);
    covered.add(key);
    if (section.use_cases.some((id) => !cases.has(id)) ||
        (section.status === "covered" && !section.use_cases.length)) {
      throw new Error(`Invalid use-case mapping for source section: ${key}`);
    }
    if (section.status === "covered") {
      const end = source.headings.find(({ line }) => line > section.line)?.line || source.lines.length + 1;
      if (!section.use_cases.some((id) => document.use_cases.find((item) => item.id === id).evidence
        .some((reference) => reference.path === section.path && reference.line >= section.line && reference.line < end))) {
        throw new Error(`Unsupported covered section: ${key}; a mapped use case needs evidence inside that section.`);
      }
    }
  }
  for (const source of sources) {
    for (const { line } of source.headings.length ? source.headings : [{ line: 1 }]) {
      if (!covered.has(`${source.path}:${line}`)) {
        throw new Error(`Functional specification incomplete: missing section coverage for ${source.path}:${line}`);
      }
    }
  }
  return document;
}

function renderFunctionalSpec(document, sources) {
  const label = (english, spanish) => document.language === "es" ? spanish : english;
  const bullet = (values) => values.map((value) => `- ${value}`).join("\n");
  const numbered = (values) => values.map((value, index) => `${index + 1}. ${value}`).join("\n");
  const sourceLink = (file, line) => `[${file}:${line}](../../${file.split("/").map(encodeURIComponent).join("/")}#L${line})`;
  return [
    "<!-- MCPEE functional specification draft; human review required -->",
    `# ${document.title}`, "",
    label("> Draft, not approved. Structural checks are not a semantic review.", "> Borrador no aprobado. La validacion estructural no sustituye la revision funcional."),
    "", document.summary, "", `## ${label("Scope", "Alcance")}`, bullet(document.scope),
    "", `## ${label("Non-goals", "Fuera de alcance")}`, bullet(document.non_goals),
    "", `## ${label("Actors", "Actores")}`,
    ...document.actors.map((actor) => `- **${actor.id} - ${actor.name}:** ${actor.goal}`),
    "", `## ${label("Use cases", "Casos de uso")}`,
    ...document.use_cases.flatMap((useCase) => [
      "", `### ${useCase.id} - ${useCase.title}`, "",
      `**Actor:** ${document.actors.find(({ id }) => id === useCase.actor).name}`,
      `**${label("Basis", "Base")}:** ${label(useCase.basis, { documented: "documentado", observed: "observado", proposed: "propuesto" }[useCase.basis])}`,
      `**${label("Trigger", "Inicio")}:** ${useCase.trigger}`,
      "", `#### ${label("Preconditions", "Precondiciones")}`, bullet(useCase.preconditions),
      "", `#### ${label("Main flow", "Flujo principal")}`, numbered(useCase.main_flow),
      "", `#### ${label("Alternatives and errors", "Alternativas y errores")}`, bullet(useCase.alternatives),
      "", `#### ${label("Postconditions", "Resultado")}`, bullet(useCase.postconditions),
      "", `#### ${label("Business rules", "Reglas de negocio")}`, bullet(useCase.rules),
      "", `#### ${label("Acceptance criteria", "Criterios de aceptacion")}`,
      ...useCase.acceptance_criteria.map((criterion, index) =>
        `${index + 1}. **${label("Given", "Dado")}:** ${criterion.given} **${label("When", "Cuando")}:** ${criterion.when} **${label("Then", "Entonces")}:** ${criterion.then}`),
      "", `#### ${label("Sources", "Fuentes")}`,
      ...useCase.evidence.map((reference) => `- ${sourceLink(reference.path, reference.line)}: ${reference.quote}`),
    ]),
    "", `## ${label("Open questions", "Decisiones pendientes")}`,
    document.open_questions.length ? bullet(document.open_questions) : label("None recorded.", "Ninguna registrada."),
    "", `## ${label("Source coverage", "Cobertura de fuentes")}`,
    ...document.coverage.map((section) => `- ${sourceLink(section.path, section.line)} - **${section.status}** (${section.use_cases.join(", ") || "-"}): ${section.reason}`),
    "", `## ${label("Provenance", "Trazabilidad")}`,
    ...sources.flatMap((source) => [
      `- ${source.path}: SHA-256 \`${source.sha256}\``,
      ...(source.original_path ? [`- Original: ${source.original_path}: SHA-256 \`${source.original_sha256}\``] : []),
    ]), "",
  ].join("\n");
}

function publishFunctionalSpec(root, response, sources) {
  const document = validateFunctionalSpec(root, response, sources);
  const content = renderFunctionalSpec(document, sources);
  const relative = `docs/specifications/${document.slug}.md`;
  ensureDirectory(root, "docs/specifications");
  const filename = projectPath(root, relative);
  if (fs.existsSync(filename)) {
    if (fs.readFileSync(filename, "utf8") !== content) {
      throw new Error(`Functional specification not saved: ${relative} already exists with different content. Preserve it and choose a new descriptive revision slug.`);
    }
  } else {
    fs.writeFileSync(filename, content, { encoding: "utf8", flag: "wx" });
  }
  const reviews = completeReviewProposals(root, document, sources, relative);
  return { path: relative, content, reviews, useCaseCount: document.use_cases.length, deferredSections: document.coverage.filter(({ status }) => status !== "covered").length };
}

function completeReviewProposals(root, document, sources, documentPath) {
  const hashes = new Map(sources.flatMap((source) => [
    [source.path, source.sha256],
    ...(source.original_path ? [[source.original_path, source.original_sha256]] : []),
  ]));
  const originalPaths = new Map(sources.map((source) => [source.path, source.original_path || source.path]));
  const reviews = [];
  for (const spec of listBrownfieldSpecs(root).filter(({ status }) => status === "proposed")) {
    const proposal = readProposal(root, spec.slug);
    if (!proposal.evidence.sources.every((source) => hashes.get(source.path) === source.sha256)) continue;
    const paths = new Set(proposal.evidence.sources.map(({ path: file }) => file));
    const cases = document.use_cases.filter((useCase) => useCase.evidence.every((reference) => paths.has(originalPaths.get(reference.path))));
    if (!cases.length) continue;
    const behaviorPrompt = "<!-- Replace this prompt with behavior confirmed by the accountable owner. -->";
    const criteriaPrompt = "<!-- Add observable, testable criteria and link each criterion to evidence. -->";
    if (!proposal.content.includes(behaviorPrompt) || !proposal.content.includes(criteriaPrompt)) {
      reviews.push({ slug: spec.slug, path: spec.path, sha256: spec.sha256, status: "preserved-existing-review" });
      continue;
    }
    const behavior = [
      `Draft for owner review. Read [the functional specification](${path.posix.relative(path.posix.dirname(spec.path), documentPath)}).`,
      ...cases.flatMap((useCase) => [
        "", `### ${useCase.id} - ${useCase.title}`, "",
        `Actor: ${document.actors.find(({ id }) => id === useCase.actor).name}. Basis: ${useCase.basis}.`,
        useCase.trigger, ...useCase.preconditions,
        ...useCase.main_flow.map((step, index) => `${index + 1}. ${step}`),
        ...[...useCase.alternatives, ...useCase.postconditions, ...useCase.rules].map((item) => `- ${item}`),
      ]),
      "", "Open decisions:", ...document.open_questions.map((question) => `- ${question}`),
      "", "Source coverage declared by the author:",
      ...document.coverage.filter((section) => paths.has(originalPaths.get(section.path))).map((section) =>
        `- ${section.path}:${section.line} - ${section.status}: ${section.reason}`),
    ].join("\n");
    const criteria = cases.flatMap((useCase) => useCase.acceptance_criteria.map((criterion, index) =>
      `- ${useCase.id}.${index + 1}: Given ${criterion.given} When ${criterion.when} Then ${criterion.then}`)).join("\n");
    const content = proposal.content.replace(behaviorPrompt, () => behavior).replace(criteriaPrompt, () => criteria);
    const filename = projectPath(root, spec.path);
    const temporary = projectPath(root, `${spec.path}.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, filename);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    reviews.push({ slug: spec.slug, path: spec.path, sha256: digest(content), status: "draft-filled-for-review" });
  }
  return reviews;
}

module.exports = { isSpecificationTask, prepareFunctionalSources, functionalPrompt, validateFunctionalSpec, renderFunctionalSpec, publishFunctionalSpec };
