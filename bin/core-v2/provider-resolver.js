const PROVIDER_MAP = {
  "code-navigation": "CodeGraph",
  "dependency-analysis": "CodeGraph",
  "call-path-analysis": "CodeGraph",
  "blast-radius": "GitNexus",
  "knowledge-graph": "Graphify",
  "document-normalization": "MarkItDown",
  snapshot: "Repomix",
  "project-memory": "MemoryService",
};

function resolveProvidersForCapability(capability, providers) {
  const providerByName = new Map(providers.map((provider) => [provider.name, provider]));
  const needs = Array.isArray(capability.providerNeeds) ? capability.providerNeeds : [];

  const resolved = [];
  const seenNeedProvider = new Set();
  const unresolved = [];

  for (const need of needs) {
    const mappedName = PROVIDER_MAP[need];
    if (!mappedName) {
      unresolved.push({ need, reason: "no_provider_mapping" });
      continue;
    }

    if (mappedName === "MemoryService") {
      const key = `${need}:MemoryService`;
      if (seenNeedProvider.has(key)) {
        continue;
      }
      seenNeedProvider.add(key);
      resolved.push({
        need,
        provider: "MemoryService",
        available: true,
      });
      continue;
    }

    const provider = providerByName.get(mappedName);
    if (!provider || !provider.available) {
      unresolved.push({ need, reason: `provider_unavailable:${mappedName}` });
      continue;
    }

    const key = `${need}:${provider.name}`;
    if (seenNeedProvider.has(key)) {
      continue;
    }
    seenNeedProvider.add(key);
    resolved.push({
      need,
      provider: provider.name,
      available: true,
    });
  }

  return {
    resolved,
    unresolved,
  };
}

module.exports = {
  resolveProvidersForCapability,
};
