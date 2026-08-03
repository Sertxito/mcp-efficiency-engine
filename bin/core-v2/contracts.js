const fs = require("node:fs");

function normalizeCapability(rawCapability, boostName, boostSourcePath) {
  if (!rawCapability || typeof rawCapability !== "object") {
    return null;
  }

  const id = String(rawCapability.id || "").trim();
  if (!id) {
    return null;
  }

  return {
    id,
    title: String(rawCapability.title || id).trim(),
    boost: boostName,
    agent: String(rawCapability.agent || "").trim(),
    skills: Array.isArray(rawCapability.skills) ? rawCapability.skills.map((item) => String(item)).filter(Boolean) : [],
    specs: Array.isArray(rawCapability.specs) ? rawCapability.specs.map((item) => String(item)).filter(Boolean) : [],
    prompts: Array.isArray(rawCapability.prompts) ? rawCapability.prompts.map((item) => String(item)).filter(Boolean) : [],
    evals: Array.isArray(rawCapability.evals) ? rawCapability.evals.map((item) => String(item)).filter(Boolean) : [],
    providerNeeds: Array.isArray(rawCapability.providerNeeds)
      ? rawCapability.providerNeeds.map((item) => String(item)).filter(Boolean)
      : [],
    boostSourcePath,
  };
}

function loadBoostContract(contractPath) {
  const raw = fs.readFileSync(contractPath, "utf8");
  const contract = JSON.parse(raw);

  if (!contract || typeof contract !== "object") {
    throw new Error(`Invalid contract format: ${contractPath}`);
  }

  const name = String(contract.name || "").trim();
  const type = String(contract.type || "").trim();
  const schemaVersion = String(contract.schemaVersion || "").trim();
  if (!name) {
    throw new Error(`Missing boost name in contract: ${contractPath}`);
  }
  if (type !== "boost") {
    throw new Error(`Unsupported contract type '${type}' in: ${contractPath}`);
  }
  if (!schemaVersion) {
    throw new Error(`Missing schemaVersion in contract: ${contractPath}`);
  }

  const capabilities = Array.isArray(contract.capabilities)
    ? contract.capabilities.map((capability) => normalizeCapability(capability, name, contractPath)).filter(Boolean)
    : [];

  return {
    name,
    version: String(contract.version || "0.0.0").trim(),
    schemaVersion,
    type,
    description: String(contract.description || "").trim(),
    domain: String(contract.domain || "").trim(),
    capabilities,
    sourcePath: contractPath,
  };
}

module.exports = {
  loadBoostContract,
};
