"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { z } = require("zod");
const { projectPath, ensureDirectory } = require("./brownfield");
const { readFeature, featureStatus, currentDigest } = require("./lifecycle");
const { hasAuthoringPlaceholder } = require("./authoring-text");
const { renameAtomicSync } = require("../../core/src/atomic-file");

const text = z.string().trim().min(8).max(4000).refine(value =>
  !hasAuthoringPlaceholder(value), "Concrete phase content is required.");
const caseId = z.string().regex(/^UC-\d{3}$/);
const safePath = z.string().min(1).refine(value =>
  !/^[\\/]|^[A-Za-z]:|[\r\n\0]|\\/.test(value) &&
  !value.split("/").some(segment => ["..", "", ".git", ".mcpee", "node_modules"].includes(segment)),
  "Use a project-relative product path, not an internal or escaping path.");
const check = z.object({
  id: z.string().regex(/^CHECK-\d{3}$/), command: text, expected: text,
  kind: z.enum(["automated", "manual"]).optional(),
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
    kind: z.enum(["implementation", "documentation"]).optional(),
    use_cases: z.array(caseId).min(1), paths: z.array(safePath).min(1),
    depends_on: z.array(z.string().regex(/^TASK-\d{3}$/)),
    checks: z.array(z.string().regex(/^CHECK-\d{3}$/)).min(1),
  }).strict()).min(1).max(300),
  open_questions: z.array(text).max(100),
}).strict();

const isImplementationTask = task => task.kind !== "documentation";

function isSpecificationBundlePath(file, slug) {
  return /^docs\/specifications\/(?:proposed|reviewed|approved)\/[^/]+\//.test(file) ||
    file.startsWith(`specs/${slug}/`) || file.startsWith(`specs/approved/${slug}/`);
}

function validatePhase(root, slug, stage, response) {
  if (!["plan", "tasks"].includes(stage)) throw new Error(`Unsupported authoring phase: ${stage}`);
  const document = (stage === "plan" ? planSchema : tasksSchema).parse(JSON.parse(response));
  const status = featureStatus(root, slug);
  if (stage === "tasks" && !status.specification_approved) {
    throw new Error("Explicit specification approval is required before generating tasks; approve the current specification individually or as a batch.");
  }
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
      if (stage === "plan" || isImplementationTask(entry)) covered.add(id);
    }
    for (const file of entry.paths) projectPath(root, file);
    if ((stage === "plan" || isImplementationTask(entry)) &&
        entry.paths.every(file => isSpecificationBundlePath(file, slug))) {
      throw new Error(`${stage === "plan" ? "Design" : "Implementation task"} ${entry.id} must include a concrete product implementation path outside the specification bundle; use cases are references, not implementation targets.`);
    }
  }
  if ([...cases].some(id => !covered.has(id))) {
    throw new Error(stage === "tasks"
      ? "tasks must account for every canonical use case with implementation work; documentation links provide traceability only."
      : `${stage} must account for every canonical use case.`);
  }
  if (stage === "plan") {
    if (new Set(document.checks.map(item => item.id)).size !== document.checks.length) {
      throw new Error("Plan check IDs must be unique.");
    }
  } else {
    if (!status.reviews.plan.approved || document.plan_sha256 !== currentDigest(root, slug, "plan")) {
      throw new Error("Tasks require the current validated plan digest.");
    }
    const plan = validatePhase(root, slug, "plan",
      fs.readFileSync(projectPath(root, `${directory}/plan.json`), "utf8"));
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
      if (!isImplementationTask(task)) continue;
      const prerequisiteIds = ancestors(task.id);
      const upstreamCases = new Set(document.tasks.filter(item =>
        prerequisiteIds.has(item.id) && isImplementationTask(item))
        .flatMap(item => item.use_cases));
      for (const id of task.use_cases) upstreamCases.add(id);
      for (const id of task.use_cases) {
        for (const dependency of manifest.cases.find(item => item.id === id).dependencies) {
          if (!upstreamCases.has(dependency)) {
            throw new Error(`Task ${task.id} must include or depend on work for prerequisite ${dependency}. ` +
              "Only implementation tasks satisfy functional prerequisites. Mark documentation-only work with kind documentation; " +
              "keep its use_cases as traceability and model its actual depends_on separately. Do not add dependencies that create a cycle.");
          }
        }
      }
    }
  }
  return document;
}

