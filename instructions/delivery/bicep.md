# Bicep engineering

**Scope:** Bicep modules, parameter files and resource deployment contracts.
**Version boundary:** inspect Bicep CLI, resource API versions, subscription/
resource-group scope and existing module contracts; do not assume availability.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Use typed parameters/outputs and reusable modules with explicit scope and
  dependencies. Prefer symbolic resource references to string-built resource IDs.
- Mark sensitive parameters securely and keep secrets out of outputs, source
  and logs. Use existing identity/secret-management conventions.
- Review naming, tags, network exposure, role assignments, resource replacement
  and region/SKU availability against the actual environment.
- Preserve idempotence and parameter compatibility; do not treat compile success
  as authorization to create or remove resources.

## Resource and module design
- Parameterize values that vary by deployment; keep stable implementation detail
  internal. Document allowed ranges and use safe defaults without freezing an
  arbitrary SKU list that prevents valid target configurations.
- Use stable deterministic names within provider length/character constraints;
  changing names/scopes can mean replacement. Do not claim uniqueString alone
  guarantees global uniqueness.
- Use symbolic references and existing resources with explicit scope. Let real
  references establish dependencies; avoid unnecessary broad dependsOn that
  serializes unrelated provisioning.
- Keep modules cohesive and versioned with explicit input/output contracts.
  Secure decorators are not permission controls; avoid exposing secret-bearing
  outputs or embedding credentials in parameter files.
- Review loops, conditions, deployment mode and resource ownership for deletions
  and orphaning. What-if can have unsupported/noisy results; inspect uncertainty
  rather than treating every diff as a precise prediction.

## Verification and performance
Run configured formatting/lint/build and validate parameter sets locally.
Review an authorized what-if diff before deployment, including deletions,
permission changes and cost/capacity implications. Define health checks,
rollback/forward-recovery and stop signals; deployment needs separate approval.

Official references:
- https://learn.microsoft.com/azure/azure-resource-manager/bicep/best-practices
- https://learn.microsoft.com/azure/azure-resource-manager/bicep/bicep-cli
