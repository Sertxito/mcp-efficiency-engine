"use strict";

const fs = require("node:fs");
const path = require("node:path");

const IGNORED_DIRECTORIES = new Set([
  ".angular", ".cache", ".git", ".mcpee", ".next", ".nuxt", ".nx", ".parcel-cache",
  ".pnpm-store", ".pytest_cache", ".turbo", ".venv", ".yarn", "__pycache__", "bin",
  "build", "coverage", "dist", "node_modules", "obj", "out", "target", "vendor", "venv",
]);
const MAX_DIRECTORIES = 5000;
const BACKEND_FRAMEWORKS = new Set([
  "@nestjs/core", "express", "fastify", "koa", "hapi", "@hapi/hapi", "hono",
  "restify",
]);
const COSMOS_PACKAGES = new Set([
  "@azure/cosmos", "microsoft.azure.cosmos", "azure-cosmos",
]);
const SUPPORTED_TECHNOLOGIES = [
  "angular", "aws", "azure", "bicep", "cosmos-db", "dotnet", "node", "python",
  "react", "sql", "terraform", "vue", "yaml-pipelines",
];

function walkProjectFiles(projectRoot) {
  const root = path.resolve(projectRoot);
  if (!fs.existsSync(root)) return { files: [], limitReached: false };
  const pending = [""];
  const files = [];
  let visited = 0;
  while (pending.length && visited < MAX_DIRECTORIES) {
    const relativeDirectory = pending.pop();
    visited += 1;
    const absoluteDirectory = path.join(root, relativeDirectory);
    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) pending.push(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  return {
    files: files.sort((left, right) => left.localeCompare(right)),
    limitReached: pending.length > 0,
  };
}

function readPackageDependencies(projectRoot, files) {
  const byFile = new Map();
  const manifestsByFile = new Map();
  const packageFiles = files.filter((file) => path.posix.basename(file) === "package.json");
  for (const packageFile of packageFiles) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, packageFile), "utf8"));
    } catch (error) {
      throw new Error(`Cannot detect project capabilities from ${packageFile}: ${error.message}`);
    }
    const localDependencies = new Set();
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const dependency of Object.keys(manifest[section] || {})) {
        const name = dependency.toLowerCase();
        localDependencies.add(name);
      }
    }
    byFile.set(packageFile, localDependencies);
    manifestsByFile.set(packageFile, manifest);
  }
  return { byFile, manifestsByFile, packageFiles };
}