function renderPhase(stage, document, cases = []) {
  const link = id => `[${id}](${path.posix.basename(cases.find(item => item.id === id)?.path || `${id}.md`)})`;
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
      ...document.checks.map(item => `- **${item.id}**${item.kind ? ` (${item.kind})` : ""}: \`${item.command}\` — ${item.expected}`),
      "", "## Risks", "", ...document.risks.map(item =>
        `- ${item.description}${item.requires_approval ? " — HUMAN AUTHORIZATION REQUIRED" : ""}`),
    ] : [
      "## Dependency-ordered work", "",
      ...orderedTasks.map(item => `- [ ] **${item.id}**: ${item.description}${item.kind ? ` | Kind: ${item.kind}` : ""} | ${isImplementationTask(item) ? "Cases" : "Related cases (traceability only)"}: ${item.use_cases.map(link).join(", ")} | Paths: ${item.paths.join(", ")} | Depends on: ${item.depends_on.join(", ") || "none"} | Checks: ${item.checks.join(", ")}`),
    ]),
    "", "## Open decisions", "", ...document.open_questions.map(item => `- ${item}`), "",
  ].join("\n");
}

function phasePrompt(root, slug, stage) {
  const status = featureStatus(root, slug);
  const { directory, manifest } = readFeature(root, slug);
  const canonicalPaths = [
    `${directory}/manifest.json`,
    manifest.index,
    `${directory}/decisions.md`,
    ...manifest.cases.map(item => item.path),
  ];
  const sample = stage === "plan" ? {
    title: "Concrete technical design", specification_sha256: status.reviews.specification.sha256,
    design: [{ id: "DESIGN-001", description: "Source-bound design for a specific outcome.",
      use_cases: ["UC-001"], paths: ["src/catalog.js", "tests/catalog.test.js"] }],
    checks: [{ id: "CHECK-001", command: "node --test tests/catalog.test.js", expected: "Anonymous search and no-results assertions pass." }],
    risks: [], open_questions: [],
  } : {
    title: "Concrete implementation tasks", specification_sha256: status.reviews.specification.sha256,
    plan_sha256: status.reviews.plan.sha256,
    tasks: [{ id: "TASK-001", kind: "implementation", description: "Implement one specific case and its regression check.",
      use_cases: ["UC-001"], paths: ["src/catalog.js"], depends_on: [], checks: ["CHECK-001"] }],
    open_questions: [],
  };
  return [
    `Author only the ${stage} phase for ${directory}/. Return one JSON object; MCPEE renders the canonical Markdown and manifest. Do not write files, implement code, execute commands or approve risky actions.`,
    `For reading the specification, use these current canonical artifact paths from manifest.json: ${canonicalPaths.join(", ")}. Prior conversation references and paths embedded in historical snapshots are archival; do not use them to locate active artifacts. Design and implementation task paths must name concrete product files to implement, not merely specification references; never treat the approved specification as an implementation target.`,
    "Read every canonical use case and decisions.md. For tasks, read plan.md and plan.json. Account for every use case, keep exact current digests, concrete paths and checks, and acyclic dependencies. Commands are proposed verification, not evidence they ran. Do not invent answers to contradictory requirements; record open_questions. Only an actual risky action proposed by this plan may set requires_approval true, with a matching approval_action. Missing visual/runtime acceptance or a disclaimer that local tests are not production acceptance is not a human approval gate.",
    "Classify each plan check with kind automated or manual. Manual checks describe the human review and expected evidence; do not disguise them as executable commands. Automated checks must name the actual command, not an undefined runner.",
    "Use open_questions only for specific unresolved decisions that must be answered before this phase can advance. A reminder that an already deferred decision or its operational data remains pending for a later phase is not an open question for this phase. Preserve that constraint in relevant design or task descriptions; never silently resolve, discard or reclassify the recorded decision. If it is genuinely required for this phase, state the specific blocking question instead.",
    ...(stage === "tasks" ? [
      "Set kind to implementation for functional work and documentation for documentation-only work. Omitted kind means implementation for legacy tasks. Every use case needs implementation coverage. Documentation use_cases are traceability only: they neither inherit functional prerequisites nor satisfy them for other tasks. Keep documentation depends_on explicit according to actual work order (preparatory documentation may precede implementation; final documentation may follow it). An implementation task may cover a use case and its prerequisite within the same unit of work; otherwise it must depend directly or transitively on implementation work covering that prerequisite. Never repair missing prerequisites by blindly adding links that create cycles; correct the task classification and coverage instead.",
    ] : []),
    "Shape example, not a reference solution:", JSON.stringify(sample),
    "Machine schema:", JSON.stringify(z.toJSONSchema(stage === "plan" ? planSchema : tasksSchema, { unrepresentable: "any" })),
  ].join("\n\n");
}

