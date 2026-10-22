---
description: "Apply approved organization-wide engineering, privacy and review conventions."
applyTo: "**"
---

# {{organization_name}} engineering conventions

<!-- Copy to .github/instructions/organization.instructions.md in the consuming
repository. Complete placeholders and obtain approval before adoption.
Record organization-specific boundaries only, not generic technical practices
or a copy of MCPEE's common policies. Remove sections with no local additions. -->

Owner: {{policy_owner}}
Approved policy revision: {{revision_and_source}}
Next review: {{review_date_or_trigger}}

## Mandatory boundaries

- Data classification and permitted processing locations: {{data_rules}}.
- Dependencies, licenses and external services: {{approved_policy_and_source}}.
- Contract/API compatibility requirements: {{compatibility_policy}}.
- Minimum review and validation gates: {{quality_requirements}}.
- Approval owners and escalation path: {{owners_and_contacts_without_secrets}}.

## Decisions and exceptions

Language/framework practices come from MCPEE's technical baseline and skills.
This file adds organizational choices; functional specifications remain in
their authoritative project sources, not in this policy.
Follow the project's approved component conventions within these boundaries.
Do not invent a missing organizational decision or silently resolve conflicting
mandatory rules. Report the affected rule, scope, impact and decision owner.
Record approved exceptions with rationale, approver and expiry/review trigger.
No convention or exception authorizes a tool call, deployment or data transfer,
or relaxes MCPEE approval, security, privacy or evidence requirements.
