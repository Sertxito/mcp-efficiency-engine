---
name: cloud-infrastructure-review-example
description: "Example request for a source-grounded Azure or AWS architecture/IaC review."
---

Review [Azure/AWS] [Bicep/Terraform/CloudFormation/CDK/YAML] for [goal].

Identify provider, service, region, tool/API versions, deployment identity, and
current environment assumptions. Use the linked official provider guidance for
uncertain/version-sensitive behavior. Assess security/permissions, availability,
networking, cost/quotas, observability, destructive changes, and recovery. Run
local validation/plan/what-if checks that are configured. Return prioritized
findings with source paths, severity/confidence, mitigations, checks run, and
explicitly unverified assumptions. Do not deploy without approval for the
specific action.
