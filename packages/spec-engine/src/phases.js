"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { z } = require("zod");
const { projectPath, ensureDirectory } = require("./brownfield");
const { readFeature, featureStatus, currentDigest } = require("./lifecycle");

const text = z.string().trim().min(8).max(4000).refine(value =>
  !/\b(?:TODO|TBD|placeholder|lorem ipsum)\b|<!--/i.test(value), "Concrete phase content is required.");
const caseId = z.string().regex(/^UC-\d{3}$/);
const safePath = z.string().min(1).refine(value =>
  !/^[\\/]|^[A-Za-z]:|[\r\n\0]|\\/.test(value) &&
  !value.split("/").some(segment => ["..", "", ".git", ".mcpee", "node_modules"].includes(segment)),
  "Use a project-relative product path, not an internal or escaping path.");
const check = z.object({
  id: z.string().regex(/^CHECK-\d{3}$/), command: text, expected: text,
}).strict();
const planSchema = z.object({
  title: text, specification_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  design: z.array(z.object({
    id: z.string().regex(/^DESIGN-\d{3}$/), description: text,
    use_cases: z.array(caseId).min(1), paths: z.array(safePath).min(1),
  }).strict()).min(1).max(100),
  checks: z.array(check).min(1).max(100),
  risks: z.array(z.object({
    description: text, requires_approval: z.boolean(),
    approval_action: z.enum(["deployment", "publication", "dependency-change", "destructive-operation",
      "sensitive-configuration", "permission-change", "external-transfer", "migration"]).optional(),
  }).strict().refine(risk => risk.requires_approval === Boolean(risk.approval_action),
  "An approval gate requires an actual typed risky action; missing validation or a scope disclaimer is not a human decision.")).max(100),
  open_questions: z.array(text).max(100),
}).strict();
const tasksSchema = z.object({
  title: text, specification_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  plan_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  tasks: z.array(z.object({
    id: z.string().regex(/^TASK-\d{3}$/), description: text,
    use_cases: z.array(caseId).min(1), paths: z.array(safePath).min(1),
    depends_on: z.array(z.string().regex(/^TASK-\d{3}$/)),
    checks: z.array(z.string().regex(/^CHECK-\d{3}$/)).min(1),
  }).strict()).min(1).max(300),
  open_questions: z.array(text).max(100),
}).strict();

