"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { renameAtomicSync } = require("../../core/src/atomic-file");
const { projectPath, ensureDirectory } = require("./brownfield");
const { SPEC_ROOT, STATES, workspace, featureDirectories } = require("./storage");

const MARKER = "<!-- MCPEE specification workspace; generated navigation, not product approval -->";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stages = ["specification", "plan", "tasks"];
const files = { specification: "spec.md", plan: "plan.md", tasks: "tasks.md" };

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(projectPath(root, relative), "utf8"));
}

function readFeature(root, slug) {
  const directory = workspace(slug, root);
  const manifest = readJson(root, `${directory}/manifest.json`);
  if (manifest.generated_by !== "mcpee" || manifest.kind !== "atomic-functional-specifications" ||
      manifest.index !== `${directory}/spec.md` || !Array.isArray(manifest.cases) || !manifest.cases.length ||
      !Array.isArray(manifest.sources) || !Array.isArray(manifest.coverage)) {
    throw new Error(`Invalid canonical specification manifest: ${directory}/manifest.json`);
  }
  const lifecyclePath = `${directory}/lifecycle.json`;
  const lifecycle = fs.existsSync(projectPath(root, lifecyclePath))
    ? readJson(root, lifecyclePath) : { generated_by: "mcpee", approvals: {} };
  if (lifecycle.generated_by !== "mcpee" || !lifecycle.approvals || typeof lifecycle.approvals !== "object") {
    throw new Error(`Invalid specification lifecycle: ${lifecyclePath}`);
  }
  return { directory, manifest, lifecycle };
}