function phaseMarkdownMatches(stage, document, markdown, cases = []) {
  const actual = markdown.replace(/\r\n/g, "\n").trimEnd();
  return renderPhase(stage, document, cases).trimEnd() === actual ||
    renderPhase(stage, document).trimEnd() === actual;
}

function prepareImplementationValidation(root, slug, options = {}) {
  const status = featureStatus(root, slug);
  if (status.drift.length || !status.specification_approved || !status.reviews.tasks.approved) {
    throw new Error("Implementation validation requires current validated specification, plan and tasks.");
  }
  const { directory } = readFeature(root, slug);
  const plan = validatePhase(root, slug, "plan", fs.readFileSync(projectPath(root, `${directory}/plan.json`), "utf8"));
  const tasks = validatePhase(root, slug, "tasks", fs.readFileSync(projectPath(root, `${directory}/tasks.json`), "utf8"));
  const plannedPaths = new Set(tasks.tasks.flatMap(task => task.paths));
  // Plans authored in an earlier lifecycle stage may reference the bundle's former location.
  const { currentBundlePath } = require("./storage");
  const evidencePaths = [...new Set([...plannedPaths].map(file => currentBundlePath(root, slug, directory, file)))]
    .filter(file => !file.startsWith(`${directory}/`) || !fs.existsSync(projectPath(root, file)) ||
      fs.statSync(projectPath(root, file)).isFile());
  const workflowId = `spec-${slug}`;
  const workflowPath = `.mcpee/workflows/${workflowId}.json`;
  const explicitWorkflow = fs.existsSync(projectPath(root, workflowPath));
  let workflowContents;
  let steps;
  const pending = [];
  const manual = check => check.kind === "manual" ||
    (!check.kind && /^manual review\s*:/i.test(check.command));
  const automatedChecks = plan.checks.filter(check => !manual(check));
  for (const check of plan.checks.filter(manual)) {
    pending.push({ id: check.id, kind: "manual", command: check.command, expected: check.expected });
  }
  if (explicitWorkflow) {
    const { MAX_RUN_SPEC_BYTES, MAX_CHECKS } = require("../../evaluation-engine/src/evaluate");
    if (fs.statSync(projectPath(root, workflowPath)).size > MAX_RUN_SPEC_BYTES) {
      throw new Error(`Explicit canonical workflow exceeds ${MAX_RUN_SPEC_BYTES} bytes.`);
    }
    const schema = z.object({
      workflow_id: z.literal(workflowId), task: z.string().trim().min(3),
      steps: z.array(z.object({
        id: z.string().regex(/^check-\d{3}$/), label: z.string().trim().min(1),
        command: z.string().min(1), tool: z.string().min(1),
        args: z.array(z.string().max(8192).refine(value => !value.includes("\0"))).max(128),
        cwd: z.string().optional(), requires_approval: z.boolean().optional(),
        timeout_ms: z.number().int().min(1000).max(900000).optional(),
      }).strict()).min(1).max(MAX_CHECKS),
    }).strict();
    workflowContents = fs.readFileSync(projectPath(root, workflowPath));
    const workflow = schema.parse(JSON.parse(workflowContents.toString("utf8")));
    if ((!options.allowPending && workflow.steps.length !== automatedChecks.length) ||
        new Set(workflow.steps.map(step => step.id)).size !== workflow.steps.length ||
        workflow.steps.some(step => !automatedChecks.some(check => check.id.toLowerCase() === step.id))) {
      throw new Error(`Explicit canonical workflow ${workflowPath} must map every plan check exactly once.`);
    }
    const tools = new Set(require("../../../catalog/tools/tools.json").tools.map(tool => tool.id));
    steps = automatedChecks.flatMap(check => {
      const step = workflow.steps.find(item => item.id === check.id.toLowerCase());
      if (!step && options.allowPending) {
        pending.push({ id: check.id, kind: "automated", command: check.command, expected: check.expected });
        return [];
      }
      if (!step || step.command !== check.command) {
        throw new Error(`Explicit workflow must bind the exact command of ${check.id}; update ${workflowPath} against the current plan.`);
      }
      if (!tools.has(step.tool)) throw new Error(`Canonical check ${check.id} references a tool outside the MCPEE catalog: ${step.tool}.`);
      if (step.cwd && step.cwd !== ".") {
        safePath.parse(step.cwd.replace(/\\/g, "/"));
        projectPath(root, step.cwd);
      }
      const { command, ...execution } = step;
      return [{ ...execution, label: check.expected, requires_approval: true }];
    });
  } else steps = automatedChecks.flatMap(check => {
    if (!/^node --test(?: [a-zA-Z0-9_./-]+\.test\.(?:cjs|mjs|js))+$/.test(check.command)) {
      if (options.allowPending) {
        pending.push({ id: check.id, kind: "automated", command: check.command, expected: check.expected });
        return [];
      }
      throw new Error(`Canonical check ${check.id} requires an explicit workflow at ${workflowPath}: map every CHECK id to a catalog tool, argument array and exact plan command. Only node:test checks are automatically translated; other tools and cloud operations retain explicit invocation approval.`);
    }
    const args = check.command.split(" ").slice(1);
    for (const file of args.slice(1)) {
      safePath.parse(file);
      if (!plannedPaths.has(file)) throw new Error(`Check ${check.id} references an unplanned test path.`);
      projectPath(root, file);
    }
    if (!tasks.tasks.some(task => task.checks.includes(check.id))) {
      if (options.allowPending) {
        pending.push({ id: check.id, kind: "automated", command: check.command, expected: check.expected });
        return [];
      }
      throw new Error(`Check ${check.id} is not linked to canonical use-case tasks.`);
    }
    return [{ id: check.id.toLowerCase(), label: check.expected, tool: "node", args }];
  });
  const result = {
    specification_sha256: status.reviews.specification.sha256,
    plan_sha256: status.reviews.plan.sha256, tasks_sha256: status.reviews.tasks.sha256,
    ...(status.reviewed_source_drift?.length ? { source_drift_reviews: status.reviewed_source_drift
      .map(review => ({ path: review.path, review: review.review, sha256: review.sha256 })) } : {}),
    commands: explicitWorkflow ? [] : plan.checks.filter(check => steps.some(step => step.id === check.id.toLowerCase())).map(check => check.command),
    ...(pending.length ? { pending_checks: pending } : {}),
    ...(explicitWorkflow ? { explicit_workflow: workflowPath,
      workflow_sha256: crypto.createHash("sha256").update(workflowContents).digest("hex") } : {}),
    spec: { workflow_id: workflowId, task: `Verify canonical implementation checks for ${slug}`,
      evidence: [...new Set([`${directory}/spec.md`, `${directory}/plan.json`, `${directory}/tasks.json`,
        ...evidencePaths, ...(explicitWorkflow ? [workflowPath] : [])])], steps },
  };
  if (!options.skipManualReviews && pending.some(check => check.kind === "manual")) {
    const reviews = require("./manual-review").currentManualReviews(root, slug, result);
    if (reviews.length) {
      result.manual_reviews = reviews;
      result.pending_checks = pending.filter(check => !reviews.some(review => review.id === check.id));
      if (!result.pending_checks.length) delete result.pending_checks;
    }
  }
  if (!options.allowPending && result.pending_checks?.length) {
    throw new Error(`Manual checks require human review and cannot be executed as workflow steps: ${result.pending_checks.map(check => check.id).join(", ")}.`);
  }
  return result;
}

