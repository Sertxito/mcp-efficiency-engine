"use strict";

const fs = require("node:fs");
const path = require("node:path");

function validateSlug(value) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error("Plan slug must use lowercase letters, numbers, and single hyphens.");
  }
  return value;
}

function resolveDirectory(root, slug) {
  const base = path.join(root, ".mcpee");
  if (fs.existsSync(base) && (fs.lstatSync(base).isSymbolicLink() || !fs.lstatSync(base).isDirectory())) {
    throw new Error("Refusing to write planning artifacts through an unsafe .mcpee path.");
  }
  const directory = path.join(base, "planning", slug);
  const relative = path.relative(root, directory);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Planning artifact path escapes the project.");
  }
  for (const candidate of [path.join(base, "planning"), directory]) {
    if (fs.existsSync(candidate) &&
        (fs.lstatSync(candidate).isSymbolicLink() || !fs.lstatSync(candidate).isDirectory())) {
      throw new Error(`Refusing to write through an unsafe planning path: ${path.relative(root, candidate)}`);
    }
    let parent = candidate;
    while (parent !== root && parent.startsWith(`${root}${path.sep}`)) {
      parent = path.dirname(parent);
      if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) {
        throw new Error(`Refusing to write through a symbolic link: ${path.relative(root, parent)}`);
      }
    }
  }
  return directory;
}

function createPlan(projectRoot, { slug: rawSlug, title: rawTitle }) {
  const root = path.resolve(projectRoot);
  const slug = validateSlug(rawSlug);
  if (typeof rawTitle !== "string" || !rawTitle.trim() ||
      rawTitle.trim().length > 200 || /[\r\n]/.test(rawTitle)) {
    throw new Error("Plan title must be a single non-empty line of at most 200 characters.");
  }
  const title = rawTitle.trim();
  const directory = resolveDirectory(root, slug);
  fs.mkdirSync(directory, { recursive: true });
  const specification = [
    `# Product specification: ${title}`,
    "",
    `- **ID:** ${slug}`,
    "- **Status:** draft",
    "- **Owner:** <owner>",
    "- **Last reviewed:** <YYYY-MM-DD>",
    "",
    "## Problem and evidence",
    "",
    "<Describe the user problem and link repository or user evidence. Separate verified facts from assumptions.>",
    "",
    "## Desired outcome",
    "",
    "<State the measurable user or business outcome.>",
    "",
    "## Users and scenarios",
    "",
    "- **Primary users:** <...>",
    "- **Key scenario:** <...>",
    "",
    "## Scope",
    "",
    "### In scope",
    "- <...>",
    "",
    "### Out of scope",
    "- <...>",
    "",
    "## Requirements and acceptance criteria",
    "",
    "- [ ] <Observable, testable criterion>",
    "",
    "## Constraints, dependencies, and risks",
    "",
    "- **Constraints:** <...>",
    "- **Dependencies:** <...>",
    "- **Risks / mitigations:** <...>",
    "",
    "## Open decisions",
    "",
    "- [ ] <Decision, owner, and due date>",
    "",
    `See [the delivery plan](./delivery-plan.md) for implementation slices and validation evidence.`,
    "",
  ].join("\n");
  const deliveryPlan = [
    `# Delivery plan: ${title}`,
    "",
    `- **ID:** ${slug}`,
    "- **Status:** draft",
    `- **Specification:** [spec.md](./spec.md)`,
    "",
    "## Readiness",
    "",
    "- [ ] Problem, scope, and acceptance criteria reviewed",
    "- [ ] Relevant architecture, security, and data decisions recorded",
    "- [ ] Dependencies and approval boundaries confirmed",
    "",
    "## Delivery slices",
    "",
    "| ID | Outcome / acceptance criteria | Owner | Depends on | Validation evidence | Status |",
    "| --- | --- | --- | --- | --- | --- |",
    "| S1 | <smallest end-to-end outcome> | <owner> | — | <check and expected evidence> | proposed |",
    "",
    "## Validation and release",
    "",
    "- **Automated checks:** <commands and expected results>",
    "- **Manual / accessibility checks:** <...>",
    "- **Observability / success signals:** <...>",
    "- **Rollout and recovery:** <...>",
    "",
    "## Decisions and residual risks",
    "",
    "- <Decision or risk, evidence, owner, and follow-up>",
    "",
    "## Change log",
    "",
    "- <YYYY-MM-DD>: Draft created; acceptance and delivery details pending review.",
    "",
  ].join("\n");
  const files = [
    ["spec.md", specification],
    ["delivery-plan.md", deliveryPlan],
  ];
  for (const [name] of files) {
    const destination = path.join(directory, name);
    if (fs.existsSync(destination)) {
      throw new Error(`Planning artifact already exists and will not be overwritten: ${path.relative(root, destination)}`);
    }
  }
  const created = [];
  try {
    for (const [name, content] of files) {
      const destination = path.join(directory, name);
      fs.writeFileSync(destination, content, { encoding: "utf8", flag: "wx" });
      created.push(destination);
    }
  } catch (error) {
    for (const createdPath of created) fs.unlinkSync(createdPath);
    throw error;
  }
  return {
    id: slug,
    title,
    files: files.map(([name]) => `.mcpee/planning/${slug}/${name}`),
  };
}

function listPlans(projectRoot) {
  const root = path.resolve(projectRoot);
  const directory = path.join(root, ".mcpee", "planning");
  if (!fs.existsSync(directory)) return [];
  for (const part of [".mcpee", ".mcpee/planning"]) {
    const candidate = path.join(root, part);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`Refusing to list planning artifacts through a symbolic link: ${part}`);
    }
  }
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Refusing to list planning artifacts through an unsafe path.");
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => {
      const slug = validateSlug(entry.name);
      const planDirectory = path.join(directory, slug);
      return {
        id: slug,
        specification: fs.existsSync(path.join(planDirectory, "spec.md")),
        delivery_plan: fs.existsSync(path.join(planDirectory, "delivery-plan.md")),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = { createPlan, listPlans, validateSlug };
