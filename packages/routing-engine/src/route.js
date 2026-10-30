"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { searchMemory } = require("../../memory-engine/src/memory");
const { searchKnowledge } = require("../../source-engine/src/sync");
const { discoverTools } = require("../../tool-manager/src/tools");
const { readCodeGraphState, searchCodeGraph } = require("../../knowledge-engine/src/codegraph");
const { analyzeImpacts, searchUnifiedGraph, GRAPH_PATH } = require("../../knowledge-engine/src/unified");
const { readGraphifyState, searchGraphify } = require("../../knowledge-engine/src/graphify");
const { recordEvent, observeLayer } = require("../../core/src/telemetry");
const { readInstalledCatalog, sourceBody } = require("../../copilot-renderer/src/render");
const { listBrownfieldSpecs, isScaffolding } = require("../../spec-engine/src/brownfield");
const { isSpecificationTask } = require("../../spec-engine/src/functional");
const { listFeatures } = require("../../spec-engine/src/lifecycle");

const RULES_PATH = path.resolve(__dirname, "../../../catalog/routing/routing-rules.json");
const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
const EXECUTION_STAGES = [
  "understand",
  "analyze",
  "plan",
  "execute",
  "validate",
  "document",
  "observe",
  "learn",
];

function normalize(text) {
  return text.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function validateTask(task) {
  if (typeof task !== "string" || task.trim().length < 3 || task.length > 10_000) {
    throw new Error("Routing task must be between 3 and 10000 characters");
  }
  return normalize(task.trim());
}

function scoreKeywords(text, keywords) {
  let score = 0;
  const matches = [];
  for (const keyword of keywords) {
    const normalized = normalize(keyword);
    const keywordMatches = /^[a-z]{1,2}$/.test(normalized)
      ? new RegExp(`(^|[^a-z0-9_])${normalized}(?=$|[^a-z0-9_])`).test(text)
      : text.includes(normalized);
    if (keywordMatches) {
      score += normalized.includes(" ") ? 3 : 1;
      matches.push(keyword);
    }
  }
  return { score, matches };
}

function selectTaskKnowledge(projectRoot, task, limit) {
  const index = JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcpee/indexes/knowledge-index.json"), "utf8"));
  const text = task.replace(/\\/g, "/");
  const explicit = index.documents.filter(document => {
    const escaped = document.source_path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[\\s\`"'([{])(?:\\./)?${escaped}(?=$|[\\s\`"'\\])},;:!?])`,
      process.platform === "win32" ? "i" : "").test(text);
  }).map(document => ({ ...document, selection: "explicit-task-path" }));
  if (isSpecificationTask(task)) {
    const manifestPath = path.join(projectRoot, "knowledge/traceability/source-manifest.json");
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
    if (!manifest || manifest.generated_by !== "mcpee" || !Array.isArray(manifest.sources)) {
      throw new Error("Specification authoring requires a current source inventory. Run mcpee sync before requesting the greenfield specification.");
    }
    const namedSources = manifest.sources.filter((source) => {
      const escaped = source.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[\\s\`"'([{])(?:\\./)?${escaped}(?=$|[\\s\`"'\\])},;:!?])`,
        process.platform === "win32" ? "i" : "").test(text);
    });
    const candidates = namedSources.length ? namedSources : manifest.sources.filter((source) =>
      ["business", "architecture", "documentation", "api-contracts", "decisions", "office-documents"].includes(source.category) &&
      !source.path.startsWith("docs/specifications/") &&
      !source.path.startsWith("specs/approved/") &&
      !isScaffolding(projectRoot, source.path));
    const unavailable = candidates.filter((source) => !["processed", "unchanged"].includes(source.status) ||
      !index.documents.some((document) => document.source_path === source.path));
    if (unavailable.length) {
      throw new Error(`Specification authoring blocked: product documents are not ready: ${unavailable.map((source) => `${source.path} (${source.status})`).join(", ")}. Resolve processing/conversion and synchronize; no paid authoring attempt was started.`);
    }
    const selected = namedSources.length ? index.documents
      .filter((document) => namedSources.some((source) => source.path === document.source_path))
      .map((document) => ({ ...document, selection: "explicit-task-path" }))
      : index.documents.filter((document) =>
      candidates.some((source) => source.path === document.source_path) &&
      !document.source_path.startsWith("docs/specifications/") &&
      !document.source_path.startsWith("specs/approved/") &&
      !isScaffolding(projectRoot, document.source_path))
      .map((document) => ({ ...document, selection: "product-documentation" }));
    if (selected.length > 100) {
      throw new Error("Specification authoring found more than 100 product documents. Name the source paths for one product scope; no documents were silently discarded.");
    }
    return selected;
  }
  if (explicit.length > 10) throw new Error("Task names more than 10 indexed source files; narrow the task before impact analysis.");
  const matches = searchKnowledge(projectRoot, task, limit);
  return [...explicit, ...matches.filter(match => !explicit.some(item => item.source_path === match.source_path))]
    .slice(0, Math.max(limit, explicit.length));
}

function routeTask(projectRoot, task, options = {}) {
  const normalizedTask = validateTask(task);
  const limit = options.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Route context limit must be between 1 and 20");
  const catalog = observeLayer(projectRoot, "catalog", () => readInstalledCatalog(projectRoot),
    result => ({ consulted: true, agent_count: result.agents.length, skill_count: result.skills.length, workflow_count: result.workflows.length }));
  const workflowScores = rules.routes.map((route, index) => ({
    ...route,
    ...scoreKeywords(normalizedTask, route.keywords),
    order: index,
  })).filter((route) => catalog.workflows.some((workflow) => workflow.id === route.workflow))
    .sort((left, right) => right.score - left.score || left.order - right.order);
  let selected = workflowScores[0]?.score > 0
    ? workflowScores[0]
    : workflowScores.find((route) => route.workflow === rules.fallback_workflow) || workflowScores[0];
  if (!selected) throw new Error("No installed MCPEE workflows are available; install a workflow with 'mcpee capabilities install <id>'.");
  const specificationTask = isSpecificationTask(task);
  if (specificationTask) {
    const specificationRoute = workflowScores.find((route) => route.workflow === "refine-backlog") ||
      workflowScores.find((route) => route.workflow === "understand-project");
    if (!specificationRoute) throw new Error("Specification authoring requires the refine-backlog or understand-project workflow.");
    selected = { ...specificationRoute, score: 1, matches: ["functional-specification-authoring"] };
  }
  const specialistScores = rules.specialists.map((specialist, index) => ({
    ...specialist,
    ...scoreKeywords(normalizedTask, specialist.keywords),
    order: index,
  })).filter((specialist) => catalog.agents.some((agent) => agent.id === specialist.agent))
    .sort((left, right) => right.score - left.score || left.order - right.order);
  const detectedTechnologyIds = new Set(
    (catalog.project_stack?.detected_technologies || []).map(({ id }) => id),
  );
  const projectAgentId = detectedTechnologyIds.has("angular") ||
    detectedTechnologyIds.has("react") || detectedTechnologyIds.has("vue")
    ? "frontend"
    : catalog.project_stack?.has_code_signals ? "backend" : null;
  const preferredProjectAgent = selected.workflow === "deliver-feature" &&
    catalog.agents.some((agent) => agent.id === projectAgentId)
    ? projectAgentId
    : null;
  const agentId = specificationTask && catalog.agents.some((agent) => agent.id === "product") ? "product"
    : specificationTask ? "orchestrator"
    : specialistScores[0]?.score > 0
    ? specialistScores[0].agent
    : preferredProjectAgent ||
      (catalog.agents.some((agent) => agent.id === selected.agent)
        ? selected.agent
        : catalog.agents[0]?.id);
  const agent = catalog.agents.find((item) => item.id === agentId);
  const workflow = catalog.workflows.find((item) => item.id === selected.workflow);
  if (!agent || !workflow) throw new Error(`Catalog is missing route target '${agentId}' or '${selected.workflow}'`);
  const supportingGuidance = (agent.supporting_source_paths ?? []).map((sourcePath) => ({
    source_path: sourcePath,
    guidance: sourceBody(sourcePath, `agents/${agent.id}`),
  }));
  const skillIds = [...new Set([...selected.skills, ...agent.skills,
    ...(specificationTask ? ["requirements-discovery"] : [])])];
  const skills = skillIds.map((id) => {
    const skill = catalog.skills.find((item) => item.id === id);
    if (!skill) throw new Error(`Catalog is missing routed skill '${id}'`);
    return {
      id: skill.id,
      description: skill.description,
      guidance: skill.source_path ? sourceBody(skill.source_path, `skills/${skill.id}`) : null,
    };
  });
  const normalizedTaskTerms = new Set(normalizedTask.split(/[^a-z0-9+#.]+/).filter(Boolean));
  const matchesTechnology = (keywords = []) => keywords.some((keyword) => {
    const normalizedKeyword = normalize(keyword);
    return normalizedTask.includes(normalizedKeyword) || normalizedTaskTerms.has(normalizedKeyword);
  });
  const contextualPatternIds = catalog.patterns
    .filter((pattern) => matchesTechnology(pattern.technology_keywords ?? []))
    .map((pattern) => pattern.id);
  const patternIds = [...new Set([
    ...(workflow.patterns || []),
    ...(agent.patterns || []),
    ...contextualPatternIds,
  ])];
  const patterns = patternIds.map((id) => {
    const pattern = catalog.patterns.find((item) => item.id === id);
    if (!pattern) throw new Error(`Catalog is missing workflow pattern '${id}'`);
    return {
      id: pattern.id,
      description: pattern.description,
      guidance: pattern.source_path ? sourceBody(pattern.source_path, `patterns/${pattern.id}`) : null,
    };
  });
  const playbooks = catalog.playbooks
    .filter((item) => matchesTechnology(item.technology_keywords))
    .map((item) => ({
      id: item.id,
      description: item.description,
      path: item.path,
      workflows: item.workflows,
      guidance: sourceBody(item.path, `playbooks/${item.id}`),
    }));
  const scorecards = catalog.scorecards
    .filter((item) => item.id === "engineering-response-quality" ||
      matchesTechnology(item.technology_keywords))
    .map(({ id, description, criteria }) => ({ id, description, criteria }));
  const evalCases = catalog.eval_cases
    .filter((item) => item.id === "evidence-grounding" ||
      matchesTechnology(item.technology_keywords))
    .map(({ id, description, scorecard, asset_ids, expected_behaviors, forbidden_behaviors }) => ({
      id,
      description,
      scorecard,
      ...(asset_ids ? { asset_ids } : {}),
      expected_behaviors,
      forbidden_behaviors,
    }));
  const promptExamples = catalog.prompt_examples
    .filter((item) => matchesTechnology(item.technology_keywords))
    .map((item) => ({
      id: item.id,
      description: item.description,
      source_path: item.path,
      example: sourceBody(item.path, `prompt_examples/${item.id}`),
    }));
  const memories = observeLayer(projectRoot, "memory", () => {
    const matches = searchMemory(projectRoot, task, limit);
    const current = matches.filter(entry => entry.evidence_status.some(evidence => evidence.status === "current"));
    return { matches, current };
  }, result => ({
    consulted: true, retrieval: "local-memory-search", candidate_count: result.matches.length,
    selected_count: result.current.length, excluded_stale_count: result.matches.length - result.current.length,
    selected_ids: result.current.map(entry => entry.id),
  })).current;
  let knowledge = [];
  const knowledgeIndex = path.join(projectRoot, ".mcpee/indexes/knowledge-index.json");
  if (fs.existsSync(knowledgeIndex)) {
    knowledge = observeLayer(projectRoot, "knowledge.lexical", () => selectTaskKnowledge(projectRoot, task, limit),
      result => ({ consulted: true, retrieval: "lexical", selected_count: result.length,
        explicit_source_count: result.filter(item => item.selection === "explicit-task-path").length,
        selected_sources: result.map(item => item.source_path) })).map((result) => ({
      source_path: result.source_path,
      normalized_path: result.normalized_path,
      sha256: result.sha256,
      score: result.score,
      ...(result.selection ? { selection: result.selection } : {}),
    }));
  } else {
    recordEvent(projectRoot, { event_name: "context.layer.completed",
      attributes: { layer: "knowledge.lexical", consulted: false, outcome: "unavailable", reason: "Local knowledge index is missing." } });
  }
  const explicitSources = knowledge.filter(item => item.selection === "explicit-task-path");
  const matchingGuidance = catalog.technical_guidance.filter(item =>
    item.technology_keywords.some(keyword => {
      const escaped = normalize(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const prefix = keyword.startsWith(".") ? "" : "(^|[^a-z0-9_])";
      return new RegExp(`${prefix}${escaped}(?=$|[^a-z0-9_])`).test(normalizedTask);
    }) || explicitSources.some(source =>
      item.apply_to.some(glob => path.posix.matchesGlob(source.source_path.replace(/\\/g, "/"), glob))));
  const detectedGuidance = new Set(catalog.project_stack?.assets?.technical_guidance || []);
  const technicalGuidance = (matchingGuidance.length ? matchingGuidance
    : catalog.technical_guidance.filter((item) => detectedGuidance.has(item.id)))
    .map(item => ({
      id: item.id,
      description: item.description,
      technologies: item.technologies,
      apply_to: item.apply_to,
      source_path: item.source_path,
      guidance: sourceBody(item.source_path, `technical_guidance/${item.id}`),
    }));
  const unifiedGraphPath = path.join(projectRoot, GRAPH_PATH);
  const unifiedGraphStatus = fs.existsSync(unifiedGraphPath) ? "ready" : "not-synchronized";
  const unifiedMatches = fs.existsSync(unifiedGraphPath)
    ? observeLayer(projectRoot, "graph.unified", () => searchUnifiedGraph(projectRoot, task, limit),
      result => ({ consulted: true, selected_count: result.length })).map((match) => ({ ...match, graph: "unified" }))
    : [];
  const codeGraphState = readCodeGraphState(projectRoot);
  const documentOnlyGreenfield = specificationTask && !catalog.project_stack?.has_code_signals;
  if (codeGraphState?.status !== "ready" && !documentOnlyGreenfield) {
    recordEvent(projectRoot, { event_name: "context.layer.completed",
      attributes: { layer: "graph.codegraph", consulted: false, outcome: "failure", reason: "Required local CodeGraph index is not ready." } });
    throw new Error("CodeGraph is required for routing but its local index is not ready; run mcpee init or mcpee sync.");
  }
  const codeGraphMatches = !documentOnlyGreenfield
    ? observeLayer(projectRoot, "graph.codegraph", () => searchCodeGraph(projectRoot, task, limit),
      result => ({ consulted: true, selected_count: result.length })) : [];
  if (documentOnlyGreenfield) recordEvent(projectRoot, { event_name: "context.layer.completed",
    attributes: { layer: "graph.codegraph", consulted: false, outcome: "not-applicable", reason: "Documentation-only specification authoring has no application code to search." } });
  const graphifyState = readGraphifyState(projectRoot);
  const graphifyMatches = graphifyState?.status === "ready"
    ? observeLayer(projectRoot, "graph.graphify", () => searchGraphify(projectRoot, task, limit),
      result => ({ consulted: true, selected_count: result.length }))
    : [];
  for (const [layer, ready] of [
    ["graph.unified", unifiedGraphStatus === "ready"],
    ["graph.graphify", graphifyState?.status === "ready"],
  ]) {
    if (!ready) recordEvent(projectRoot, { event_name: "context.layer.completed",
      attributes: { layer, consulted: false, outcome: "unavailable", reason: "Local graph is not ready." } });
  }
  const knowledgeGraph = [
    ...unifiedMatches,
    ...codeGraphMatches.map((match) => ({ ...match, graph: "codegraph" })),
    ...graphifyMatches.map((match) => ({ ...match, graph: "graphify" })),
  ]
    .sort((left, right) => (right.score || 0) - (left.score || 0) ||
      left.source_path.localeCompare(right.source_path) || left.symbol.localeCompare(right.symbol))
    .slice(0, limit);
  const impactPaths = [...new Set([
    ...knowledge.map((source) => source.source_path),
    ...knowledgeGraph.filter((source) => source.graph === "unified").map((source) => source.source_path),
  ])].slice(0, 10);
  const impactPreflight = analyzeImpacts(projectRoot, impactPaths);
  const availableTools = discoverTools(projectRoot).tools
    .filter((tool) => tool.invokable)
    .map((tool) => tool.id);
  const features = listFeatures(projectRoot);
  const namedFeatures = features.filter((feature) => new RegExp(`(^|[^a-z0-9-])${feature.id}(?=$|[^a-z0-9-])`, "i").test(task));
  const activeFeatures = namedFeatures.length ? namedFeatures : features.length === 1 ? features : [];
  const actionable = normalize(task).replace(/\b(?:do not implement|don't implement|sin implementar|no implementar|no implementes)\b/g, "");
  const requestedStage = specificationTask ? "specification"
    : /\b(?:tasks|tareas)\b/.test(actionable) && /\b(?:create|generate|write|genera\w*|crea\w*|prepara\w*)\b/.test(actionable) ? "tasks"
    : /\b(?:plan|planifica\w*)\b/.test(actionable) && /\b(?:create|generate|write|genera\w*|crea\w*|prepara\w*|planifica\w*)\b/.test(actionable) ? "plan"
    : /\b(?:implement|implementa|implementar|implementad|implementes|programa|programar)\b|\bbuild\s+(?:a|an|the|this)\b/.test(actionable) ? "implementation"
    : "review";
  const plan = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    task_sha256: crypto.createHash("sha256").update(task).digest("hex"),
    strategy: "deterministic-local-keyword-routing",
    workflow: {
      id: workflow.id,
      description: workflow.description,
      guidance: workflow.source_path ? sourceBody(workflow.source_path, `workflows/${workflow.id}`) : null,
      matched_keywords: selected.matches || [],
      execution_stages: EXECUTION_STAGES,
    },
    project_stack: catalog.project_stack,
    specification_workspace: { path: "specs/README.md", requested_stage: requestedStage,
      features: activeFeatures, requires_feature_selection: features.length > 1 && !namedFeatures.length },
    ...(specificationTask ? { functional_specification: {
      mode: /\bgreenfield\b/i.test(task) ? "greenfield"
        : /\bbrownfield\b/i.test(task) ? "brownfield"
        : catalog.project_stack?.has_code_signals ? "brownfield" : "greenfield",
      status: "authoring-required; static discovery is not the deliverable",
    } } : {}),
    agent: {
      id: agent.id,
      description: agent.description,
      guidance: agent.source_path ? sourceBody(agent.source_path, `agents/${agent.id}`) : null,
      supporting_guidance: supportingGuidance,
      focus: agent.focus,
      skills: agent.skills,
      preferred_knowledge: agent.preferred_knowledge,
      tools: agent.tools,
      tool_capabilities: agent.tool_capabilities ?? [],
      collaborates_with: agent.collaborates_with,
      evidence: agent.evidence,
    },
    agent_tools: agent.tools.map((id) => ({ id, available: availableTools.includes(id) })),
    skills,
    patterns,
    playbooks,
    technical_guidance: technicalGuidance,
    scorecards,
    eval_cases: evalCases,
    prompt_examples: promptExamples,
    policies: catalog.policies.map((policy) => policy.id),
    policy_controls: catalog.policies.map(({ id, description, enforcement, evidence }) =>
      ({ id, description, enforcement, evidence })),
    memory: memories.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      evaluation_id: entry.evaluation_id || null,
      evidence: entry.evidence_status.filter((item) => item.status === "current"),
      score: entry.score,
    })),
    knowledge,
    knowledge_graph: knowledgeGraph,
    approved_specs: listBrownfieldSpecs(projectRoot)
      .filter((spec) => spec.status === "approved")
      .map(({ slug, path: specPath, sha256, bundle_sha256 }) => ({ slug, path: specPath, sha256,
        ...(bundle_sha256 ? { bundle_sha256 } : {}) })),
    knowledge_graph_status: {
      unified: unifiedGraphStatus,
      codegraph: documentOnlyGreenfield ? "not-applicable-documentation-only" : codeGraphState.status,
      graphify: graphifyState?.status || "not-synchronized",
    },
    impact_preflight: impactPreflight,
    local_tools: availableTools,
    fallback: selected.score ? null : "No route keyword matched; selected understand-project.",
    execution: "plan-only; no agent or tool was invoked",
  };
  recordEvent(projectRoot, {
    event_name: "routing.plan.created",
    attributes: {
      workflow: workflow.id,
      agent: agent.id,
      task_sha256: plan.task_sha256,
      memory_candidates: memories.length,
      knowledge_candidates: knowledge.length,
      knowledge_graph_candidates: knowledgeGraph.length,
      unified_graph_candidates: unifiedMatches.length,
      codegraph_candidates: codeGraphMatches.length,
      graphify_candidates: graphifyMatches.length,
      impact_targets: impactPreflight.targets.length,
      impact_preflight_status: impactPreflight.status,
      available_tools: availableTools.length,
      fallback: Boolean(plan.fallback),
    },
    payload: {
      task,
      selected: {
        workflow_id: workflow.id,
        agent_id: agent.id,
        skill_ids: skills.map((item) => item.id),
        pattern_ids: patterns.map((item) => item.id),
        knowledge_sources: knowledge.map((item) => item.source_path).filter(Boolean),
        knowledge_graph_sources: knowledgeGraph.map((item) => item.source_path).filter(Boolean),
        memory_ids: memories.map((item) => item.id).filter(Boolean),
        tools: availableTools,
      },
    },
  });
  return plan;
}

module.exports = { routeTask, validateTask, scoreKeywords };
