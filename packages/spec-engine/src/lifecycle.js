"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { projectPath, ensureDirectory } = require("./brownfield");

const MARKER = "<!-- MCPEE specification workspace; generated navigation, not product approval -->";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const stages = ["specification", "plan", "tasks"];
const files = { specification: "spec.md", plan: "plan.md", tasks: "tasks.md" };

function workspace(slug) {
  if (typeof slug !== "string" || !slugPattern.test(slug) || ["approved", "readme"].includes(slug)) {
    throw new Error("Specification ID must be a lowercase descriptive slug, not an internal directory name.");
  }
  return `specs/${slug}`;
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(projectPath(root, relative), "utf8"));
}

function readFeature(root, slug) {
  const directory = workspace(slug);
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
  const filename = projectPath(root, relative);
  const temporary = projectPath(root, `${relative}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function decisionDocument(document) {
  const questions = [
    ...document.open_questions.map((question) => ({ scope: "product", question })),
    ...document.use_cases.flatMap((useCase) => useCase.open_questions.map((question) => ({ scope: useCase.id, question }))),
  ];
  return questions.map((question, index) => ({ id: `Q-${String(index + 1).padStart(3, "0")}`, ...question, answer: null }));
}

function renderDecisions(decisions) {
  return [
    "<!-- MCPEE decision register; answers require an accountable owner -->",
    "# Decisions / Decisiones", "",
    "Resolve with `mcpee specs decide --slug <id> --id Q-001 --answer \"...\" --reviewer \"...\"`.",
    "Answers record owner decisions, not automatically verified facts.", "",
    ...(decisions.length ? decisions.flatMap((decision) => [
      `## ${decision.id} (${decision.scope})`, "", decision.question, "",
      decision.answer ? `**Resolved by ${decision.reviewer}:** ${decision.answer}` : "**OPEN / PENDIENTE**", "",
    ]) : ["No open questions were recorded. Human review is still required.", ""]),
  ].join("\n");
}

function reviewPaths(root, slug, stage) {
  if (!stages.includes(stage)) throw new Error("Review stage must be specification, plan or tasks.");
  const { directory, manifest } = readFeature(root, slug);
  const paths = stage === "specification"
    ? [`${directory}/manifest.json`, manifest.index, ...manifest.cases.map((item) => item.path),
      `${directory}/decisions.json`, `${directory}/decisions.md`]
    : [`${directory}/${files[stage]}`];
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
  const drift = sourceDrift(root, manifest);
  const reviews = {};
  let previous = true;
  for (const stage of stages) {
    const present = fs.existsSync(projectPath(root, `${directory}/${files[stage]}`));
    const digest = present ? currentDigest(root, slug, stage) : null;
    const approval = lifecycle.approvals[stage];
    const approved = previous && Boolean(approval && approval.sha256 === digest &&
      (stage === "specification" || approval.specification_sha256 === reviews.specification.sha256) &&
      (stage !== "tasks" || approval.plan_sha256 === reviews.plan.sha256));
    reviews[stage] = { path: `${directory}/${files[stage]}`, present, sha256: digest, approved };
    previous = approved;
  }
  const pending = decisions.filter((decision) => !decision.answer).length;
  const deferred = manifest.coverage.filter((section) => section.status === "deferred").length;
  const next = drift.length ? "synchronize-and-review-source-drift"
    : !reviews.specification.approved ? (pending || deferred ? "clarify" : "review-specification")
    : !reviews.plan.approved ? (reviews.plan.present ? "review-plan" : "author-plan")
    : !reviews.tasks.approved ? (reviews.tasks.present ? "review-tasks" : "author-tasks")
    : "implement-and-verify";
  return {
    id: slug, path: manifest.index, status: reviews.tasks.approved ? "ready-for-implementation" : "draft",
    next, pending_decisions: pending, deferred_sections: deferred, drift, reviews,
    implementation_verified: false,
  };
}