function preparePhasePublication(root, slug, stage, response) {
  const document = validatePhase(root, slug, stage, response);
  const { directory, lifecycle } = readFeature(root, slug);
  const outputs = [{ path: `${directory}/${stage}.json`, content: `${JSON.stringify(document, null, 2)}\n` },
    { path: `${directory}/${stage}.md`, content: renderPhase(stage, document, readFeature(root, slug).manifest.cases) }];
  const existing = outputs.filter(file => fs.existsSync(projectPath(root, file.path)))
    .map(file => ({ path: file.path, content: fs.readFileSync(projectPath(root, file.path), "utf8") }));
  const changed = existing.some(file => file.content !== outputs.find(output => output.path === file.path).content);
  const downstream = changed && stage === "plan" ? ["tasks.json", "tasks.md"]
    .map(file => `${directory}/${file}`).filter(file => fs.existsSync(projectPath(root, file)))
    .map(file => ({ path: file, content: fs.readFileSync(projectPath(root, file), "utf8") })) : [];
  const artifacts = [...existing, ...downstream];
  const revision = changed ? {
    feature: slug, stage, artifacts, approvals: lifecycle.approvals,
    invalidated_paths: downstream.map(file => file.path),
    sha256: crypto.createHash("sha256").update(JSON.stringify({ artifacts, outputs, approvals: lifecycle.approvals })).digest("hex"),
  } : null;
  return { directory, outputs, existing, revision };
}

