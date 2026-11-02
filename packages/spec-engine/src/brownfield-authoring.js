"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { renameAtomicSync } = require("../../core/src/atomic-file");
const { projectPath, ensureDirectory } = require("./brownfield");
const { buildSpecificationScopes, scopeCoveredByManifest, withSpecificationScopePlanning } = require("./scopes");
const { featureStatus, readFeature, refreshWorkspaceIndex } = require("./lifecycle");
const { featureDirectories, SPEC_ROOT } = require("./storage");
const { validateFunctionalSpec } = require("./functional");

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const LOCK = ".mcpee/state/brownfield-authoring.lock";

function isBrownfieldRequest(task) {
  if (typeof task !== "string") return false;
  const normalized = task.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /(?:^\s*brownfield\b|\b(?:run|execute|perform|haz(?:me)?|hacer|ejecuta\w*|lanza\w*|realiza\w*)\s+(?:(?:the|a|an|full|complete|project|el|un|todo|completo)\s+)*brownfield\b)/.test(normalized) &&
    !/^Generate brownfield functional specifications for scope /.test(task) &&
    !/\b(?:explain|what is|que es|explica|do not run|no ejecutes)\b/.test(normalized);
}

function featureInventory(root) {
  return featureDirectories(root).filter(({ directory }) =>
    fs.existsSync(projectPath(root, `${directory}/manifest.json`)) &&
    (!directory.startsWith(`${SPEC_ROOT}/approved/`) || !fs.existsSync(projectPath(root, `${directory}/evidence.json`))))
    .map(({ slug }) => readFeature(root, slug));
}

function currentFeature(root, scope, inventory = featureInventory(root)) {
  const expected = [...scope.sources, ...scope.context_sources];
  const sourceSet = sources => JSON.stringify(sources.map(source => ({
    path: source.original_path || source.path, sha256: source.original_sha256 || source.sha256,
  })).sort((a, b) => a.path.localeCompare(b.path)));
  const matches = inventory.filter(({ manifest }) => manifest.authoring_scope?.id === scope.id &&
      manifest.authoring_scope.source_snapshot_sha256 === scope.source_snapshot_sha256 ||
      scope.unit_version === 2 && !manifest.authoring_scope?.unit_version && scopeCoveredByManifest(scope, manifest));
  if (matches.length > 1) throw new Error(`Multiple authored features match scope ${scope.id}; reconcile them before resuming.`);
  if (!matches.length) return null;
  const { directory, manifest } = matches[0];
  const feature = featureStatus(root, path.posix.basename(directory));
  const legacy = !manifest.authoring_scope?.unit_version && scope.unit_version === 2;
  if (!legacy && scope.source_selections) {
    const recorded = manifest.sources.map(source => ({
      path: source.original_path || source.path, sha256: source.original_sha256 || source.sha256,
      role: source.coverage_role, ranges: source.selected_ranges,
    }));
    if (JSON.stringify(recorded) !== JSON.stringify(scope.source_selections) ||
        JSON.stringify(manifest.authoring_scope.source_selections) !== JSON.stringify(scope.source_selections)) {
      throw new Error(`Existing scope ${scope.id} has edited source selections; preserve and reconcile it before resuming.`);
    }
  }
  if ((!legacy && sourceSet(manifest.sources) !== sourceSet(expected)) || feature.drift.length) {
    throw new Error(`Existing scope ${scope.id} has changed inputs; review its preserved feature ${feature.id} before regenerating.`);
  }
  for (const artifact of [{ path: manifest.index, sha256: manifest.index_sha256 },
    { path: manifest.document, sha256: manifest.document_sha256 }, ...manifest.cases]) {
    if (!artifact.path || hash(fs.readFileSync(projectPath(root, artifact.path))) !== artifact.sha256) {
      throw new Error(`Authored feature ${feature.id} has edited artifacts; preserve and reconcile it before resuming.`);
    }
  }
  const sources = require("./functional").prepareRecordedFunctionalSources(root, manifest.sources);
  validateFunctionalSpec(root, fs.readFileSync(projectPath(root, manifest.document), "utf8"), sources);
  return { feature: feature.id, path: manifest.index, cases: manifest.cases.length,
    document_state: feature.document_state, authoritative: feature.authoritative,
    open_questions: manifest.unresolved_decisions, deferred_sections: manifest.deferred_sections, directory };
}

