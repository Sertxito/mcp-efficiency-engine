class CapabilityRegistry {
  constructor() {
    this.capabilityById = new Map();
    this.boosts = [];
  }

  registerBoost(boostContract) {
    this.boosts.push(boostContract);
    for (const capability of boostContract.capabilities) {
      this.capabilityById.set(capability.id, capability);
    }
  }

  registerMany(boostContracts) {
    for (const boostContract of boostContracts) {
      this.registerBoost(boostContract);
    }
  }

  getCapability(capabilityId) {
    return this.capabilityById.get(capabilityId) || null;
  }

  listCapabilities() {
    return Array.from(this.capabilityById.values());
  }

  listBoosts() {
    return [...this.boosts];
  }

  toSummary() {
    return {
      boosts: this.boosts.length,
      capabilities: this.capabilityById.size,
    };
  }
}

module.exports = {
  CapabilityRegistry,
};
