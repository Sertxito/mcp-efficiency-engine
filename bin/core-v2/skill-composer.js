const fs = require("node:fs");
const path = require("node:path");

function readLayerFiles(basePath, layerFiles) {
  const loaded = [];
  for (const relativePath of layerFiles) {
    const absolutePath = path.join(basePath, relativePath);
    if (!fs.existsSync(absolutePath)) {
      loaded.push({ path: relativePath, exists: false, content: "" });
      continue;
    }

    loaded.push({
      path: relativePath,
      exists: true,
      content: fs.readFileSync(absolutePath, "utf8"),
    });
  }
  return loaded;
}

function composeSkill({ workspaceRoot, capability }) {
  const boostRoot = path.dirname(capability.boostSourcePath || "");
  const officialSkills = readLayerFiles(boostRoot, capability.skills || []);
  const officialSpecs = readLayerFiles(boostRoot, capability.specs || []);

  const generatedSkillsBase = path.join(workspaceRoot, ".mcpee", "generated-skills", capability.boost.replace("@mcpee/", ""));
  const overridesBase = path.join(workspaceRoot, ".mcpee", "overrides", capability.boost.replace("@mcpee/", ""));

  const generatedSkills = (capability.skills || []).map((skillPath) => {
    const fileName = path.basename(skillPath);
    const localRelativePath = fileName;
    const absolutePath = path.join(generatedSkillsBase, localRelativePath);
    if (!fs.existsSync(absolutePath)) {
      return { path: absolutePath, exists: false, content: "" };
    }

    return { path: absolutePath, exists: true, content: fs.readFileSync(absolutePath, "utf8") };
  });

  const overrides = (capability.skills || []).map((skillPath) => {
    const fileName = path.basename(skillPath);
    const localRelativePath = fileName;
    const absolutePath = path.join(overridesBase, localRelativePath);
    if (!fs.existsSync(absolutePath)) {
      return { path: absolutePath, exists: false, content: "" };
    }

    return { path: absolutePath, exists: true, content: fs.readFileSync(absolutePath, "utf8") };
  });

  const finalSkill = [
    "# Runtime Skill",
    "",
    "## Layers",
    "1. Official Skills",
    "2. Generated Skills",
    "3. Local Overrides",
    "4. Official Specs",
    "",
    "## Official Skills",
    ...officialSkills.filter((item) => item.exists).map((item) => item.content),
    "",
    "## Generated Skills",
    ...generatedSkills.filter((item) => item.exists).map((item) => item.content),
    "",
    "## Local Overrides",
    ...overrides.filter((item) => item.exists).map((item) => item.content),
    "",
    "## Specs",
    ...officialSpecs.filter((item) => item.exists).map((item) => item.content),
  ].join("\n");

  return {
    layers: {
      officialSkills,
      generatedSkills,
      overrides,
      officialSpecs,
    },
    finalSkill,
  };
}

module.exports = {
  composeSkill,
};
