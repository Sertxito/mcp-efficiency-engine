# AWS engineering guidance

**Scope:** Well-Architected trade-offs, IAM, CDK, CloudFormation, tagging, and
AppSync. **Version boundary:** no service, region, runtime, or IaC release is
certified here; verify the deployed account/region and pinned project toolchain
against current AWS documentation. **References checked:** 2026-10-12 (HTTP
reachability only, not a review of every page's technical content).

Use the repository's selected AWS services, account/organization boundaries,
regions, and pinned tool versions. For version-sensitive guidance, consult the
official AWS sources below and verify their current applicability.

- Apply AWS Well-Architected trade-offs across operational excellence,
  security, reliability, performance, cost, and sustainability.
- Prefer IAM roles and temporary credentials; scope policies to required
  principals, actions, resources, and conditions.
- For CDK, preserve the project's major version and review synthesized
  CloudFormation, logical resource changes, IAM policies, and asset packaging.
- For CloudFormation, use parameters and reusable nested stacks/modules where
  appropriate; review change sets before approved deployment.
- Tag resources consistently for ownership, environment, and cost attribution.
- Treat AppSync JavaScript resolvers as the documented constrained runtime,
  not as general Node.js.
- Validate IaC, permissions, drift, cost, rollback, and service quotas before
  proposing a release; do not deploy without explicit approval.

Official references:
- AWS Well-Architected: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
- IAM best practices: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
- AWS CDK v2: https://docs.aws.amazon.com/cdk/v2/guide/home.html
- CloudFormation best practices: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/best-practices.html
- AWS tagging: https://docs.aws.amazon.com/tag-editor/latest/userguide/tagging.html
- AppSync JavaScript runtime: https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-js-version.html
