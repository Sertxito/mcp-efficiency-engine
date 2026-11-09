"use strict";

const fs = require("node:fs");
const { projectPath } = require("./brownfield");

const SPEC_ROOT = "docs/specifications";
const STATES = ["proposed", "reviewed", "approved"];
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function workspace(slug, root) {
  if (typeof slug !== "string" || !slugPattern.test(slug) ||
      [...STATES, "readme"].includes(slug)) {
    throw new Error("Specification ID must be a lowercase descriptive slug, not an internal directory name.");
  }
  const candidates = [...STATES.map(state => `${SPEC_ROOT}/${state}/${slug}`), `specs/${slug}`];
  const existing = root ? candidates.filter(directory =>
    fs.existsSync(projectPath(root, `${directory}/spec.md`)) ||
    fs.existsSync(projectPath(root, `${directory}/manifest.json`))) : [];
  if (existing.length > 1) throw new Error(`Specification ${slug} exists in multiple states: ${existing.join(", ")}. Reconcile the duplicate before continuing.`);
  return existing[0] || `${SPEC_ROOT}/proposed/${slug}`;
}

function featureDirectories(root) {
  return [...STATES.map(state => `${SPEC_ROOT}/${state}`), "specs"].flatMap(parent => {
    if (!fs.existsSync(projectPath(root, parent))) return [];
    return fs.readdirSync(projectPath(root, parent), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && slugPattern.test(entry.name) &&
        ![...STATES, "readme"].includes(entry.name))
      .filter(entry => fs.existsSync(projectPath(root, `${parent}/${entry.name}/spec.md`)))
      .map(entry => ({ slug: entry.name, directory: `${parent}/${entry.name}` }));
  });
}

function currentBundlePath(root, slug, directory, file) {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^(?:${SPEC_ROOT}/(?:${STATES.join("|")})|specs)/${escaped}(/.*)?$`).exec(file);
  if (!match) return file;
  let rest = match[1] || "";
  if (/^\/reviews(?:\/|$)/.test(rest) && !fs.existsSync(projectPath(root, `${directory}/reviews`)) &&
      fs.existsSync(projectPath(root, `${directory}/history`))) rest = rest.replace(/^\/reviews/, "/history");
  return `${directory}${rest}`;
}

module.exports = { SPEC_ROOT, STATES, workspace, featureDirectories, currentBundlePath };