function acquireLock(root) {
  ensureDirectory(root, ".mcpee/state");
  const filename = projectPath(root, LOCK);
  if (fs.existsSync(filename)) {
    const recovery = `${filename}.recovery`;
    let descriptor;
    try { descriptor = fs.openSync(recovery, "wx"); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      throw new Error("Brownfield lock recovery is already claimed; inspect its recorded owner before retrying.", { cause: error });
    }
    try {
      fs.writeFileSync(descriptor, JSON.stringify({ generated_by: "mcpee", pid: process.pid }));
      const owner = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (owner.generated_by !== "mcpee" || !Number.isInteger(owner.pid) || owner.pid <= 0) {
        throw new Error("Invalid brownfield authoring lock; preserve it and inspect the recorded owner.");
      }
      let active = true;
      try { process.kill(owner.pid, 0); }
      catch (error) {
        if (error.code !== "ESRCH") throw error;
        active = false;
      }
      if (active) throw new Error(`Brownfield authoring is already running in process ${owner.pid}; do not start a duplicate batch.`);
      fs.unlinkSync(filename);
    } finally {
      fs.closeSync(descriptor);
      fs.unlinkSync(recovery);
    }
  }
  const token = crypto.randomUUID();
  fs.writeFileSync(filename, JSON.stringify({ generated_by: "mcpee", pid: process.pid, token }), { flag: "wx" });
  return () => {
    const owner = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (owner.token !== token) throw new Error("Brownfield authoring lock ownership changed.");
    fs.unlinkSync(filename);
  };
}

function brownfieldConcurrency(pending, requested = "auto") {
  if (!Number.isInteger(pending) || pending < 0) throw new Error("Pending scope count must be a nonnegative integer.");
  if (requested === "auto") return Math.min(10, Math.ceil(pending / 10));
  if (!Number.isInteger(requested) || requested < 1 || requested > 10) {
    throw new Error("Brownfield concurrency must be auto or an integer between 1 and 10.");
  }
  return requested;
}

function authorBrownfield(root, options = {}) {
  return withSpecificationScopePlanning(root, () => authorBrownfieldBatch(root, options));
}

