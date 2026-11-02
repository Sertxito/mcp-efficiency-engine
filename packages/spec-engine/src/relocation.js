"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { projectPath, ensureDirectory } = require("./brownfield");
const { SPEC_ROOT, STATES } = require("./storage");

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function removeEmptyDirectories(root, relative) {
  const filename = projectPath(root, relative);
  if (!fs.existsSync(filename)) return;
  for (const entry of fs.readdirSync(filename, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(root, `${relative}/${entry.name}`);
  }
  if (!fs.readdirSync(filename).length) fs.rmdirSync(filename);
}

function rebaseMarkdown(root, content, from, to, relocate) {
  return content.replace(/(\]\()([^)\s]+)(\))/g, (match, start, link, end) => {
    if (/^(?:[a-z]+:|#|\/)/i.test(link)) return match;
    const [reference, fragment] = link.split("#", 2);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURIComponent(reference)));
    projectPath(root, resolved);
    const rebased = path.posix.relative(path.posix.dirname(to), relocate(resolved));
    return `${start}${rebased.split("/").map(encodeURIComponent).join("/")}${fragment ? `#${fragment}` : ""}${end}`;
  });
}

function relocateDocuments(root, from, to, { destinations = [], rewriteJson = false } = {}) {
  const originals = new Map();
  const collect = relative => {
    for (const entry of fs.readdirSync(projectPath(root, relative), { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`;
      const filename = projectPath(root, file);
      if (entry.isDirectory()) collect(file);
      else if (entry.isFile()) originals.set(file, fs.readFileSync(filename));
      else throw new Error(`Unsupported artifact in documentation migration: ${file}`);
    }
  };
  collect(from);
  const relocate = file => {
    const mapping = [[from, to], ...destinations].find(([source]) => file === source || file.startsWith(`${source}/`));
    return mapping ? `${mapping[1]}${file.slice(mapping[0].length)}` : file;
  };
  const rewritePaths = value => {
    if (typeof value === "string") return relocate(value);
    if (Array.isArray(value)) return value.map(rewritePaths);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewritePaths(item)]));
    return value;
  };
  const outputs = new Map([...originals].map(([file, bytes]) => {
    const target = relocate(file);
    const markdownRelocate = reference => ["specs/README.md", "specs/MCPEE.md"].includes(reference)
      ? require("./lifecycle").navigationTarget(root) : relocate(reference);
    const content = file.endsWith(".md") ? Buffer.from(rebaseMarkdown(root, bytes.toString("utf8"), file, target, markdownRelocate))
      : rewriteJson && file.endsWith(".json") ? Buffer.from(json(rewritePaths(JSON.parse(bytes.toString("utf8"))))) : bytes;
    return [target, content];
  }));
  for (const [file, bytes] of outputs) {
    const filename = projectPath(root, file);
    if (fs.existsSync(filename) && !fs.readFileSync(filename).equals(bytes)) {
      throw new Error(`Documentation migration conflicts with existing content: ${file}`);
    }
  }
  const reportPath = `.mcpee/reports/specification-moves/${crypto.randomUUID()}.json`;
  const created = [];
  try {
    for (const [file, bytes] of outputs) {
      if (fs.existsSync(projectPath(root, file))) continue;
      ensureDirectory(root, path.posix.dirname(file));
      fs.writeFileSync(projectPath(root, file), bytes, { flag: "wx" });
      created.push(file);
    }
    ensureDirectory(root, path.posix.dirname(reportPath));
    fs.writeFileSync(projectPath(root, reportPath), json({
      generated_by: "mcpee", kind: "documentation-migration", from, to, authority_granted: false,
      moved_at: new Date().toISOString(),
      files: [...originals].map(([file, bytes]) => ({
        from: file, to: relocate(file), previous_sha256: hash(bytes), sha256: hash(outputs.get(relocate(file))),
      })),
    }), { flag: "wx" });
    created.push(reportPath);
    for (const [file, bytes] of originals) {
      if (!fs.readFileSync(projectPath(root, file)).equals(bytes)) throw new Error(`Documentation changed during migration: ${file}`);
    }
  } catch (error) {
    for (const file of created.reverse()) fs.unlinkSync(projectPath(root, file));
    removeEmptyDirectories(root, to);
    throw error;
  }
  for (const file of originals.keys()) fs.unlinkSync(projectPath(root, file));
  removeEmptyDirectories(root, from);
  return { path: to, status: "moved-preserving-evidence", report: reportPath };
}

function relocateFeature(root, slug, state) {
  if (!STATES.includes(state)) throw new Error(`Unknown specification document state: ${state}`);
  const lifecycleApi = require("./lifecycle");
  const before = lifecycleApi.featureStatus(root, slug);
  const { directory, manifest, lifecycle } = lifecycleApi.readFeature(root, slug);
  const destination = `${SPEC_ROOT}/${state}/${slug}`;
  if (directory === destination) return before;
  if (state === "approved" && !before.authoritative) {
    throw new Error("Only explicit specification approval or current implementation verification can establish documentary authority.");
  }
  if (fs.existsSync(projectPath(root, destination))) throw new Error(`Specification destination already exists: ${destination}`);
  const originals = new Map();
  const collect = relative => {
    for (const entry of fs.readdirSync(projectPath(root, relative), { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`;
      const filename = projectPath(root, file);
      if (entry.isDirectory()) collect(file);
      else if (entry.isFile()) originals.set(file, fs.readFileSync(filename));
      else throw new Error(`Unsupported artifact in specification relocation: ${file}`);
    }
  };
  collect(directory);
  const relocate = file => file.startsWith(`${directory}/`) ? `${destination}${file.slice(directory.length)}`
    : ["specs/README.md", "specs/MCPEE.md"].includes(file) ? lifecycleApi.navigationTarget(root) : file;
  const outputs = new Map();
  for (const [file, bytes] of originals) {
    const target = relocate(file);
    if (!file.endsWith(".md") || file.startsWith(`${directory}/reviews/`)) {
      outputs.set(target, bytes);
      continue;
    }
    const content = rebaseMarkdown(root, bytes.toString("utf8"), file, target, relocate);
    outputs.set(target, Buffer.from(content));
  }
  manifest.index = relocate(manifest.index);
  if (manifest.document) manifest.document = relocate(manifest.document);
  for (const item of manifest.cases) {
    item.path = relocate(item.path);
    item.sha256 = hash(outputs.get(item.path));
  }
  if (manifest.index_sha256) manifest.index_sha256 = hash(outputs.get(manifest.index));
  outputs.set(`${destination}/manifest.json`, Buffer.from(json(manifest)));
  const digest = stage => {
    const names = stage === "specification"
      ? ["manifest.json", "spec.md", ...manifest.cases.map(item => path.posix.basename(item.path)),
        "decisions.json", "decisions.md", ...(manifest.document ? ["specification.json"] : [])]
      : [`${stage}.md`, ...(outputs.has(`${destination}/${stage}.json`) ? [`${stage}.json`] : [])];
    return hash(JSON.stringify(names.map(name => {
      const file = `${destination}/${name}`;
      return [file, hash(outputs.get(file))];
    })));
  };
  const digests = { specification: digest("specification") };
  for (const stage of ["plan", "tasks"]) {
    const file = `${destination}/${stage}.json`;
    if (outputs.has(file)) {
      const document = JSON.parse(outputs.get(file).toString("utf8"));
      if (document.specification_sha256 === before.reviews.specification.sha256) document.specification_sha256 = digests.specification;
      if (stage === "tasks" && document.plan_sha256 === before.reviews.plan.sha256) document.plan_sha256 = digests.plan;
      outputs.set(file, Buffer.from(json(document)));
    }
    if (outputs.has(`${destination}/${stage}.md`)) digests[stage] = digest(stage);
  }
  const id = crypto.randomUUID();
  const reportPath = `.mcpee/reports/specification-moves/${id}.json`;
  if (lifecycle.document_review?.sha256 === before.reviews.specification.sha256) {
    lifecycle.document_review.sha256 = digests.specification;
    lifecycle.document_review.relocation = reportPath;
  }
  for (const stage of ["specification", "plan", "tasks"]) {
    if (!before.reviews[stage].approved) continue;
    const approval = lifecycle.approvals[stage];
    approval.sha256 = digests[stage];
    if (stage !== "specification") approval.specification_sha256 = digests.specification;
    if (stage === "tasks") approval.plan_sha256 = digests.plan;
    approval.snapshot = relocate(approval.snapshot);
    approval.relocation = reportPath;
  }
  const verificationPath = `${destination}/verification.json`;
  if (before.implementation_verified && outputs.has(verificationPath)) {
    const verification = JSON.parse(outputs.get(verificationPath).toString("utf8"));
    for (const stage of ["specification", "plan", "tasks"]) verification[`${stage}_sha256`] = digests[stage];
    for (const file of verification.files) {
      const target = relocate(file.path);
      if (target !== file.path) {
        file.path = target;
        file.sha256 = hash(outputs.get(target));
      }
    }
    outputs.set(verificationPath, Buffer.from(json(verification)));
  }
  outputs.set(`${destination}/lifecycle.json`, Buffer.from(json(lifecycle)));
  const report = {
    generated_by: "mcpee", kind: "specification-relocation", id, feature: slug,
    from: directory, to: destination, moved_at: new Date().toISOString(),
    authority_granted: false, authority_preserved: before.authoritative,
    previous_reviews: before.reviews, implementation_verified: before.implementation_verified,
    files: [...originals].map(([file, bytes]) => ({
      from: file, to: relocate(file), previous_sha256: hash(bytes), sha256: hash(outputs.get(relocate(file))),
    })),
  };
  ensureDirectory(root, ".mcpee/reports/specification-moves");
  const created = [];
  try {
    for (const [file, contents] of outputs) {
      ensureDirectory(root, path.posix.dirname(file));
      fs.writeFileSync(projectPath(root, file), contents, { flag: "wx" });
      created.push(file);
    }
    fs.writeFileSync(projectPath(root, reportPath), json(report), { flag: "wx" });
    created.push(reportPath);
    for (const [file, bytes] of originals) {
      if (!fs.readFileSync(projectPath(root, file)).equals(bytes)) throw new Error(`Specification changed during relocation: ${file}`);
    }
  } catch (error) {
    for (const file of created.reverse()) fs.unlinkSync(projectPath(root, file));
    removeEmptyDirectories(root, destination);
    throw error;
  }
  for (const file of originals.keys()) fs.unlinkSync(projectPath(root, file));
  removeEmptyDirectories(root, directory);
  return lifecycleApi.featureStatus(root, slug);
}

module.exports = { relocateFeature, relocateDocuments };
