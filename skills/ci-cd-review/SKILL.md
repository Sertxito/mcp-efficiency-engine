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

## Supply-chain and release evidence
Verify untrusted PR/fork boundaries, reusable workflow inputs, runner isolation,
token lifetime and least privilege. Prefer the repository's approved immutable
action/container pins and scoped workload identity; never copy a broad token
or privileged event trigger from an example.
Inspect SBOM/provenance generation, dependency vulnerability/license policy,
artifact checksums/signatures and retention/access where configured. Distinguish
an advisory finding from the project's actual blocking threshold and documented
exception owner/expiry. Do not claim a scan ran from the presence of a config.
Keep caches untrusted and separate from promoted artifacts. Verify that the
same tested artifact is promoted and that failed/missing gates block release.
Review secret rotation/revocation procedures, log redaction and audit evidence;
do not rotate credentials or modify remote permissions during a review.

## Output
Pipeline map, risks, concrete changes, checks/results, and remaining approval or
provider configuration steps. Do not change live pipeline secrets or permissions
without explicit approval.