async function publishPhaseWithApproval(root, slug, stage, response, approveRevision) {
  const { revision } = preparePhasePublication(root, slug, stage, response);
  if (revision && (typeof approveRevision !== "function" || !await approveRevision(revision))) {
    throw new Error(`Phase revision was not approved; existing ${stage} files were preserved. Recover the saved candidate after reviewing the revision.`);
  }
  return publishPhase(root, slug, stage, response, { confirmSha256: revision?.sha256 });
}

function publishPhase(root, slug, stage, response, { confirmSha256 } = {}) {
  const { directory, outputs, existing, revision } = preparePhasePublication(root, slug, stage, response);
  if (revision && confirmSha256 !== revision.sha256) {
    throw new Error(`Phase conflict: ${stage} already contains different work; review the revision and confirm SHA-256 ${revision.sha256} before replacement.`);
  }
  if (!revision && confirmSha256) throw new Error("Phase revision changed after confirmation; review the current artifacts again.");
  ensureDirectory(root, directory);
  const created = [];
  const replaced = [];
  let revisionPath;
  const replace = file => {
    const temporary = projectPath(root, `${file.path}.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, file.content, { flag: "wx" });
      renameAtomicSync(temporary, projectPath(root, file.path));
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
  try {
    if (revision) {
      ensureDirectory(root, ".mcpee/reports/phase-revisions");
      revisionPath = `.mcpee/reports/phase-revisions/${crypto.randomUUID()}.json`;
      fs.writeFileSync(projectPath(root, revisionPath), `${JSON.stringify({
        generated_by: "mcpee", kind: "phase-revision", confirmed_at: new Date().toISOString(),
        ...revision,
      }, null, 2)}\n`, { flag: "wx" });
    }
    for (const file of outputs) {
      const filename = projectPath(root, file.path);
      if (!fs.existsSync(filename)) {
        fs.writeFileSync(filename, file.content, { flag: "wx" });
        created.push(filename);
      } else if (revision && fs.readFileSync(filename, "utf8") !== file.content) {
        replace(file);
        replaced.push(existing.find(previous => previous.path === file.path));
      }
    }
    for (const file of revision?.artifacts || []) {
      if (revision.invalidated_paths.includes(file.path)) {
        fs.unlinkSync(projectPath(root, file.path));
        replaced.push(file);
      }
    }
  } catch (error) {
    try {
      for (const file of replaced.reverse()) replace(file);
      for (const filename of created.reverse()) fs.unlinkSync(filename);
      if (revisionPath) fs.unlinkSync(projectPath(root, revisionPath));
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Phase revision failed and rollback was incomplete; preserve ${revisionPath} for recovery.`);
    }
    throw error;
  }
  const status = require("./lifecycle").advanceValidatedStages(root, slug);
  return { paths: [...outputs.map(file => file.path), ...(revision?.invalidated_paths || []),
    ...(revisionPath ? [revisionPath] : [])], status, ...(revisionPath ? { revision: revisionPath } : {}) };
}