function detectProjectCapabilities(projectRoot, catalog) {
  const root = path.resolve(projectRoot);
  const scan = walkProjectFiles(root);
  const { files } = scan;
  const {
    byFile: packageDependencies,
    manifestsByFile: packageManifests,
    packageFiles,
  } = readPackageDependencies(root, files);
  const technologies = new Map();
  const add = (technology, evidence) => {
    const sources = technologies.get(technology) || new Set();
    sources.add(evidence);
    technologies.set(technology, sources);
  };
  const matchingFiles = (pattern) => files.filter((file) => pattern.test(file));
  const codeEvidenceFiles = matchingFiles(/\.(?:[cm]?[jt]sx?|vue|pyi?|cs|fs|vb|go|rs|java|kt|swift|rb|php|c|cc|cpp|h|hh|hpp|scala|sh)$/i);

  const dotnetFiles = matchingFiles(/\.(?:csproj|fsproj|vbproj|sln|slnx)$/i);
  for (const file of dotnetFiles) {
    const contents = fs.readFileSync(path.join(root, file), "utf8");
    add("dotnet", file);
    if (/microsoft\.azure\.cosmos/i.test(contents)) {
      add("cosmos-db", file);
    }
    if (/<PackageReference\b[^>]*\bInclude=["'](?:Microsoft\.)?Azure\./i.test(contents)) add("azure", file);
  }
  for (const file of matchingFiles(/(?:^|\/)(?:pyproject\.toml|setup\.py|setup\.cfg|pipfile|requirements(?:[-_.][^/]*)?\.txt)$/i)
    .concat(matchingFiles(/\.pyi?$/i))) {
    add("python", file);
  }
  for (const file of matchingFiles(/(?:^|\/)angular\.json$/i)) add("angular", file);
  for (const file of packageFiles) {
    const localDependencies = packageDependencies.get(file);
    if (typeof packageManifests.get(file)?.engines?.node === "string") add("node", file);
    if (localDependencies.has("@angular/core")) add("angular", file);
    if (localDependencies.has("react") || localDependencies.has("react-dom")) add("react", file);
    if (localDependencies.has("vue") || localDependencies.has("nuxt")) add("vue", file);
    if ([...BACKEND_FRAMEWORKS].some((dependency) => localDependencies.has(dependency))) add("node", file);
    if ([...localDependencies].some((dependency) => dependency.startsWith("@azure/"))) add("azure", file);
    if (localDependencies.has("aws-cdk-lib") || localDependencies.has("aws-cdk")) add("aws", file);
  }
  for (const file of matchingFiles(/\.vue$/i)) add("vue", file);
  for (const file of matchingFiles(/\.(?:bicep|bicepparam)$/i)
    .concat(files.filter((file) => /(?:^|\/)(?:azure\.ya?ml|azure-pipelines[^/]*\.ya?ml|host\.json)$/i.test(file)))) {
    add("azure", file);
  }
  for (const file of matchingFiles(/\.(?:bicep|bicepparam)$/i)) add("bicep", file);
  for (const file of files.filter((candidate) =>
    /(?:^|\/)(?:cdk\.json|serverless\.ya?ml|samconfig\.toml|cloudformation\.(?:ya?ml|json))$/i.test(candidate))) {
    add("aws", file);
  }
  for (const file of files.filter((candidate) =>
    /(?:^|\/)template\.(?:ya?ml|json)$/i.test(candidate))) {
    if (/AWS::|AWSTemplateFormatVersion|Transform:\s*AWS::/i.test(
      fs.readFileSync(path.join(root, file), "utf8"),
    )) add("aws", file);
  }
  for (const file of matchingFiles(/\.tf(?:vars|\.json)?$/i)) add("terraform", file);
  for (const file of matchingFiles(/\.(?:sql|sqlproj)$/i)) add("sql", file);
  for (const file of packageFiles) {
    if ([...COSMOS_PACKAGES].some((dependency) => packageDependencies.get(file).has(dependency))) add("cosmos-db", file);
  }
  for (const file of files.filter((candidate) =>
    /(?:^|\/)(?:\.github\/workflows\/[^/]+|azure-pipelines[^/]*)\.ya?ml$/i.test(candidate))) {
    add("yaml-pipelines", file);
  }
  for (const file of files.filter((candidate) =>
    /(?:^|\/)(?:requirements(?:[-_.][^/]*)?\.txt|pyproject\.toml)$/i.test(candidate))) {
    const contents = fs.readFileSync(path.join(root, file), "utf8");
    if (/^\s*azure-cosmos(?:\s|[<=>~!;]|$)/im.test(contents)) add("cosmos-db", file);
  }
  for (const file of files.filter((candidate) =>
    /(?:^|\/)(?:requirements(?:[-_.][^/]*)?\.txt|pyproject\.toml)$/i.test(candidate))) {
    const contents = fs.readFileSync(path.join(root, file), "utf8");
    if (/^\s*azure-[a-z0-9-]+(?:\s|[<=>~!;]|$)/im.test(contents)) add("azure", file);
  }

  const detected = [...technologies.keys()].sort();
  const hasBackend = detected.some((technology) => ["dotnet", "python", "node"].includes(technology));
  const hasFrontend = detected.some((technology) => ["angular", "react", "vue"].includes(technology));
  const hasDatabase = detected.some((technology) => ["sql", "cosmos-db"].includes(technology));
  const hasInfrastructure = detected.some((technology) =>
    ["azure", "aws", "terraform", "yaml-pipelines"].includes(technology));
  const agentIds = new Set([
    "orchestrator", "product", "architecture", "qa", "security", "ai", "documentation",
  ]);
  if (hasBackend) agentIds.add("backend");
  if (hasFrontend) {
    agentIds.add("frontend");
    agentIds.add("ux-ui");
  }
  if (hasDatabase) {
    agentIds.add("database");
    agentIds.add("data");
  }
  if (hasInfrastructure) {
    agentIds.add("infrastructure");
    agentIds.add("devops");
    agentIds.add("observability");
  }
  const agents = catalog.agents.filter((agent) => agentIds.has(agent.id));
  const skills = [...new Set(agents.flatMap((agent) => agent.skills))].sort();
  const workflows = catalog.workflows.filter((workflow) => agentIds.has(workflow.agent));

  const keywordAliases = {
    dotnet: ["c#", "csharp", ".net", "dotnet"],
    python: ["python"],
    node: ["node", "node.js", "express", "fastify", "nestjs"],
    angular: ["angular"],
    react: ["react"],
    vue: ["vue", "nuxt"],
    azure: ["azure", "bicep", "azure pipelines"],
    bicep: ["bicep"],
    aws: ["aws", "cloudformation", "aws cdk"],
    terraform: ["terraform"],
    sql: ["sql", "sql server", "database"],
    "cosmos-db": ["cosmos db", "nosql", "database"],
    "yaml-pipelines": ["yaml", "github actions", "azure pipelines"],
  };
  const aliases = detected.flatMap((technology) => keywordAliases[technology] || []);
  const matchesKeywords = (keywords = []) => keywords.some((keyword) =>
    aliases.some((alias) => keyword.toLowerCase().includes(alias) || alias.includes(keyword.toLowerCase())));
  const agentPatternIds = new Set(agents.flatMap((agent) => agent.patterns || []));
  const workflowPatternIds = new Set(workflows.flatMap((workflow) => workflow.patterns || []));
  const patterns = catalog.patterns.filter((pattern) =>
    agentPatternIds.has(pattern.id) || workflowPatternIds.has(pattern.id) ||
    matchesKeywords(pattern.technology_keywords || []));
  const guidance = catalog.technical_guidance.filter((item) =>
    item.technologies.some((technology) => detected.includes(technology)));
  const scorecards = catalog.scorecards.filter((item) =>
    (item.technology_keywords || []).length === 0 || matchesKeywords(item.technology_keywords || []));
  const evalCases = catalog.eval_cases.filter((item) =>
    (item.technology_keywords || []).length === 0 || matchesKeywords(item.technology_keywords || []));
  const promptExamples = catalog.prompt_examples.filter((item) =>
    matchesKeywords(item.technology_keywords || []));
  const playbooks = catalog.playbooks.filter((item) => matchesKeywords(item.technology_keywords));

  return {
    schema_version: 1,
    generated_by: "mcpee",
    has_code_signals: codeEvidenceFiles.length > 0 || packageFiles.length > 0,
    code_evidence_files: [...new Set([...codeEvidenceFiles, ...packageFiles])]
      .sort((left, right) => left.localeCompare(right)),
    status: detected.length
      ? (scan.limitReached ? "detected-partial-scan" : "detected")
      : (scan.limitReached ? "no-stack-signals-partial-scan" : "no-stack-signals-detected"),
    scan: { directory_limit: MAX_DIRECTORIES, limit_reached: scan.limitReached },
    detected_technologies: detected.map((technology) => ({
      id: technology,
      evidence: [...technologies.get(technology)].sort(),
    })),
    assets: {
      agents: agents.map((agent) => agent.id),
      skills,
      workflows: workflows.map((workflow) => workflow.id),
      patterns: patterns.map((pattern) => pattern.id),
      playbooks: playbooks.map((playbook) => playbook.id),
      technical_guidance: guidance.map((item) => item.id),
      scorecards: scorecards.map((item) => item.id),
      eval_cases: evalCases.map((item) => item.id),
      prompt_examples: promptExamples.map((item) => item.id),
      templates: catalog.templates.map((template) => template.id),
    },
    evidence_files: [...new Set([...technologies.values()].flatMap((sources) => [...sources]))]
      .sort((left, right) => left.localeCompare(right)),
  };
}

module.exports = { detectProjectCapabilities, SUPPORTED_TECHNOLOGIES };
