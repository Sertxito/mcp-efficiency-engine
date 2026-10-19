---
name: ci-cd-review
description: "Review CI/CD pipelines for reproducibility, permissions, artifact integrity, and promotion safety. Use for GitHub Actions, Azure Pipelines, build failures, or release automation."
---

# CI/CD review

## Procedure
1. Trace triggers, identities, secrets, permissions, and protected environments.
2. Check dependency/action pinning, artifact provenance, caching, and isolation.
3. Verify required quality/security gates and failure behavior.
4. Assess branch, approval, and environment-promotion boundaries.
5. Run safe declared validation and report untested provider-side behavior.

## Output
Pipeline map, risks, concrete changes, checks/results, and remaining approval or
provider configuration steps. Do not change live pipeline secrets or permissions
without explicit approval.