function recoverAuthoring(root, candidate, sourcePaths = [], { confirmSha256 } = {}) {
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
    let authoringScope;
    if (metadata.authoring_scope) {
      authoringScope = require("./scopes").validateSpecificationScopeTask(root, metadata.authoring_task);
      if (!authoringScope || JSON.stringify(authoringScope) !== JSON.stringify(metadata.authoring_scope) || sourcePaths.length) {
        throw new Error("Scoped recovery requires the unchanged complete original authoring scope.");
      }
    }
    const { prepareFunctionalSources, publishFunctionalSpec } = require("./functional");
    const sources = authoringScope
      ? require("./scopes").prepareScopeSources(root, authoringScope)
      : prepareFunctionalSources(root, selected.map(source => source.original_path || source.path));
    if (authoringScope) {
      const identity = items => JSON.stringify(items.map(source => ({
        path: source.path, sha256: source.sha256, original_path: source.original_path,
        original_sha256: source.original_sha256,
        coverage_role: source.coverage_role, selected_ranges: source.selected_ranges,
      })).sort((a, b) => a.path.localeCompare(b.path)));
      if (identity(selected) !== identity(sources)) throw new Error("Recovery sources do not match the complete current authoring scope.");
    }
    result = publishFunctionalSpec(root, response, sources, {
      automatic: true, proposalOnly: metadata.proposal_only === true,
      ...(confirmSha256 ? { confirmRevisionSha256: confirmSha256 } : {}),
      ...(authoringScope ? { authoringScope } : {}),
    });
  } else if (["plan", "tasks"].includes(metadata.stage)) {
    if (sourcePaths.length) throw new Error("Plan/task recovery is bound to its canonical upstream phases, not alternate sources.");
    result = publishPhase(root, metadata.feature, metadata.stage, response, { confirmSha256 });
  } else {
    throw new Error("Unsupported recovery phase.");
  }
  const indexing = require("../../source-engine/src/sync").syncProject(root, {
    generateDocumentation: false, discoverSpecifications: false, tools: [], graphify: { installed: false },
  });
  if (indexing.counts.failed) throw new Error("Recovered artifacts persisted but source indexing failed; inspect sync evidence.");
  require("../../core/src/telemetry").recordEvent(root, { event_name: "copilot.authoring.recovered",
    attributes: { stage: metadata.stage, original_trace_id: metadata.trace_id,
      candidate, candidate_sha256: responseHash, source_scope_narrowed: sourcePaths.length > 0 },
  });
  return { candidate, stage: metadata.stage, result };
}

module.exports = { validatePhase, renderPhase, phasePrompt, publishPhase, publishPhaseWithApproval, recoverAuthoring, phaseMarkdownMatches, prepareImplementationValidation, isImplementationTask };