function validatePhase(root, slug, stage, response) {
  if (!["plan", "tasks"].includes(stage)) throw new Error(`Unsupported authoring phase: ${stage}`);
  const document = (stage === "plan" ? planSchema : tasksSchema).parse(JSON.parse(response));
  const status = featureStatus(root, slug);
  if (!status.reviews.specification.approved || status.drift.length ||
      document.specification_sha256 !== status.reviews.specification.sha256) {
    throw new Error("Phase references an unvalidated or changed specification; route against the current canonical digest.");
  }
  const { manifest, directory } = readFeature(root, slug);
  const cases = new Set(manifest.cases.map(item => item.id));
  const entries = stage === "plan" ? document.design : document.tasks;
  const covered = new Set();
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate ${stage} entry: ${entry.id}`);
    ids.add(entry.id);
    for (const id of entry.use_cases) {
      if (!cases.has(id)) throw new Error(`Unknown use case in ${entry.id}: ${id}`);
      covered.add(id);
    }
    for (const file of entry.paths) projectPath(root, file);
  }
  if ([...cases].some(id => !covered.has(id))) throw new Error(`${stage} must account for every canonical use case.`);
  if (stage === "plan") {
    if (new Set(document.checks.map(item => item.id)).size !== document.checks.length) {
      throw new Error("Plan check IDs must be unique.");
    }
  } else {
    if (!status.reviews.plan.approved || document.plan_sha256 !== currentDigest(root, slug, "plan")) {
      throw new Error("Tasks require the current validated plan digest.");
    }
    const plan = JSON.parse(fs.readFileSync(projectPath(root, `${directory}/plan.json`), "utf8"));
    const checks = new Set(plan.checks.map(item => item.id));
    const plannedPaths = new Set(plan.design.flatMap(item => item.paths));
    for (const task of document.tasks) {
      if (task.paths.some(file => !plannedPaths.has(file))) throw new Error(`Task ${task.id} changes an unplanned path.`);
      if (task.checks.some(id => !checks.has(id))) throw new Error(`Task ${task.id} references an unknown validation check.`);
      if (new Set(task.depends_on).size !== task.depends_on.length ||
          task.depends_on.some(id => !ids.has(id) || id === task.id)) throw new Error(`Invalid dependency in ${task.id}.`);
    }
    const visited = new Set(), active = new Set();
    const visit = id => {
      if (active.has(id)) throw new Error(`Cyclic task dependencies: ${id}`);
      if (visited.has(id)) return;
      active.add(id);
      for (const parent of document.tasks.find(item => item.id === id).depends_on) visit(parent);
      active.delete(id);
      visited.add(id);
    };
    for (const id of ids) visit(id);
    const ancestors = id => {
      const result = new Set();
      const collect = dependency => {
        if (result.has(dependency)) return;
        result.add(dependency);
        for (const parent of document.tasks.find(task => task.id === dependency).depends_on) collect(parent);
      };
      for (const dependency of document.tasks.find(task => task.id === id).depends_on) collect(dependency);
      return result;
    };
    for (const task of document.tasks) {
      const prerequisiteIds = ancestors(task.id);
      const upstreamCases = new Set(document.tasks.filter(item => prerequisiteIds.has(item.id))
        .flatMap(item => item.use_cases));
      for (const id of task.use_cases) {
        for (const dependency of manifest.cases.find(item => item.id === id).dependencies) {
          if (!upstreamCases.has(dependency)) throw new Error(`Task ${task.id} must depend on work for prerequisite ${dependency}.`);
        }
      }
    }
  }
  return document;
}

function renderPhase(stage, document) {
  const link = id => `[${id}](${id}.md)`;
  const orderedTasks = [];
  if (stage === "tasks") {
    const added = new Set();
    const append = task => {
      if (added.has(task.id)) return;
      for (const dependency of task.depends_on) append(document.tasks.find(item => item.id === dependency));
      added.add(task.id);
      orderedTasks.push(task);
    };
    for (const task of document.tasks) append(task);
  }
  return [
    `# ${document.title}`, "", "[Canonical specification](spec.md)",
    ...(stage === "tasks" ? ["[Validated technical plan](plan.md)"] : []),
    "", "Validation authorizes phase progression, not product acceptance or execution of risky commands.", "",
    ...(stage === "plan" ? [
      "## Design", "",
      ...document.design.flatMap(item => [`### ${item.id}`, item.description,
        `Use cases: ${item.use_cases.map(link).join(", ")}`, `Paths: ${item.paths.join(", ")}`, ""]),
      "## Verification", "",
      ...document.checks.map(item => `- **${item.id}**: \`${item.command}\` — ${item.expected}`),
      "", "## Risks", "", ...document.risks.map(item =>
        `- ${item.description}${item.requires_approval ? " — HUMAN AUTHORIZATION REQUIRED" : ""}`),
    ] : [
      "## Dependency-ordered work", "",
      ...orderedTasks.map(item => `- [ ] **${item.id}**: ${item.description} | Cases: ${item.use_cases.map(link).join(", ")} | Paths: ${item.paths.join(", ")} | Depends on: ${item.depends_on.join(", ") || "none"} | Checks: ${item.checks.join(", ")}`),
    ]),
    "", "## Open decisions", "", ...document.open_questions.map(item => `- ${item}`), "",
  ].join("\n");
}