async function authorBrownfieldBatch(root, options = {}) {
  if (options.authorized !== true) throw new Error("Requesting complete brownfield authorizes Copilot source transfer and quota use; local preparation alone does not.");
  const requestedConcurrency = options.concurrency ?? "auto";
  brownfieldConcurrency(0, requestedConcurrency);
  let concurrency = 0;
  const lastDomains = options.lastDomains ?? [];
  if (!Array.isArray(lastDomains) || lastDomains.some(domain => typeof domain !== "string" || !/^[a-z0-9-]+$/.test(domain))) {
    throw new Error("Brownfield last domains must be exact lowercase domain names.");
  }
  const release = acquireLock(root);
  const shutdown = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, shutdown.signal]) : shutdown.signal;
  let heartbeat;
  let heartbeatError;
  const id = crypto.randomUUID();
  const reportPath = `.mcpee/reports/brownfield/${id}.json`;
  const record = {
    schema_version: 1, generated_by: "mcpee", id, status: "running",
    started_at: new Date().toISOString(), phases: [], scopes: [],
    authority_granted: false, product_acceptance: "not-verified",
    concurrency, requested_concurrency: requestedConcurrency, last_domains: lastDomains,
    duration_notice: "Large brownfield discovery can take hours. Activity is not proof of completion; failed scopes retain evidence and do not stop independent scopes.",
  };
  ensureDirectory(root, ".mcpee/reports/brownfield");
  const save = () => {
    record.summary = {
      total: record.scopes.length,
      completed: record.scopes.filter(scope => ["authored", "preserved-current"].includes(scope.status)).length,
      failed: record.scopes.filter(scope => scope.status === "failed").length,
      active: record.scopes.filter(scope => scope.status === "running").length,
      pending: record.scopes.filter(scope => scope.status === "pending").length,
    };
    const filename = projectPath(root, reportPath);
    const temporary = projectPath(root, `${reportPath}.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
      renameAtomicSync(temporary, filename);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
  try {
    save();
    const planning = buildSpecificationScopes(root);
    record.source_manifest_sha256 = planning.source_manifest_sha256;
    record.coverage = planning.summary;
    record.blocked_sources = planning.blocked;
    record.excluded_sources = planning.excluded;
    record.phases.push({ phase: "source-preparation", status: planning.status });
    if (!planning.scopes.length) {
      record.status = "blocked";
      record.reason = "Complete source conversion and bounded preparation before paid authoring. No input was silently dropped.";
      return { ...record, report: reportPath, exitCode: 1 };
    }
    const resume = options.resumeSessionId
      ? require("../../execution-engine/src/recoverable-sessions").readSession(root, options.resumeSessionId).record : null;
    const resumeScope = resume && planning.scopes.find(scope => hash(scope.task) === resume.task_sha256);
    if (resume && (!resumeScope || resume.status !== "interrupted")) {
      throw new Error("Resume requires an interrupted SDK session matching one exact current brownfield scope.");
    }
    if (resumeScope && currentFeature(root, resumeScope)) {
      throw new Error("The requested interrupted scope is already published; preserve its current artifacts instead of resuming paid work.");
    }
    for (const domain of lastDomains) {
      if (!planning.scopes.some(scope => scope.domain === domain)) throw new Error(`Unknown brownfield last domain: ${domain}`);
    }
    const scopes = [...planning.scopes.filter(scope => !lastDomains.includes(scope.domain)),
      ...planning.scopes.filter(scope => lastDomains.includes(scope.domain))];
    record.scopes = scopes.map(scope => ({
      id: scope.id, domain: scope.domain, status: "pending",
      primary_sources: scope.sources.map(source => source.path),
      source_selections: scope.source_selections,
      documentation_context: scope.context_sources.map(source => source.path),
      context_omitted: scope.context_omitted,
    }));
    save();
    const progress = (entry, event) => {
      options.onProgress?.({ ...record.summary, scope: entry.id, event,
        concurrency: record.concurrency,
        error: entry.error, elapsed_ms: Date.now() - Date.parse(record.started_at),
        last_activity_at: entry.last_activity_at || entry.started_at, report: reportPath });
    };
    const inventory = featureInventory(root);
    for (const scope of scopes) {
      signal.throwIfAborted();
      const entry = record.scopes.find(item => item.id === scope.id);
      try {
        const existing = currentFeature(root, scope, inventory);
        if (existing) {
          Object.assign(entry, existing, { status: "preserved-current", completed_at: new Date().toISOString() });
        }
      } catch (error) {
        Object.assign(entry, { status: "failed", error: error.message, completed_at: new Date().toISOString() });
      }
      if (entry.status !== "pending") {
        save(); progress(entry, entry.status);
      }
      await new Promise(resolve => setImmediate(resolve));
    }
    const pending = scopes.filter(scope => record.scopes.find(entry => entry.id === scope.id).status === "pending");
    concurrency = brownfieldConcurrency(pending.length, requestedConcurrency);
    record.concurrency = concurrency;
    record.pending_authoring_units = pending.length;
    record.phases.push({ phase: "authoring-preparation", status: "ready",
      pending_units: pending.length, concurrency });
    save();
    heartbeat = setInterval(() => {
      try {
        save();
        for (const entry of record.scopes.filter(scope => scope.status === "running")) progress(entry, "heartbeat");
      } catch (error) {
        heartbeatError = error;
        shutdown.abort(error);
      }
    }, 30_000);
    const execute = options.execute || (async (scope, plan, executionOptions) =>
      require("../../execution-engine/src/copilot").runCopilotTask(root, scope.task, plan, {
        approved: true, proposalOnly: true, model: options.model || "auto",
        signal, onProgress: update => {
          options.onModelProgress?.({ ...update, scope: scope.id });
          const entry = record.scopes.find(item => item.id === scope.id);
          entry.last_activity_at = new Date().toISOString();
          entry.model_progress = update;
          try { save(); } catch (error) { shutdown.abort(error); throw error; }
        },
        ...executionOptions,
      }));
    const processScope = async scope => {
      const entry = record.scopes.find(item => item.id === scope.id);
      Object.assign(entry, { status: "running", started_at: new Date().toISOString() });
      save(); progress(entry, "started");
      try {
        const existing = currentFeature(root, scope);
        if (existing) {
          Object.assign(entry, existing, { status: "preserved-current" });
        } else {
          const plan = require("../../routing-engine/src/route").routeTask(root, scope.task);
          const executionOptions = scope.id === resumeScope?.id ? { resumeSessionId: options.resumeSessionId } : {};
          const result = await execute(scope, plan, executionOptions);
          const published = currentFeature(root, scope);
          if (!published || !result?.specification) {
            throw new Error(`Scope ${scope.id} did not publish source-bound functional specifications; model commentary is not completion.`);
          }
          Object.assign(entry, published, { status: "authored", session_id: result.sessionId || null });
        }
      } catch (error) {
        Object.assign(entry, { status: signal.aborted ? "cancelled" : "failed", error: error.message,
          session_id: error.sessionId || null, authoring_evidence: error.authoringEvidence || null });
      }
      entry.completed_at = new Date().toISOString();
      save();
      progress(entry, entry.status);
      signal.throwIfAborted();
    };
    const runGroup = async group => {
      let next = 0;
      const worker = async () => {
        try {
          while (next < group.length) {
            signal.throwIfAborted();
            await processScope(group[next++]);
          }
        } catch (error) {
          shutdown.abort(error);
          throw error;
        }
      };
      const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, group.length) }, worker));
      const failure = results.find(result => result.status === "rejected");
      if (failure) throw failure.reason;
    };
    await runGroup(pending.filter(scope => !lastDomains.includes(scope.domain)));
    await runGroup(pending.filter(scope => lastDomains.includes(scope.domain)));
    if (heartbeatError) throw heartbeatError;
    const reconciliation = require("./reconciliation").buildSpecificationReconciliation(root);
    record.reconciliation = { path: reconciliation.path, status: reconciliation.status, summary: reconciliation.summary };
    const incomplete = planning.blocked.length || record.summary.failed ||
      reconciliation.scope_matrix.some(scope => scope.status !== "source-bound-structurally-validated");
    record.status = incomplete ? "partial" : "completed";
    if (incomplete) record.reason = `${record.summary.failed} scope(s) failed; ${planning.blocked.length} source(s) blocked. Independent scopes were processed; inspect recorded errors and reconciliation before retrying.`;
    record.phases.push({ phase: "functional-proposals", status: record.status });
    refreshWorkspaceIndex(root);
  } catch (error) {
    record.status = "failed";
    record.reason = error.message;
    const active = record.scopes.findLast(scope => scope.status === "running");
    if (active) Object.assign(active, { status: "failed", error: error.message });
    throw new Error(`Brownfield incomplete: ${error.message} Report: ${reportPath}`, { cause: error });
  } finally {
    clearInterval(heartbeat);
    record.completed_at = new Date().toISOString();
    try { save(); } finally { release(); }
  }
  return { ...record, report: reportPath, exitCode: record.status === "completed" ? 0 : 1 };
}

module.exports = { authorBrownfield, isBrownfieldRequest, brownfieldConcurrency };
