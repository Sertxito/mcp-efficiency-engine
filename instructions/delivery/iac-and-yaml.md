# Infrastructure as code and pipeline YAML

**Scope:** Bicep, Terraform, CloudFormation, GitHub Actions, Azure Pipelines,
and Kubernetes workload manifests. **Version boundary:** provider schemas,
actions, modules, API versions, and tool releases must be resolved from project
pins and current official references; none is certified by this guide.
**References checked:** 2026-10-12 (HTTP reachability only, not a review of
every page's technical content).

Identify the provider, IaC engine, schema/API version, deployment identity, and
environment before reviewing or generating infrastructure. Follow the
repository's pinned toolchain and local modules.

- Prefer declarative, reviewable changes with least-privilege identities,
  parameterized environment-specific values, and secrets kept in secret stores.
- Validate templates with the project's official compiler/validator, lint,
  policy checks, and plan/what-if/change-set output before deployment.
- Review the full resource and permission diff, network exposure, naming,
  tagging, cost, quotas, and destructive/replacement behavior.
- For YAML, preserve valid indentation/schema, reuse templates where supported,
  quote values whose parsing is ambiguous, and constrain triggers, permissions,
  and deployment environments.
- Pin third-party actions/modules/images when the project's supply-chain policy
  requires it; record provenance and avoid unreviewed remote scripts.
- A passing template validation is not deployment approval or proof of runtime
  health. Stage rollout, define stop signals, and test recovery.

Official references:
- Bicep best practices: https://learn.microsoft.com/azure/azure-resource-manager/bicep/best-practices
- Terraform language: https://developer.hashicorp.com/terraform/language
- AWS CloudFormation: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html
- GitHub Actions workflow syntax: https://docs.github.com/actions/writing-workflows/workflow-syntax-for-github-actions
- Azure Pipelines YAML schema: https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/
- Kubernetes workload resources: https://kubernetes.io/docs/concepts/workloads/
