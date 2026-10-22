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

## Reliability and operational baseline
- Model Availability Zone/Region and shared-dependency failures against the
  workload's SLO and RTO/RPO. Multi-AZ, replication and backups have distinct
  guarantees; verify restore and application integrity rather than assuming them.
- Bound timeouts, concurrency and retries with backoff/jitter at a deliberate
  layer. Respect SDK retry behavior; implement idempotency for duplicate messages
  and ambiguous writes, with explicit dead-letter/replay ownership.
- Review IAM resource/trust policies, cross-account assumptions and data-plane
  permissions together. Encryption and private networking do not replace
  authorization, secret rotation or an intentional egress boundary.
- Treat quotas, downstream saturation and scaling/cost limits as design inputs.
  Monitor user-visible outcomes with correlated logs/metrics/traces, redaction
  and actionable alarms rather than declaring health from instance status alone.
- Use staged immutable releases and reviewed change sets. Define stop signals,
  rollback/forward-recovery limits and post-change health checks; never equate a
  green CloudFormation/CDK result with a verified workload.

Official references:
- AWS Well-Architected: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
- IAM best practices: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
- AWS CDK v2: https://docs.aws.amazon.com/cdk/v2/guide/home.html
- CloudFormation best practices: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/best-practices.html
- AWS tagging: https://docs.aws.amazon.com/tag-editor/latest/userguide/tagging.html
- AppSync JavaScript runtime: https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-js-version.html
- Reliability design principles: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/design-principles.html
