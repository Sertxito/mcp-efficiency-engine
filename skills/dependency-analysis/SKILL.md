---
name: dependency-analysis
description: "Trace direct and transitive dependencies, coupling, lifecycle risks, and ownership from manifests and source."
---

# Dependency analysis

## Procedure
1. Inventory declared, resolved, runtime, build, and external dependencies in
   the requested scope.
2. Trace critical dependency paths and verify suspected cycles or shared-state
   coupling against source/configuration.
3. Check versions, support lifecycle, provenance, ownership, and vulnerability
   evidence using available project-approved sources.
4. Separate confirmed issues from stale metadata, scanner findings, and unknowns.
5. Prioritize changes with compatibility tests and a recovery plan.

Check package license/notice obligations, source/provenance and supported
runtime/platform artifacts as well as version numbers. Distinguish a manifest
constraint from the resolved lockfile and the deployed artifact/SBOM.
Verify transitive impact, abandoned ownership, native wheel/image availability
and supply-chain exceptions with dates and owners; do not infer vulnerability
or compatibility solely from age or a scanner score.

## Safety
Do not update or remove dependencies without approval and compatibility
validation. Do not upload manifests or code to unapproved services.

## Output
Dependency map, evidence, lifecycle/security uncertainty, impact, and bounded
verification or remediation steps.