function phasePrompt(root, slug, stage) {
  const status = featureStatus(root, slug);
  const sample = stage === "plan" ? {
    title: "Concrete technical design", specification_sha256: status.reviews.specification.sha256,
    design: [{ id: "DESIGN-001", description: "Source-bound design for a specific outcome.",
      use_cases: ["UC-001"], paths: ["src/catalog.js", "tests/catalog.test.js"] }],
    checks: [{ id: "CHECK-001", command: "node --test tests/catalog.test.js", expected: "Anonymous search and no-results assertions pass." }],
    risks: [], open_questions: [],
  } : {
    title: "Concrete implementation tasks", specification_sha256: status.reviews.specification.sha256,
    plan_sha256: status.reviews.plan.sha256,
    tasks: [{ id: "TASK-001", description: "Implement one specific case and its regression check.",
      use_cases: ["UC-001"], paths: ["src/catalog.js"], depends_on: [], checks: ["CHECK-001"] }],
    open_questions: [],
  };
  return [
    `Author only the ${stage} phase for specs/${slug}/. Return one JSON object; MCPEE renders the canonical Markdown and manifest. Do not write files, implement code, execute commands or approve risky actions.`,
    "Read every canonical use case and decisions.md. For tasks, read plan.md and plan.json. Account for every use case, keep exact current digests, concrete paths and checks, and acyclic dependencies. Commands are proposed verification, not evidence they ran. Do not invent answers to contradictory requirements; record open_questions. Only an actual risky action proposed by this plan may set requires_approval true, with a matching approval_action. Missing visual/runtime acceptance or a disclaimer that local tests are not production acceptance is not a human approval gate.",
    "Shape example, not a reference solution:", JSON.stringify(sample),
    "Machine schema:", JSON.stringify(z.toJSONSchema(stage === "plan" ? planSchema : tasksSchema, { unrepresentable: "any" })),
  ].join("\n\n");
}

function phaseMarkdownMatches(stage, document, markdown) {
  return renderPhase(stage, document).trimEnd() === markdown.replace(/\r\n/g, "\n").trimEnd();
}

function prepareImplementationValidation(root, slug) {
  const status = featureStatus(root, slug);
  if (status.drift.length || !status.reviews.tasks.approved) {
    throw new Error("Implementation validation requires current validated specification, plan and tasks.");
  }
  const { directory } = readFeature(root, slug);
  const plan = validatePhase(root, slug, "plan", fs.readFileSync(projectPath(root, `${directory}/plan.json`), "utf8"));
  const tasks = validatePhase(root, slug, "tasks", fs.readFileSync(projectPath(root, `${directory}/tasks.json`), "utf8"));
  const plannedPaths = new Set(tasks.tasks.flatMap(task => task.paths));
  const steps = plan.checks.map(check => {
    if (!/^node --test(?: [a-zA-Z0-9_./-]+\.test\.(?:cjs|mjs|js))+$/.test(check.command)) {
      throw new Error(`Canonical check ${check.id} requires an explicit workflow: only exact project-local node:test checks are automatically executable.`);
    }
    const args = check.command.split(" ").slice(1);
    for (const file of args.slice(1)) {
      safePath.parse(file);
      if (!plannedPaths.has(file)) throw new Error(`Check ${check.id} references an unplanned test path.`);
      projectPath(root, file);
    }
    if (!tasks.tasks.some(task => task.checks.includes(check.id))) {
      throw new Error(`Check ${check.id} is not linked to canonical use-case tasks.`);
    }
    return { id: check.id.toLowerCase(), label: check.expected, tool: "node", args };
  });
  const workflowId = `spec-${slug}`;
  return {
    specification_sha256: status.reviews.specification.sha256,
    plan_sha256: status.reviews.plan.sha256, tasks_sha256: status.reviews.tasks.sha256,
    commands: plan.checks.map(check => check.command),
    spec: { workflow_id: workflowId, task: `Verify canonical implementation checks for ${slug}`,
      evidence: [`${directory}/spec.md`, `${directory}/plan.json`, `${directory}/tasks.json`,
        ...plannedPaths], steps },
  };
}