function listFeatures(root) {
  const directory = projectPath(root, "specs");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "approved" && slugPattern.test(entry.name))
    .filter((entry) => fs.existsSync(projectPath(root, `specs/${entry.name}/spec.md`)))
    .map((entry) => {
      if (fs.existsSync(projectPath(root, `specs/${entry.name}/manifest.json`))) return featureStatus(root, entry.name);
      return {
        id: entry.name, path: `specs/${entry.name}/spec.md`, status: "unvalidated-manual-draft",
        next: "author-and-review-functional-specification", pending_decisions: null, drift: [],
        reviews: Object.fromEntries(stages.map((stage) => [stage, {
          path: `specs/${entry.name}/${files[stage]}`,
          present: fs.existsSync(projectPath(root, `specs/${entry.name}/${files[stage]}`)), approved: false,
        }])),
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
}

function approveStage(root, { slug, stage = "specification", reviewer, confirmSha256 }) {
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
  if (stage !== "specification") {
    const content = fs.readFileSync(projectPath(root, status.reviews[stage].path), "utf8");
    if (content.trim().length < 80 || /<[^>]+>|\b(?:TODO|TBD|placeholder)\b/.test(content) ||
        !content.includes("spec.md") || !/UC-\d{3}/.test(content) ||
        (stage === "tasks" && (!content.includes("plan.md") || !/- \[[ x]\]/.test(content)))) {
      throw new Error(`${stage} needs substantive, source-linked content and use-case references, without placeholders; tasks also require plan.md and checkable work items.`);
    }
  }
  const { directory, lifecycle } = readFeature(root, slug);
  const approval = {
    reviewer: reviewer.trim(), sha256: digest, approved_at: new Date().toISOString(),
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
  ensureDirectory(root, `${directory}/reviews`);
  const snapshotPath = `${directory}/reviews/${stage}-${crypto.randomUUID()}.json`;
  fs.writeFileSync(projectPath(root, snapshotPath), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
  lifecycle.approvals[stage] = { ...approval, snapshot: snapshotPath };
  try {
    replaceState(root, `${directory}/lifecycle.json`, lifecycle);
  } catch (error) {
    fs.unlinkSync(projectPath(root, snapshotPath));
    throw error;
  }
  refreshWorkspaceIndex(root);
  return featureStatus(root, slug);
}

function resolveDecision(root, { slug, id, answer, reviewer }) {
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
  if (decision.answer) throw new Error(`Decision already resolved: ${id}; preserve its history and create a reviewed revision.`);
  Object.assign(decision, { answer: answer.trim(), reviewer: reviewer.trim(), resolved_at: new Date().toISOString() });
  replaceState(root, `${directory}/decisions.json`, decisions);
  fs.writeFileSync(filename, renderDecisions(decisions));
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

function migrateDrafts(root) {
  const legacy = projectPath(root, "docs/specifications");
  const results = [];
  if (!fs.existsSync(legacy)) return results;
  for (const entry of fs.readdirSync(legacy, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      if (!fs.existsSync(projectPath(root, `docs/specifications/${entry.name.slice(0, -3)}/manifest.json`))) {
        const from = `docs/specifications/${entry.name}`;
        const directory = workspace(entry.name.slice(0, -3));
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
    const directory = workspace(entry.name);
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
  for (const relative of ["specs/README.md", "specs/MCPEE.md"]) {
    const filename = projectPath(root, relative);
    if (!fs.existsSync(filename) || previous?.generated_by === "mcpee" &&
        (previous.path || "specs/README.md") === relative && previous.sha256 === hash(fs.readFileSync(filename))) return relative;
  }
  throw new Error("Both specs/README.md and specs/MCPEE.md contain owner content. Preserve them and choose an entry-point filename before regenerating navigation.");
}

function refreshWorkspaceIndex(root) {
  const features = listFeatures(root);
  const relative = navigationTarget(root);
  const filename = projectPath(root, relative);
  const statePath = ".mcpee/state/specification-navigation.json";
  const legacy = ["docs/specifications", ".mcpee/specs/reviews", "specs/approved", ".mcpee/planning"]
    .filter((file) => fs.existsSync(projectPath(root, file)));
  const content = [
    MARKER, "# Project workspace / Espacio del proyecto", "",
    "**Start here / Empieza aqui.** Product specifications live together; extraction inventories are not approved requirements.", "",
    "## Workflow / Flujo", "",
    "Sources -> specification and use cases -> clarification -> owner approval -> technical plan -> ordered tasks -> implementation -> verification.",
    "Each review is explicit. Draft creation, installed specialists and passing structural checks do not prove product acceptance.",
    "Run `mcpee specs status` for review hashes and the next step. No model is invoked by status or approval.", "",
    "## Features / Funcionalidades", "",
    ...(features.length ? features.map((feature) =>
      `- [${feature.id}](${feature.id}/spec.md) — **${feature.status}**; next: ${feature.next}; open decisions: ${feature.pending_decisions ?? "not inventoried"}; source drift: ${feature.drift.length}.${feature.status !== "unvalidated-manual-draft" ? ` [Decisions](${feature.id}/decisions.md)` : ""}${feature.reviews.plan.present ? `; [Plan](${feature.id}/plan.md)` : ""}${feature.reviews.tasks.present ? `; [Tasks](${feature.id}/tasks.md)` : ""}`)
      : ["No canonical specifications yet. Request greenfield authoring from your product sources; no empty plan counts as a specification."]),
    "", "## Where things belong / Donde esta cada cosa", "",
    "- [knowledge/sources](../knowledge/sources/): original business, architecture, technical and other project inputs; edit your originals here.",
    "- specs/&lt;feature&gt;/: editable product spec.md, UC-###.md cases, decisions.md, plan.md and tasks.md; manifest/lifecycle JSON records provenance and review.",
    "- [docs/generated](../docs/generated/): regenerated evidence maps, NOT desired behavior or product approval; change the original sources instead.",
    "- knowledge/normalized, extracted and traceability: machine-derived text, metadata and source hashes; not the place to author requirements.",
    "- [.mcpee/generated](../.mcpee/generated/): installed harness catalog and capability reports, not your product specifications.",
    "- .mcpee/specs/proposed and reviews: static extraction inventories and historical review evidence, not the canonical greenfield workspace.",
    "- .mcpee/: internal tools, indexes and execution evidence; do not move or delete it to reorganize documents.",
    "", "## Existing material / Material anterior", "",
    ...legacy.map((file) => `- [${file}](../${file}/): preserved historical material; not silently promoted to approval.`),
    "", "Use `mcpee specs migrate` to copy supported atomic drafts into the canonical workspace without deleting originals.",
    "Monolithic/manual drafts are copied as unvalidated drafts, not automatically decomposed or approved. Old approvals stay linked above and are not rewritten.",
    "", "## Validation evidence / Evidencia de validacion", "",
    ...[".mcpee/reports/workflows", ".mcpee/reports/runs"].filter((file) => fs.existsSync(projectPath(root, file)))
      .map((file) => `- [${file}](../${file}/): recorded execution evidence; inspect status and scope, not just file existence.`),
    "Requirement approval and task readiness do not replace passing project checks or human product/visual acceptance.",
    "", "## Review commands", "",
    "1. `mcpee specs status --slug <id>` — inspect decisions, source drift, per-stage digest and next action.",
    "2. `mcpee specs decide --slug <id> --id Q-001 --answer \"owner decision\" --reviewer \"owner\"`.",
    "3. `mcpee specs approve --slug <id> --stage specification --reviewer \"owner\" --confirm-sha256 <reviewed-digest>`.",
    "4. Author plan.md against spec.md and UC IDs, then approve with `--stage plan`.",
    "5. Author tasks.md against spec.md, plan.md and UC IDs, then approve with `--stage tasks`.",
    "6. Implement and run the project's real validation checks. Ready-for-implementation is NOT verified or delivered.", "",
  ].join("\n");
  ensureDirectory(root, "specs");
  ensureDirectory(root, ".mcpee/state");
  fs.writeFileSync(filename, content);
  replaceState(root, statePath, { generated_by: "mcpee", path: relative, sha256: hash(content) });
  return { path: relative, status: relative === "specs/README.md" ? "updated" : "updated-preserving-owner-readme" };
}

module.exports = {
  workspace, readFeature, currentDigest, sourceDrift, featureStatus, listFeatures, approveStage,
  decisionDocument, renderDecisions, resolveDecision, refreshWorkspaceIndex, migrateDrafts, navigationTarget,
};
