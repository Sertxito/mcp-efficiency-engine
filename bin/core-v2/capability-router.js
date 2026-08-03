function resolveCapability({ registry, capabilityId }) {
  const normalizedCapabilityId = String(capabilityId || "").trim();
  if (!normalizedCapabilityId) {
    return {
      capability: null,
      notes: ["missing_capability"],
      fallback: true,
    };
  }

  const capability = registry.getCapability(normalizedCapabilityId);
  if (!capability) {
    return {
      capability: null,
      notes: [`capability_not_found:${normalizedCapabilityId}`],
      fallback: true,
    };
  }

  return {
    capability,
    notes: ["selected_by=capability_id"],
    fallback: false,
  };
}

module.exports = {
  resolveCapability,
};