function publishPhase(root, slug, stage, response) {
  const document = validatePhase(root, slug, stage, response);
  const { directory } = readFeature(root, slug);
  const outputs = [{ path: `${directory}/${stage}.json`, content: `${JSON.stringify(document, null, 2)}\n` },
    { path: `${directory}/${stage}.md`, content: renderPhase(stage, document) }];
  for (const file of outputs) {
    const filename = projectPath(root, file.path);
    if (fs.existsSync(filename) && fs.readFileSync(filename, "utf8") !== file.content) {
      throw new Error(`Phase conflict: ${file.path} already contains different work; preserve it and reconcile the revision.`);
    }
  }
  ensureDirectory(root, directory);
  const created = [];
  try {
    for (const file of outputs) {
      const filename = projectPath(root, file.path);
      if (!fs.existsSync(filename)) {
        fs.writeFileSync(filename, file.content, { flag: "wx" });
        created.push(filename);
      }
    }
  } catch (error) {
    for (const filename of created.reverse()) fs.unlinkSync(filename);
    throw error;
  }
  const status = require("./lifecycle").advanceValidatedStages(root, slug);
  return { paths: outputs.map(file => file.path), status };
}

function recoverAuthoring(root, candidate, sourcePaths = []) {
  if (typeof candidate !== "string" ||
      !/^\.mcpee\/reports\/authoring\/[a-f0-9-]+\/(?:specification|plan|tasks)-[1-3]\.txt$/.test(candidate)) {
    throw new Error("Recovery requires a persisted MCPEE authoring candidate path.");
  }
  const response = fs.readFileSync(projectPath(root, candidate), "utf8");
  const metadata = JSON.parse(fs.readFileSync(projectPath(root, candidate.replace(/\.txt$/, ".json")), "utf8"));
  const responseHash = crypto.createHash("sha256").update(response).digest("hex");
  if (metadata.generated_by !== "mcpee" || metadata.response_path !== candidate ||
      metadata.response_sha256 !== responseHash) {
    throw new Error("Recovery candidate no longer matches its recorded execution evidence.");
  }
  let result;
  if (metadata.stage === "specification") {
    if (!Array.isArray(metadata.source_snapshot) || !metadata.source_snapshot.length) {
      throw new Error("Recovery requires the original source snapshot; sources cannot be inferred.");
    }
    const selected = sourcePaths.length ? metadata.source_snapshot.filter(source =>
      sourcePaths.includes(source.original_path || source.path)) : metadata.source_snapshot;
    if (sourcePaths.some(file => !selected.some(source => (source.original_path || source.path) === file))) {
      throw new Error("Recovery cannot introduce sources outside the original authoring snapshot.");
    }
    const { sourceDrift } = require("./lifecycle");
    if (sourceDrift(root, { sources: selected }).length) throw new Error("Source drift blocks recovery; do not silently rebase the candidate.");
    const { prepareFunctionalSources, publishFunctionalSpec } = require("./functional");
    result = publishFunctionalSpec(root, response,
      prepareFunctionalSources(root, selected.map(source => source.original_path || source.path)), { automatic: true });
  } else if (["plan", "tasks"].includes(metadata.stage)) {
    if (sourcePaths.length) throw new Error("Plan/task recovery is bound to its canonical upstream phases, not alternate sources.");
    result = publishPhase(root, metadata.feature, metadata.stage, response);
  } else {
    throw new Error("Unsupported recovery phase.");
  }
  const indexing = require("../../source-engine/src/sync").syncProject(root, {
    generateDocumentation: false, tools: [], graphify: { installed: false },
  });
  if (indexing.counts.failed) throw new Error("Recovered artifacts persisted but source indexing failed; inspect sync evidence.");
  require("../../core/src/telemetry").recordEvent(root, { event_name: "copilot.authoring.recovered",
    attributes: { stage: metadata.stage, original_trace_id: metadata.trace_id,
      candidate, candidate_sha256: responseHash, source_scope_narrowed: sourcePaths.length > 0 },
  });
  return { candidate, stage: metadata.stage, result };
}

module.exports = { validatePhase, renderPhase, phasePrompt, publishPhase, recoverAuthoring, phaseMarkdownMatches, prepareImplementationValidation };
