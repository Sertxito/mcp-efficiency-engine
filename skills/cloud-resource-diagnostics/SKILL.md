---
name: cloud-resource-diagnostics
description: "Inspect Azure or AWS resources, service health, operational evidence, and topology with available read-only tools."
---

# Cloud resource diagnostics

## Use when
- Inventorying or diagnosing deployed Azure or AWS resources.
- Correlating resource state, service health, logs, and topology.
- Preparing a resource relationship view from authorized, available provider data.

## Inputs
- Provider, subscription/account, resource group or service scope, and time window.
- The user's authorization and the provider tools already configured in the host.

## Procedure
1. Confirm the provider, tenant/account, subscription, region, resource scope, and time window before querying.
2. Prefer provider-native read-only inventory and health operations; use the narrowest scope that answers the question.
3. Correlate resource identifiers and timestamps across health, logs, metrics, and configuration. Separate observed state from inferred relationships.
4. Build a topology only from returned identifiers and explicit references. Mark missing edges and inaccessible resources.
5. Report exact queries/tools, evidence timestamps, errors, and the limits of the inspected scope.

## Operational hypotheses
Correlate time-windowed latency/error/saturation signals with dependency health,
deployment changes, limits/throttling, queue depth/age/dead-letter counts and
replication lag where supported. Capture sample/reset boundaries; resource
inventory alone cannot identify a bottleneck.
Record workload/capacity headroom, growth assumptions and alert thresholds with
units. Prefer aggregates/redacted metadata to payloads. A capacity forecast is
an assumption-backed estimate, not an executed load test.
Identify backup/PITR and routing/failover evidence gaps; use recovery-rehearsal
only after a bounded exercise is authorized, never as an implicit remediation.

## Output
Resource inventory, health summary, evidence-linked findings, and a topology or relationship list when supported by the available data.

## Safety and limitations
- This skill does not provision resources, change access, restart services, or remediate incidents.
- Never request or persist credentials, tokens, or private keys. Do not query another tenant/account by guessing identifiers.
- If provider tools are unavailable, state that limitation and give the user the exact evidence needed; do not simulate results.
- Provider APIs, resource graph coverage, and log retention vary. A clean read-only query is not proof that the environment is healthy.
