"use strict";

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    const key = typeof value === "string" && value.trim() ? value.trim() : "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right)));
}

function summarizeInventory(provider, payload, observedAt = new Date().toISOString()) {
  if (provider === "azure") {
    if (!Array.isArray(payload) || payload.some((item) =>
      !item || typeof item !== "object" || Array.isArray(item))) {
      throw new Error("Azure CLI resource inventory must be a JSON array of resources.");
    }
    return {
      schema_version: 1,
      provider,
      evidence_kind: "live_read_only_cli_inventory",
      scope: "Resources visible to the currently authenticated Azure CLI identity",
      observed_at: observedAt,
      resource_count: payload.length,
      resource_counts_by_type: countBy(payload.map((resource) => resource.type)),
      resource_counts_by_location: countBy(payload.map((resource) => resource.location)),
    };
  }
  if (provider === "aws") {
    const resources = payload?.ResourceTagMappingList;
    if (!Array.isArray(resources) || resources.some((item) =>
      !item || typeof item !== "object" || typeof item.ResourceARN !== "string")) {
      throw new Error("AWS CLI tagged-resource inventory must include ResourceTagMappingList entries with ResourceARN.");
    }
    const arnParts = resources.map(({ ResourceARN }) => ResourceARN.split(":"));
    if (arnParts.some((parts) => parts.length < 6 || parts[0] !== "arn")) {
      throw new Error("AWS CLI returned a resource with an invalid ARN.");
    }
    return {
      schema_version: 1,
      provider,
      evidence_kind: "live_read_only_cli_inventory",
      scope: "Tagged resources visible to the currently authenticated AWS CLI identity; capped at 1000",
      observed_at: observedAt,
      resource_count: resources.length,
      truncated: typeof payload.NextToken === "string" && payload.NextToken.length > 0,
      resource_counts_by_type: countBy(arnParts.map((parts) => parts[2])),
      resource_counts_by_region: countBy(arnParts.map((parts) => parts[3] || "global")),
    };
  }
  throw new Error(`Unsupported cloud provider: ${provider}`);
}

module.exports = { summarizeInventory };