function replaceState(root, relative, value) {
  replaceFile(root, relative, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceFile(root, relative, content) {
  const filename = projectPath(root, relative);
  const temporary = projectPath(root, `${relative}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { flag: "wx" });
    renameAtomicSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function persistDecisionRegister(root, directory, decisions) {
  const jsonPath = `${directory}/decisions.json`;
  const markdownPath = `${directory}/decisions.md`;
  const previousJson = fs.readFileSync(projectPath(root, jsonPath));
  const previousMarkdown = fs.readFileSync(projectPath(root, markdownPath));
  try {
    replaceState(root, jsonPath, decisions);
    replaceFile(root, markdownPath, renderDecisions(decisions));
  } catch (error) {
    try {
      replaceFile(root, jsonPath, previousJson);
      replaceFile(root, markdownPath, previousMarkdown);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError],
        "Decision history update failed and rollback was incomplete; preserve both decision-register files for recovery.");
    }
    throw error;
  }
}

function migrateReviewHistory(root, slug) {
  const { directory, lifecycle } = readFeature(root, slug);
  const from = `${directory}/reviews`;
  const to = `${directory}/history`;
  const rename = fs.existsSync(projectPath(root, from));
  if (!rename && !fs.existsSync(projectPath(root, to))) return { status: "unchanged", path: to };
  const source = rename ? from : to;
  if (fs.lstatSync(projectPath(root, source)).isSymbolicLink() ||
      !fs.statSync(projectPath(root, source)).isDirectory()) {
    throw new Error(`Review history must be a real directory: ${source}`);
  }
  if (rename && fs.existsSync(projectPath(root, to))) throw new Error(`Review history migration conflicts with ${to}; no evidence was overwritten.`);
  const entries = fs.readdirSync(projectPath(root, source), { withFileTypes: true });
  if (entries.some(entry => !entry.isFile())) throw new Error(`Unsupported artifact in review history: ${from}`);
  const previous = structuredClone(lifecycle);
  let changed = false;
  const rebase = approval => {
    if (typeof approval?.snapshot !== "string") return;
    const parts = approval.snapshot.split("/");
    if (!["reviews", "history"].includes(parts.at(-2)) || parts.at(-3) !== slug) return;
    const target = `${to}/${parts.at(-1)}`;
    if (target === approval.snapshot) return;
    if (!entries.some(entry => entry.name === parts.at(-1))) {
      throw new Error(`Referenced review snapshot is missing: ${approval.snapshot}`);
    }
    approval.snapshot = target;
    changed = true;
  };
  for (const approval of Object.values(lifecycle.approvals)) rebase(approval);
  for (const approval of lifecycle.approval_history || []) rebase(approval);
  if (!rename && !changed) return { status: "unchanged", path: to };
  const report = `.mcpee/reports/specification-history/${crypto.randomUUID()}.json`;
  const evidence = entries.map(entry => ({ name: entry.name,
    sha256: hash(fs.readFileSync(projectPath(root, `${source}/${entry.name}`))) }));
  ensureDirectory(root, ".mcpee/reports/specification-history");
  if (rename) fs.renameSync(projectPath(root, from), projectPath(root, to));
  try {
    replaceState(root, `${directory}/lifecycle.json`, lifecycle);
    replaceState(root, report, { generated_by: "mcpee", kind: "review-history-rename",
      feature: slug, from, to, at: new Date().toISOString(), files: evidence, authority_granted: false });
  } catch (error) {
    if (rename) fs.renameSync(projectPath(root, to), projectPath(root, from));
    replaceState(root, `${directory}/lifecycle.json`, previous);
    throw error;
  }
  return { status: rename ? "renamed-preserving-evidence" : "repaired-history-references", path: to, report };
}

function decisionDocument(document) {
  const questions = [
    ...document.open_questions.map((question) => ({ scope: "product", question })),
    ...document.use_cases.flatMap((useCase) => useCase.open_questions.map((question) => ({ scope: useCase.id, question }))),
  ];
  return questions.map((question, index) => ({ id: `Q-${String(index + 1).padStart(3, "0")}`, ...question, answer: null }));
}

function decisionResolved(decision) {
  if (decision.resolution !== undefined && !["resolved", "pending", "deferred"].includes(decision.resolution)) {
    throw new Error(`Invalid decision resolution: ${decision.id}`);
  }
  return Boolean(decision.answer) && !["pending", "deferred"].includes(decision.resolution);
}

function decisionBlocksApproval(decision) {
  return decision.status !== "historical" && decision.resolution !== "deferred" && !decisionResolved(decision);
}

function renderDecisions(decisions) {
  return [
    "<!-- MCPEE decision register; answers require an accountable owner -->",
    "# Decisions / Decisiones", "",
    "Resolve with `mcpee specs decide --slug <id> --id Q-001 --answer \"...\" --reviewer \"...\"`.",
    "Answers record owner decisions, not automatically verified facts.", "",
    ...(decisions.length ? decisions.flatMap((decision) => [
      `## ${decision.id} (${decision.scope})${decision.status === "historical" ? " - Historical, not mapped to a current question" : ""}`,
      "", decision.question, "",
      decision.status === "historical"
        ? decisionResolved(decision)
          ? `**Historical answer preserved from a prior revision${decision.reviewer ? ` (${decision.reviewer})` : ""}:** ${decision.answer}`
          : `**Historical question not mapped to the current specification:** ${decision.answer || "No answer recorded."}`
        : decision.resolution === "deferred"
          ? `**Deferred to a later phase${decision.reviewer ? ` (${decision.reviewer})` : ""}:** ${decision.answer}`
        : decisionResolved(decision) ? `**Resolved by ${decision.reviewer}:** ${decision.answer}`
        : decision.answer ? `**OPEN / PENDIENTE (${decision.reviewer}):** ${decision.answer}` : "**OPEN / PENDIENTE**", "",
    ]) : ["No open questions were recorded. Validation is not proof of product acceptance.", ""]),
  ].join("\n");
}

function reviewPaths(root, slug, stage) {
  if (!stages.includes(stage)) throw new Error("Review stage must be specification, plan or tasks.");
  const { directory, manifest } = readFeature(root, slug);
  const paths = stage === "specification"
    ? [`${directory}/manifest.json`, manifest.index, ...manifest.cases.map((item) => item.path),
      `${directory}/decisions.json`, `${directory}/decisions.md`, ...(manifest.document ? [manifest.document] : [])]
    : [`${directory}/${files[stage]}`, ...(fs.existsSync(projectPath(root, `${directory}/${stage}.json`))
      ? [`${directory}/${stage}.json`] : [])];
  if (paths.some((file) => !file.startsWith(`${directory}/`)) || new Set(paths).size !== paths.length) {
    throw new Error(`Invalid or duplicate specification artifact paths: ${slug}`);
  }
  return paths;
}

function currentDigest(root, slug, stage) {
  return hash(JSON.stringify(reviewPaths(root, slug, stage).map((file) => [file, hash(fs.readFileSync(projectPath(root, file)))])));
}

function sourceDrift(root, manifest) {
  const changed = [];
  for (const source of manifest.sources) {
    for (const [file, digest] of [[source.path, source.sha256],
      ...(source.original_path ? [[source.original_path, source.original_sha256]] : [])]) {
      const filename = projectPath(root, file);
      if (!fs.existsSync(filename) || hash(fs.readFileSync(filename)) !== digest) changed.push(file);
    }
  }
  return changed;
}

function featureStatus(root, slug) {
  const { directory, manifest, lifecycle } = readFeature(root, slug);
  const decisions = readJson(root, `${directory}/decisions.json`);
  if (!Array.isArray(decisions)) throw new Error(`Invalid decisions register: ${slug}`);
  const rawDrift = sourceDrift(root, manifest);
  const reviews = {};
  let previous = true;
  for (const stage of stages) {
    const present = fs.existsSync(projectPath(root, `${directory}/${files[stage]}`));
    const digest = present ? currentDigest(root, slug, stage) : null;
    const approval = lifecycle.approvals[stage];
    const approved = previous && Boolean(approval && approval.sha256 === digest &&
      (stage === "specification" || approval.specification_sha256 === reviews.specification.sha256) &&
      (stage !== "tasks" || approval.plan_sha256 === reviews.plan.sha256));
    reviews[stage] = { path: `${directory}/${files[stage]}`, present, sha256: digest, approved,
      validation: approved && approval.validation_source === "mcpee-automatic"
        ? "machine-validated" : approved ? "human-reviewed" : "pending" };
    previous = approved;
  }
  const pending = decisions.filter(decisionBlocksApproval).length;
  const deferredDecisions = decisions.filter(decision =>
    decision.status !== "historical" && decision.resolution === "deferred").length;
  const deferred = manifest.coverage.filter((section) => section.status === "deferred").length;
  const blockedPhase = ["plan", "tasks"].find(stage => {
    if (reviews[stage].approved || !fs.existsSync(projectPath(root, `${directory}/${stage}.json`))) return false;
    const document = readJson(root, `${directory}/${stage}.json`);
    if (!Array.isArray(document.open_questions) || stage === "plan" && !Array.isArray(document.risks)) {
      throw new Error(`Invalid structured phase decision register: ${stage}`);
    }
    return document.open_questions.length || stage === "plan" && document.risks.some(risk => risk.requires_approval);
  });
  const explicitApproval = reviews.specification.approved &&
    lifecycle.approvals.specification.validation_source !== "mcpee-automatic";
  const reviewedDrift = require("./source-drift-review").reviewedSourceDrift(root, slug, rawDrift);
  const drift = rawDrift.filter(file => !reviewedDrift.some(review => review.path === file));
  const implementation = require("./verification").implementationStatus(root, directory, reviews, drift, reviewedDrift);
  const next = drift.length ? "synchronize-and-review-source-drift"
    : !reviews.specification.approved ? (pending || deferred ? "clarify" : "review-specification")
    : blockedPhase ? "clarify-phase"
    : !reviews.plan.approved ? (reviews.plan.present ? "review-plan" : "author-plan")
    : !explicitApproval ? "approve-specification"
    : !reviews.tasks.approved ? (reviews.tasks.present ? "review-tasks" : "author-tasks")
    : implementation.verified ? "review-product-acceptance" : "implement-and-verify";
  const authoritative = explicitApproval;
  return {
    id: slug, path: manifest.index, status: reviews.tasks.approved && explicitApproval ? "ready-for-implementation" : "draft",
    next, pending_decisions: pending, deferred_decisions: deferredDecisions,
    deferred_sections: deferred, drift, reviews,
    ...(reviewedDrift.length ? { reviewed_source_drift: reviewedDrift } : {}),
    advancement: lifecycle.advancement || "manual",
    ...(blockedPhase ? { blocked_phase: blockedPhase } : {}),
    implementation_verified: implementation.verified, implementation,
    document_state: directory.startsWith(`${SPEC_ROOT}/`) ? directory.split("/")[2] : "legacy",
    authoritative,
    authority_basis: explicitApproval ? "explicit-approval" : null,
    specification_approved: Boolean(explicitApproval),
    document_approval: explicitApproval ? lifecycle.approvals.specification : null,
    transitions: lifecycle.transitions || [],
  };
}

function listFeatures(root) {
  return featureDirectories(root)
    .filter(({ directory }) => !directory.startsWith(`${SPEC_ROOT}/approved/`) ||
      !fs.existsSync(projectPath(root, `${directory}/evidence.json`)))
    .map(({ slug, directory }) => {
      workspace(slug, root);
      if (fs.existsSync(projectPath(root, `${directory}/manifest.json`))) return featureStatus(root, slug);
      return {
        id: slug, path: `${directory}/spec.md`, status: "unvalidated-manual-draft",
        document_state: directory.startsWith(`${SPEC_ROOT}/`) ? directory.split("/")[2] : "legacy",
        authoritative: false,
        next: "author-and-review-functional-specification", pending_decisions: null, drift: [],
        reviews: Object.fromEntries(stages.map((stage) => [stage, {
          path: `${directory}/${files[stage]}`,
          present: fs.existsSync(projectPath(root, `${directory}/${files[stage]}`)), approved: false,
        }])),
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
}

function canonicalArtifacts(root) {
  return listFeatures(root).filter((feature) => feature.status !== "unvalidated-manual-draft")
    .flatMap((feature) => {
      const { directory, manifest } = readFeature(root, feature.id);
      const artifacts = [
        manifest.index, ...manifest.cases.map((item) => item.path),
        `${directory}/manifest.json`, `${directory}/decisions.json`, `${directory}/decisions.md`,
        ...["specification.json", "plan.md", "plan.json", "tasks.md", "tasks.json", "verification.json"]
          .map((file) => `${directory}/${file}`)
          .filter((file) => fs.existsSync(projectPath(root, file))),
      ];
      return [...new Set(artifacts)].map((file) => {
        if (!file.startsWith(`${directory}/`)) throw new Error(`Canonical artifact escapes its feature: ${file}`);
        return { path: file, sha256: hash(fs.readFileSync(projectPath(root, file))),
          feature: feature.id, authority: feature.authoritative ? "approved-specification" : "draft-specification",
          feature_status: feature.status, document_state: feature.document_state };
      });
    });
}

function advanceValidatedStages(root, slug) {
  const { lifecycle } = readFeature(root, slug);
  if (lifecycle.advancement !== "validated") return featureStatus(root, slug);
  let status = featureStatus(root, slug);
  if (status.drift.length || status.pending_decisions || status.deferred_sections) return status;
  for (const stage of stages) {
    const { directory, manifest } = readFeature(root, slug);
    if (status.reviews[stage].approved) continue;
    if (stage === "tasks" && !status.specification_approved) break;
    if (!status.reviews[stage].present) break;
    if (stage === "specification") {
      if (manifest.document !== `${directory}/specification.json` ||
          hash(fs.readFileSync(projectPath(root, manifest.index))) !== manifest.index_sha256 ||
          hash(fs.readFileSync(projectPath(root, manifest.document))) !== manifest.document_sha256 ||
          manifest.cases.some(item => hash(fs.readFileSync(projectPath(root, item.path))) !== item.sha256)) {
        throw new Error("Canonical specification changed after structural validation; reconcile the revision instead of silently reauthorizing it.");
      }
      const { prepareRecordedFunctionalSources, validateFunctionalSpec } = require("./functional");
      validateFunctionalSpec(root, fs.readFileSync(projectPath(root, manifest.document), "utf8"),
        prepareRecordedFunctionalSources(root, manifest.sources));
      const decisions = readJson(root, `${directory}/decisions.json`);
      if (fs.readFileSync(projectPath(root, `${directory}/decisions.md`), "utf8") !== renderDecisions(decisions)) {
        throw new Error("Decision JSON and Markdown disagree; reconcile owner edits before advancement.");
      }
    } else {
      const phasePath = `${directory}/${stage}.json`;
      if (!fs.existsSync(projectPath(root, phasePath))) break;
      const { validatePhase, phaseMarkdownMatches } = require("./phases");
      const document = validatePhase(root, slug, stage, fs.readFileSync(projectPath(root, phasePath), "utf8"));
      if (!phaseMarkdownMatches(stage, document, fs.readFileSync(projectPath(root, `${directory}/${stage}.md`), "utf8"), manifest.cases)) {
        throw new Error(`${stage} JSON and Markdown disagree; preserve and reconcile the edited artifact.`);
      }
      if (document.open_questions.length || stage === "plan" && document.risks.some(risk => risk.requires_approval)) {
        return { ...status, next: "clarify-phase", blocked_phase: stage,
          phase_decisions: document.open_questions,
          risky_decisions: stage === "plan" ? document.risks.filter(risk => risk.requires_approval) : [] };
      }
    }
    status = approveStage(root, { slug, stage, reviewer: "MCPEE automated validation",
      confirmSha256: status.reviews[stage].sha256 }, { validationSource: "mcpee-automatic" });
  }
  return status;
}

function approveStage(root, { slug, stage = "specification", reviewer, confirmSha256 }, { validationSource = "human-review", approvalReport } = {}) {
  if (typeof reviewer !== "string" || !reviewer.trim() || /[\r\n]/.test(reviewer) || reviewer.length > 160) {
    throw new Error("An accountable --reviewer is required.");
  }
  const status = featureStatus(root, slug);
  if (!stages.includes(stage)) throw new Error("Review stage must be specification, plan or tasks.");
  if (status.drift.length) throw new Error(`Source drift blocks approval: ${status.drift.join(", ")}`);
  if (status.pending_decisions || status.deferred_sections) {
    throw new Error("Resolve open decisions and deferred requirements before approval; out-of-scope sections remain explicitly documented.");
  }
  const previous = stages[stages.indexOf(stage) - 1];
  if (previous && !status.reviews[previous].approved) throw new Error(`Approve ${previous} before ${stage}.`);
  const digest = currentDigest(root, slug, stage);
  if (confirmSha256 !== digest) throw new Error(`Review digest does not match ${stage}. Current SHA-256: ${digest}`);
  if (stage === "tasks" && !status.specification_approved) {
    throw new Error("Explicit specification approval is required before tasks; structural validation is not owner approval.");
  }
  if (stage === "specification" && validationSource !== "mcpee-automatic" && status.document_state === "proposed") {
    const reviewed = reviewSpecification(root, { slug, reviewer, confirmSha256 });
    return approveStage(root, { slug, stage, reviewer, confirmSha256: reviewed.reviews.specification.sha256 }, { validationSource, approvalReport });
  }
  if (stage !== "specification") {
    const structuredPath = `${workspace(slug, root)}/${stage}.json`;
    if (fs.existsSync(projectPath(root, structuredPath))) {
      const { validatePhase, phaseMarkdownMatches } = require("./phases");
      const document = validatePhase(root, slug, stage, fs.readFileSync(projectPath(root, structuredPath), "utf8"));
      if (document.open_questions.length) throw new Error(`Resolve open ${stage} questions in the canonical artifact pair before approval.`);
      if (!phaseMarkdownMatches(stage, document, fs.readFileSync(projectPath(root, status.reviews[stage].path), "utf8"), readFeature(root, slug).manifest.cases)) {
        throw new Error(`${stage} JSON and Markdown disagree; reconcile the canonical pair before review.`);
      }
    } else if (status.advancement === "validated") {
      throw new Error(`Automatic workspaces require structured ${stage}.json; an empty or manual template cannot bypass phase validation.`);
    }
    const content = fs.readFileSync(projectPath(root, status.reviews[stage].path), "utf8");
    if (content.trim().length < 80 || /<[^>]+>|\b(?:TODO|TBD|placeholder)\b/.test(content) ||
        !content.includes("spec.md") || !/UC-\d{3}/.test(content) ||
        (stage === "tasks" && (!content.includes("plan.md") || !/- \[[ x]\]/.test(content)))) {
      throw new Error(`${stage} needs substantive, source-linked content and use-case references, without placeholders; tasks also require plan.md and checkable work items.`);
    }
  }
  migrateReviewHistory(root, slug);
  const { directory, lifecycle } = readFeature(root, slug);
  const previousLifecycle = structuredClone(lifecycle);
  const approval = {
    reviewer: reviewer.trim(), sha256: digest, approved_at: new Date().toISOString(),
    validation_source: validationSource,
    ...(approvalReport ? { instruction_report: approvalReport } : {}),
    ...(stage !== "specification" ? { specification_sha256: status.reviews.specification.sha256 } : {}),
    ...(stage === "tasks" ? { plan_sha256: status.reviews.plan.sha256 } : {}),
  };
  const snapshot = {
    generated_by: "mcpee", stage, ...approval,
    artifacts: reviewPaths(root, slug, stage).map((file) => ({ path: file, content: fs.readFileSync(projectPath(root, file), "utf8") })),
  };
  if (hash(JSON.stringify(snapshot.artifacts.map((file) => [file.path, hash(file.content)]))) !== digest) {
    throw new Error("Review artifacts changed during approval; review them again before approving.");
  }
  ensureDirectory(root, `${directory}/history`);
  const snapshotPath = `${directory}/history/${stage}-${crypto.randomUUID()}.json`;
  fs.writeFileSync(projectPath(root, snapshotPath), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
  if (lifecycle.approvals[stage]) {
    lifecycle.approval_history = [...(lifecycle.approval_history || []), { stage, ...lifecycle.approvals[stage] }];
  }
  lifecycle.approvals[stage] = { ...approval, snapshot: snapshotPath };
  try {
    replaceState(root, `${directory}/lifecycle.json`, lifecycle);
  } catch (error) {
    fs.unlinkSync(projectPath(root, snapshotPath));
    throw error;
  }
  let updated;
  try {
    updated = require("./relocation").relocateFeature(root, slug,
      stage === "specification" && validationSource !== "mcpee-automatic" ? "approved"
        : featureStatus(root, slug).authoritative ? "approved" : "reviewed");
  } catch (error) {
    replaceState(root, `${directory}/lifecycle.json`, previousLifecycle);
    fs.unlinkSync(projectPath(root, snapshotPath));
    throw error;
  }
  refreshCanonicalRetrieval(root);
  return updated;
}

function refreshCanonicalRetrieval(root) {
  refreshWorkspaceIndex(root);
  const indexing = require("../../source-engine/src/sync").syncProject(root, {
    generateDocumentation: false, discoverSpecifications: false, tools: [], graphify: { installed: false },
  });
  if (indexing.counts.failed) {
    throw new Error("Specification transition persisted but canonical retrieval indexing failed; inspect sync evidence before continuing.");
  }
}

function approveSpecifications(root, { specifications, reviewer, reason }) {
  if (!Array.isArray(specifications) || !specifications.length || specifications.length > 5000 ||
      specifications.some(item => !item || typeof item.slug !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) ||
      new Set(specifications.map(item => item.slug)).size !== specifications.length) {
    throw new Error("Approval requires a nonempty, unique list of feature slugs and exact current SHA-256 digests.");
  }
  if (typeof reviewer !== "string" || !reviewer.trim() || reviewer.length > 160 || /[\r\n]/.test(reviewer) ||
      typeof reason !== "string" || !reason.trim() || reason.length > 4000) {
    throw new Error("Batch approval requires an accountable reviewer and the explicit user approval instruction.");
  }
  const runs = projectPath(root, ".mcpee/state/runs");
  ensureDirectory(root, ".mcpee/state/runs");
  const lock = projectPath(root, ".mcpee/state/runs/admission.lock");
  let descriptor;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("MCPEE run admission is busy; retry specification approval after the current operation finishes.");
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ generated_by: "mcpee", owner_pid: process.pid, kind: "specification-approval" }));
    for (const filename of fs.readdirSync(runs).filter(file => file.endsWith(".json"))) {
      const run = readJson(root, `.mcpee/state/runs/${filename}`);
      if (!["running", "cancelling"].includes(run.status)) continue;
      for (const pid of [run.owner_pid, run.child_pid].filter(Number.isInteger)) {
        try {
          process.kill(pid, 0);
          throw new Error(`Specification approval cannot relocate files during active run ${run.run_id}; wait for its terminal result.`);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
    for (const item of specifications) {
      const status = featureStatus(root, item.slug);
      if (status.drift.length || status.pending_decisions || status.deferred_sections ||
          status.reviews.specification.sha256 !== item.sha256) {
        throw new Error(`Specification ${item.slug} changed or has unresolved requirements; no batch approval was started.`);
      }
    }
    const report = `.mcpee/reports/specification-approvals/${crypto.randomUUID()}.json`;
    ensureDirectory(root, ".mcpee/reports/specification-approvals");
    const record = { generated_by: "mcpee", kind: "explicit-specification-approval", reviewer: reviewer.trim(),
      reason: reason.trim(), requested_at: new Date().toISOString(), specifications, results: [], status: "running" };
    replaceState(root, report, record);
    try {
      for (const item of specifications) {
        const approved = approveStage(root, { slug: item.slug, reviewer, confirmSha256: item.sha256 }, { approvalReport: report });
        record.results.push({ slug: item.slug, sha256: approved.reviews.specification.sha256, document_state: approved.document_state });
        replaceState(root, report, record);
      }
      record.status = "completed";
    } catch (error) {
      record.status = "failed";
      record.error = error.message;
      throw new Error(`Specification approval failed; completed approvals and diagnostics are recorded at ${report}. ${error.message}`, { cause: error });
    } finally {
      record.completed_at = new Date().toISOString();
      replaceState(root, report, record);
    }
    require("../../core/src/telemetry").recordEvent(root, { event_name: "specification.approval.completed",
      attributes: { report, reviewer: record.reviewer, count: record.results.length } });
    return { ...record, report };
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

function reviewSpecification(root, { slug, reviewer, confirmSha256 }) {
  const status = featureStatus(root, slug);
  if (typeof reviewer !== "string" || !reviewer.trim() || /[\r\n]/.test(reviewer)) {
    throw new Error("An accountable reviewer is required.");
  }
  if (status.drift.length || confirmSha256 !== status.reviews.specification.sha256) {
    throw new Error("Review requires the exact current specification digest and unchanged sources.");
  }
  const { directory, lifecycle } = readFeature(root, slug);
  lifecycle.document_review = { reviewer: reviewer.trim(), sha256: confirmSha256, reviewed_at: new Date().toISOString() };
  replaceState(root, `${directory}/lifecycle.json`, lifecycle);
  const result = require("./relocation").relocateFeature(root, slug, status.authoritative ? "approved" : "reviewed");
  refreshCanonicalRetrieval(root);
  return result;
}

function resolveDecision(root, { slug, id, answer, reviewer, resolution = "resolved" }) {
  if (!["resolved", "pending", "deferred"].includes(resolution)) {
    throw new Error("Decision resolution must be resolved, pending or deferred.");
  }
  if (typeof answer !== "string" || answer.trim().length < 8 || answer.length > 4000 ||
      typeof reviewer !== "string" || !reviewer.trim() || /[\r\n]/.test(reviewer) || reviewer.length > 160) {
    throw new Error("A concrete --answer (8-4000 characters) and accountable --reviewer are required.");
  }
  const { directory } = readFeature(root, slug);
  const decisions = readJson(root, `${directory}/decisions.json`);
  const filename = projectPath(root, `${directory}/decisions.md`);
  if (fs.readFileSync(filename, "utf8") !== renderDecisions(decisions)) {
    throw new Error("The readable decision register has owner edits; preserve and reconcile them before using specs decide.");
  }
  const decision = decisions.find((item) => item.id === id);
  if (!decision) throw new Error(`Unknown decision: ${id}`);
  if (decisionResolved(decision)) throw new Error(`Decision already resolved: ${id}; preserve its history and create a reviewed revision.`);
  if (decision.answer === answer.trim() && decision.reviewer === reviewer.trim() &&
      decision.resolution === resolution) {
    return featureStatus(root, slug);
  }
  if (decision.answer) {
    const { history, ...previous } = decision;
    decision.history = [...(history || []), previous];
  }
  Object.assign(decision, { answer: answer.trim(), reviewer: reviewer.trim(), resolution });
  if (resolution === "resolved") decision.resolved_at = new Date().toISOString();
  else if (resolution === "deferred") decision.deferred_at = new Date().toISOString();
  else decision.recorded_at = new Date().toISOString();
  persistDecisionRegister(root, directory, decisions);
  advanceValidatedStages(root, slug);
  refreshWorkspaceIndex(root);
  return featureStatus(root, slug);
}

function reviseDecision(root, { slug, id, answer, reviewer, confirmSha256 }) {
  if (typeof answer !== "string" || answer.trim().length < 8 || answer.length > 4000 ||
      typeof reviewer !== "string" || !reviewer.trim() || /[\r\n]/.test(reviewer) || reviewer.length > 160) {
    throw new Error("A concrete --answer (8-4000 characters) and accountable --reviewer are required.");
  }
  const status = featureStatus(root, slug);
  if (!/^[a-f0-9]{64}$/.test(confirmSha256 || "") ||
      confirmSha256 !== status.reviews.specification.sha256) {
    throw new Error("Decision revision requires the exact current specification SHA-256 from specs status.");
  }
  const { directory } = readFeature(root, slug);
  const decisions = readJson(root, `${directory}/decisions.json`);
  const filename = projectPath(root, `${directory}/decisions.md`);
  if (fs.readFileSync(filename, "utf8") !== renderDecisions(decisions)) {
    throw new Error("The readable decision register has owner edits; preserve and reconcile them before revising a decision.");
  }
  const decision = decisions.find((item) => item.id === id);
  if (!decision) throw new Error(`Unknown decision: ${id}`);
  if (!decisionResolved(decision)) {
    throw new Error(`Decision is not resolved: ${id}; use specs decide to record or settle it.`);
  }
  const now = new Date().toISOString();
  const { history, ...previous } = decision;
  decision.history = [...(history || []), previous];
  Object.assign(decision, {
    answer: answer.trim(),
    reviewer: reviewer.trim(),
    resolution: "resolved",
    resolved_at: now,
    revised_at: now,
  });
  persistDecisionRegister(root, directory, decisions);
  advanceValidatedStages(root, slug);
  refreshWorkspaceIndex(root);
  return featureStatus(root, slug);
}

function rebaseLinks(content, from, to) {
  return content.replace(/(\]\()([^)\s]+)(\))/g, (match, start, target, end) => {
    if (/^(?:[a-z]+:|#|\/)/i.test(target)) return match;
    const [file, fragment] = target.split("#", 2);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURIComponent(file)));
    if (resolved.startsWith("../")) throw new Error(`Legacy document link escapes project: ${target}`);
    return `${start}${path.posix.relative(path.posix.dirname(to), resolved).split("/").map(encodeURIComponent).join("/")}${fragment ? `#${fragment}` : ""}${end}`;
  });
}

function migrateLegacyDrafts(root) {
  const legacy = projectPath(root, "docs/specifications");
  const results = [];
  if (!fs.existsSync(legacy)) return results;
  for (const entry of fs.readdirSync(legacy, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      if (!fs.existsSync(projectPath(root, `docs/specifications/${entry.name.slice(0, -3)}/manifest.json`))) {
        const from = `docs/specifications/${entry.name}`;
        if (["README.md", "MCPEE.md"].includes(entry.name)) continue;
        const directory = workspace(entry.name.slice(0, -3), root);
        if (fs.existsSync(projectPath(root, directory))) {
          results.push({ path: directory, status: "preserved-existing-destination" });
          continue;
        }
        const original = fs.readFileSync(projectPath(root, from), "utf8");
        const destination = `${directory}/spec.md`;
        const content = `> Imported existing draft, NOT an approved or newly generated atomic specification. Original preserved at [${from}](${path.posix.relative(directory, from)}). Decomposition and owner review remain pending.\n\n${rebaseLinks(original, from, destination)}`;
        ensureDirectory(root, directory);
        const created = [];
        try {
          fs.writeFileSync(projectPath(root, destination), content, { flag: "wx" });
          created.push(projectPath(root, destination));
          fs.writeFileSync(projectPath(root, `${directory}/migration.json`), `${JSON.stringify({
            generated_by: "mcpee", from, sha256: hash(original), status: "unvalidated-manual-draft", approval_transferred: false,
          }, null, 2)}\n`, { flag: "wx" });
        } catch (error) {
          for (const file of created) fs.unlinkSync(file);
          throw error;
        }
        results.push({ path: destination, status: "copied-unvalidated-manual-draft", reason: "No atomic manifest; decomposition and review are not inferred." });
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    const oldManifestPath = `docs/specifications/${entry.name}/manifest.json`;
    if (!fs.existsSync(projectPath(root, oldManifestPath))) continue;
    const manifest = readJson(root, oldManifestPath);
    if (manifest.generated_by !== "mcpee" || manifest.kind !== "atomic-functional-specifications" ||
        manifest.index !== `docs/specifications/${entry.name}.md` || !Array.isArray(manifest.cases)) {
      throw new Error(`Unsupported legacy atomic manifest: ${oldManifestPath}`);
    }
    const directory = workspace(entry.name, root);
    if (fs.existsSync(projectPath(root, directory))) {
      results.push({ path: directory, status: "preserved-existing-destination" });
      continue;
    }
    if (sourceDrift(root, manifest).length) throw new Error(`Legacy draft has source drift: ${oldManifestPath}; review before migration.`);
    const outputs = [];
    for (const item of manifest.cases) {
      if (!/^UC-\d{3}$/.test(item.id) || item.path !== `docs/specifications/${entry.name}/${item.id}.md`) {
        throw new Error(`Invalid legacy case path: ${oldManifestPath}`);
      }
      const content = fs.readFileSync(projectPath(root, item.path), "utf8");
      if (hash(content) !== item.sha256) throw new Error(`Edited legacy case needs explicit review: ${item.path}`);
      const canonical = `${directory}/${item.id}.md`;
      let updated = rebaseLinks(content, item.path, canonical);
      for (const other of manifest.cases) updated = updated.replaceAll(`../../docs/specifications/${entry.name}/${other.id}.md`, `${other.id}.md`);
      updated = updated.replaceAll(`../../docs/specifications/${entry.name}.md`, "spec.md");
      outputs.push({ path: canonical, content: updated });
      Object.assign(item, { path: canonical, sha256: hash(updated) });
    }
    const oldIndex = manifest.index;
    const content = fs.readFileSync(projectPath(root, oldIndex), "utf8");
    const newIndex = `${directory}/spec.md`;
    let updated = rebaseLinks(content, oldIndex, newIndex);
    for (const item of manifest.cases) updated = updated.replaceAll(`../../docs/specifications/${entry.name}/${item.id}.md`, `${item.id}.md`);
    const decisions = decisionDocument({
      open_questions: manifest.open_questions || [],
      use_cases: manifest.cases.map((item) => ({ id: item.id, open_questions: item.open_questions || [] })),
    });
    manifest.index = newIndex;
    manifest.migration = { from: oldManifestPath, sha256: hash(fs.readFileSync(projectPath(root, oldManifestPath))), approval_transferred: false };
    outputs.push({ path: newIndex, content: `${updated}\n[Decisions](decisions.md) · [Project workspace](${path.posix.relative(directory, navigationTarget(root))})\n` },
      { path: `${directory}/manifest.json`, content: `${JSON.stringify(manifest, null, 2)}\n` },
      { path: `${directory}/decisions.json`, content: `${JSON.stringify(decisions, null, 2)}\n` },
      { path: `${directory}/decisions.md`, content: renderDecisions(decisions) });
    const created = [];
    try {
      ensureDirectory(root, directory);
      for (const output of outputs) {
        const filename = projectPath(root, output.path);
        fs.writeFileSync(filename, output.content, { flag: "wx" });
        created.push(filename);
      }
    } catch (error) {
      for (const file of created.reverse()) fs.unlinkSync(file);
      if (fs.existsSync(projectPath(root, directory)) && !fs.readdirSync(projectPath(root, directory)).length) fs.rmdirSync(projectPath(root, directory));
      throw error;
    }
    results.push({ path: newIndex, status: "copied-draft-not-approved" });
  }
  refreshWorkspaceIndex(root);
  return results;
}

function navigationTarget(root) {
  const statePath = ".mcpee/state/specification-navigation.json";
  const stateFile = projectPath(root, statePath);
  const previous = fs.existsSync(stateFile) ? readJson(root, statePath) : null;
  for (const relative of [`${SPEC_ROOT}/README.md`, `${SPEC_ROOT}/MCPEE.md`]) {
    const filename = projectPath(root, relative);
    if (!fs.existsSync(filename) || previous?.generated_by === "mcpee" &&
        previous.path === relative && previous.sha256 === hash(fs.readFileSync(filename))) return relative;
  }
  throw new Error("Both docs/specifications/README.md and docs/specifications/MCPEE.md contain owner content. Preserve them and choose an entry-point filename before regenerating navigation.");
}

function refreshWorkspaceIndex(root) {
  const features = listFeatures(root);
  const legacyApprovals = require("./brownfield").listLegacyApprovals(root);
  const atomicCases = features.filter((feature) => feature.status !== "unvalidated-manual-draft")
    .flatMap((feature) => readFeature(root, feature.id).manifest.cases.map((item) => ({
      name: item.name || path.posix.basename(item.path, ".md"),
      title: item.title || item.goal, path: item.path, feature: feature.id, status: feature.document_state,
      authoritative: feature.authoritative, implemented: feature.implementation_verified,
    }))).sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  const relative = navigationTarget(root);
  const filename = projectPath(root, relative);
  const statePath = ".mcpee/state/specification-navigation.json";
  const content = [
    MARKER, "# Project specifications / Especificaciones del proyecto", "",
    "**Start here / Empieza aqui.** The same product workspace for greenfield and brownfield. Internal extraction inventories are not functional specifications.", "",
    "## Atomic specifications / Especificaciones atomicas", "",
    ...(atomicCases.length ? [
      "| Name / Nombre | Capability / Capacidad | State / Estado | Source of truth / Fuente de verdad | Implementation / Implementacion |",
      "| --- | --- | --- | --- | --- |",
      ...atomicCases.map((item) => `| [${item.name}](${path.posix.relative(SPEC_ROOT, item.path)}) | ${item.title.replace(/[|\r\n]/g, " ")} | ${item.status} | ${item.authoritative ? "yes / si" : "no"} | ${item.implemented ? "verified / verificada" : "not verified / no verificada"} |`),
    ] : [
      "No atomic functional specifications have been authored yet. Internal extraction inventories do not count as completed specs.",
      "Ask MCPEE to draft specifications from the product documents and/or existing application. Prepared scopes are batches of evidence, not atomic business capabilities.",
    ]),
    "",
    ...(legacyApprovals.length ? [
      "## Previously ratified contracts / Contratos ratificados", "",
      ...legacyApprovals.map(item => `- [${item.slug}](${path.posix.relative(SPEC_ROOT, item.path)}) - approved; source of truth; historical static proposal, not newly authored atomic use cases.`), "",
    ] : []),
    "## Workflow / Flujo", "",
    "proposed -> reviewed -> approved. Files move with their documentary state; feature and case names do not change.",
    "Proposed and reviewed documents are NOT authoritative. Only explicit specification approval promotes them to approved, the project source of truth. Structural validation may move a proposal to reviewed; passing implementation checks never approves requirements.",
    "Implementation verification covers the recorded checks, not untested behavior, visual acceptance or production deployment. Source drift and stale checks remain visible.",
    "Run `mcpee specs status` for review hashes and the next step. No model is invoked by status or approval.", "",
    "## Features / Funcionalidades", "",
    ...(features.length ? features.map((feature) =>
      `- [${feature.id}](${path.posix.relative(SPEC_ROOT, feature.path)}) - **${feature.document_state}**; source of truth: ${feature.authoritative ? "yes" : "no"}; next: ${feature.next}; open decisions: ${feature.pending_decisions ?? "not inventoried"}; blocking source drift: ${feature.drift.length}; reviewed out-of-scope drift: ${feature.reviewed_source_drift?.length || 0}.${feature.status !== "unvalidated-manual-draft" ? ` [Decisions](${path.posix.relative(SPEC_ROOT, path.posix.join(path.posix.dirname(feature.path), "decisions.md"))})` : ""}${feature.reviews.plan.present ? `; [Plan](${path.posix.relative(SPEC_ROOT, feature.reviews.plan.path)})` : ""}${feature.reviews.tasks.present ? `; [Tasks](${path.posix.relative(SPEC_ROOT, feature.reviews.tasks.path)})` : ""}`)
      : ["No canonical specifications yet. Request functional authoring from product sources; the origin does not change the workspace or naming."]),
    "", "## Where things belong / Donde esta cada cosa", "",
    "- docs/: all project-facing documentation. Start here for questions about the product, not in hidden MCPEE state.",
    "- docs/specifications/{proposed,reviewed,approved}/&lt;feature&gt;/&lt;case-slug&gt;.md: one readable atomic capability per file, e.g. about-us-staff.md or about-us-ambassador.md. UC IDs are internal references, not public filenames.",
    "- spec.md is the feature overview; decisions.md, plan.md and tasks.md track its decisions and delivery. JSON records keep the structured contract and provenance with the documents.",
    "- [Generated documentation](../generated/): source-backed extraction inventories and maps, NOT approved requirements.",
    "- [knowledge/sources](../../knowledge/sources/): original knowledge supplied by the project owners. Existing project-specific input locations remain valid.",
    "- knowledge/normalized, extracted and traceability: derived local retrieval material, converted text and source hashes; embeddings/indexes remain engine-managed.",
    "- .mcpee/: MCPEE tools, state, caches, execution and migration evidence ONLY. Agent/IDE integrations remain in their standard project locations.",
    "", "Use `mcpee specs migrate` to relocate existing workspaces. Original review evidence is retained and relocation never grants authority.",
    "", "## Validation evidence / Evidencia de validacion", "",
    ...[".mcpee/reports/workflows", ".mcpee/reports/runs"].filter((file) => fs.existsSync(projectPath(root, file)))
      .map((file) => `- [${file}](../../${file}/): recorded execution evidence; inspect status and scope, not just file existence.`),
    "Requirement approval and task readiness do not replace passing project checks or human product/visual acceptance.",
    "", "## Automatic phases", "",
    "Runtime-authored features retain proposed -> reviewed -> approved transition evidence. Validation permits technical planning, but tasks and implementation require explicit specification approval. A user instruction to approve selected specifications or a batch is sufficient; no per-proposal confirmation is required. Generating or implementing is not an approval instruction.",
    "Use mcpee_specs_status to inspect current digests, then mcpee_specs_approve only when the user explicitly requests approval. Plan/task validation advances automatically after requirement approval.",
    "Open decisions or risky actions remain explicit blockers. Read the structured JSON and Markdown together before changing a phase.", "",
    "## Review and approval commands", "",
    "1. `mcpee specs status --slug <id>` — inspect decisions, source drift, per-stage digest and next action.",
    "   `mcpee specs review --slug <id> --reviewer \"owner\" --confirm-sha256 <digest>` records review without approval.",
    "2. `mcpee specs decide --slug <id> --id Q-001 --answer \"owner decision\" --reviewer \"owner\"`.",
    "3. `mcpee specs approve --slug <id> --stage specification --reviewer \"owner\" --confirm-sha256 <reviewed-digest>`.",
    "   `mcpee specs approve --all-current --reviewer \"owner\" --reason \"explicit user approval instruction\"` approves the current canonical batch, without additional prompts. Unknown/stale digests, open requirements and active runs block batch approval.",
    "4. Author plan.md against spec.md and UC IDs, then approve with `--stage plan`.",
    "5. Author tasks.md against spec.md, plan.md and UC IDs, then approve with `--stage tasks`.",
    "6. Implement and run the project's real validation checks. Ready-for-implementation is NOT verified or delivered.", "",
  ].join("\n");
  ensureDirectory(root, SPEC_ROOT);
  for (const state of STATES) ensureDirectory(root, `${SPEC_ROOT}/${state}`);
  ensureDirectory(root, "docs/generated");
  ensureDirectory(root, ".mcpee/state");
  fs.writeFileSync(filename, content);
  replaceState(root, statePath, { generated_by: "mcpee", path: relative, sha256: hash(content) });
  refreshDocsIndex(root, relative);
  return { path: relative, status: relative === `${SPEC_ROOT}/README.md` ? "updated" : "updated-preserving-owner-readme" };
}

function refreshDocsIndex(root, specificationIndex) {
  const statePath = ".mcpee/state/documentation-navigation.json";
  const previous = fs.existsSync(projectPath(root, statePath)) ? readJson(root, statePath) : null;
  const relative = ["docs/README.md", "docs/MCPEE.md"].find(file =>
    !fs.existsSync(projectPath(root, file)) || previous?.generated_by === "mcpee" &&
    previous.path === file && previous.sha256 === hash(fs.readFileSync(projectPath(root, file))));
  if (!relative) throw new Error("docs/README.md and docs/MCPEE.md both contain owner edits; preserve them and reconcile the documentation entry point.");
  const content = [
    MARKER, "# Project documentation / Documentacion del proyecto", "",
    "Start here for product questions. All user-facing project documentation belongs under docs/.", "",
    `- [Specifications: proposed, reviewed and approved](${path.posix.relative("docs", specificationIndex)}).`,
    "- [Generated documentation and source inventories](generated/): evidence and maps, not automatic product approval.",
    "- [Owner-supplied knowledge](../knowledge/sources/): original inputs; normalized/extracted knowledge supports local retrieval.",
    "", "Only explicitly approved specifications are sources of truth. Passing implementation checks is separate evidence, not requirement approval.",
    "Reviewed proposals are not approved. Verification is bounded to its recorded checks; stale evidence is shown in specification status.",
    "MCPEE's tools, execution state and evidence live under .mcpee/; IDE integrations use standard project locations.", "",
  ].join("\n");
  fs.writeFileSync(projectPath(root, relative), content);
  replaceState(root, statePath, { generated_by: "mcpee", path: relative, sha256: hash(content) });
}

function migrateDrafts(root) {
  const results = [];
  const navigationState = ".mcpee/state/specification-navigation.json";
  const previousNavigation = fs.existsSync(projectPath(root, navigationState)) ? readJson(root, navigationState) : null;
  const latestPath = ".mcpee/specs/latest.json";
  const hasLatest = fs.existsSync(projectPath(root, latestPath));
  const latest = hasLatest ? readJson(root, latestPath) : null;
  if (hasLatest && (!latest || latest.generated_by !== "mcpee" || !Array.isArray(latest.proposals))) {
    throw new Error(`Refusing to overwrite user-owned review state: ${latestPath}`);
  }
  for (const feature of listFeatures(root).filter(item => item.status !== "unvalidated-manual-draft")) {
    const migrated = migrateReviewHistory(root, feature.id);
    if (migrated.status !== "unchanged") results.push(migrated);
  }
  for (const feature of listFeatures(root).filter(item => item.document_state === "legacy")) {
    if (feature.status === "unvalidated-manual-draft") {
      const from = path.posix.dirname(feature.path);
      const to = `${SPEC_ROOT}/proposed/${feature.id}`;
      if (fs.existsSync(projectPath(root, to))) throw new Error(`Migration destination already exists: ${to}`);
      require("./relocation").relocateDocuments(root, from, to);
      results.push({ path: `${to}/spec.md`, status: "moved-unvalidated-manual-draft" });
      continue;
    }
    const updated = require("./relocation").relocateFeature(root, feature.id,
      feature.authoritative ? "approved" : feature.reviews.specification.approved ? "reviewed" : "proposed");
    results.push({ path: updated.path, status: "moved-preserving-review-evidence" });
  }
  const legacyApproved = "specs/approved";
  if (fs.existsSync(projectPath(root, legacyApproved))) {
    results.push(require("./relocation").relocateDocuments(root, legacyApproved, `${SPEC_ROOT}/approved`, { rewriteJson: true }));
  }
  const legacyEvidence = ".mcpee/specs/proposed";
  const legacyReviews = ".mcpee/specs/reviews";
  const evidenceDestinations = [[legacyEvidence, "docs/generated/specification-evidence"],
    [legacyReviews, "docs/generated/specification-evidence/reviews"]];
  if (fs.existsSync(projectPath(root, legacyEvidence))) {
    results.push(require("./relocation").relocateDocuments(root, legacyEvidence, evidenceDestinations[0][1],
      { destinations: evidenceDestinations, rewriteJson: true }));
  }
  if (fs.existsSync(projectPath(root, legacyReviews))) {
    results.push(require("./relocation").relocateDocuments(root, legacyReviews, evidenceDestinations[1][1],
      { destinations: evidenceDestinations, rewriteJson: true }));
  }
  if (latest) {
      const rewrite = value => {
        if (typeof value === "string") {
          const mapping = evidenceDestinations.find(([from]) => value.startsWith(`${from}/`));
          return mapping ? `${mapping[1]}${value.slice(mapping[0].length)}` : value;
        }
        if (Array.isArray(value)) return value.map(rewrite);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
        return value;
      };
      const updated = rewrite(latest);
      if (JSON.stringify(updated) !== JSON.stringify(latest)) replaceState(root, latestPath, updated);
  }
  results.push(...migrateLegacyDrafts(root));
  refreshWorkspaceIndex(root);
  if (previousNavigation?.generated_by === "mcpee" &&
      ["specs/README.md", "specs/MCPEE.md"].includes(previousNavigation.path)) {
    const filename = projectPath(root, previousNavigation.path);
    if (fs.existsSync(filename) && hash(fs.readFileSync(filename)) === previousNavigation.sha256) fs.unlinkSync(filename);
  }
  if (fs.existsSync(projectPath(root, "specs")) && !fs.readdirSync(projectPath(root, "specs")).length) {
    fs.rmdirSync(projectPath(root, "specs"));
  }
  return results;
}

module.exports = {
  workspace, readFeature, currentDigest, sourceDrift, featureStatus, listFeatures, approveStage,
  decisionDocument, renderDecisions, resolveDecision, reviseDecision, refreshWorkspaceIndex, migrateDrafts, navigationTarget,
  canonicalArtifacts, reviewPaths,
  advanceValidatedStages, reviewSpecification, approveSpecifications, migrateReviewHistory,
};
