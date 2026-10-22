# YAML pipeline engineering

**Scope:** GitHub Actions, Azure Pipelines and explicitly configured CI YAML.
**Version boundary:** identify the provider/schema, runner OS, action/task
versions, triggers and deployment environments; YAML alone does not identify CI.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Preserve schema/indentation and quote ambiguous scalars. Reuse existing
  templates without hiding permissions, conditionals or environment boundaries.
- Separate untrusted PR input from privileged jobs. Use least-privilege tokens,
  scoped secrets and protected environments; never interpolate untrusted text
  into shell scripts or expose secrets in logs.
- Pin actions, images, toolchains and dependencies according to project policy.
  Build once and promote the verified artifact; validate provenance/integrity.
- Keep caches separate from release artifacts, use appropriate cache keys and
  never assume a cache hit proves freshness or successful validation.
- Set bounded timeouts/concurrency and explicit failure propagation. Do not
  turn failed checks into green releases with continue-on-error or silent defaults.
- Publish committed immutable versions; a successful upload followed by failed
  verification needs investigation, not blind republishing.

## Trust, artifacts and execution boundaries
- Understand trigger/ref semantics and fork trust. Do not run untrusted checkout
  code with privileged pull_request_target credentials; approving a workflow
  definition does not make every input or artifact trusted.
- Prefer short-lived federated identity where supported, constrained to the
  intended repository/ref/environment/audience. Pin third-party executable
  dependencies to reviewed immutable identities under project policy.
- Pass untrusted values through safe data/argument boundaries, not generated
  shell expressions. Remember that secret masking may miss transformed values.
- Treat self-hosted runner persistence, cache poisoning and downloaded artifacts
  as trust boundaries. Verify artifact origin/integrity before privileged use;
  never promote an untrusted PR cache into a release.
- Distinguish compile-time template expansion from runtime conditions in the
  actual provider. Review needs/dependencies, skipped/cancelled jobs and matrix
  failure behavior so deployment cannot bypass required checks.
- Keep releases immutable with protected approval/concurrency boundaries. Test
  reruns, partial publication and cancellation; retrying a job must not silently
  duplicate deployment or publish a different artifact under the same version.

## Verification and performance
Run the existing schema/linter checks and affected job/OS matrix. Distinguish
local syntax validation from an observed remote CI pass. Diagnose slow jobs
from step timing, dependency/cache evidence and runner constraints before
adding parallelism. Deployment requires reviewed environment and recovery gates.

Official references:
- https://docs.github.com/actions/writing-workflows/workflow-syntax-for-github-actions
- https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/
- https://docs.github.com/en/actions/reference/security/secure-use
