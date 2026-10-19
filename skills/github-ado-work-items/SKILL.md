---
name: github-ado-work-items
description: "Draft or manage GitHub Issues, Projects, and Azure DevOps work items. Use for creating, updating, linking, or closing remote engineering tasks."
---

# GitHub and Azure DevOps work items

## Procedure
1. Confirm tracker type, project/repository, permissions, and configured integration.
2. Search for duplicates and inspect existing labels, templates, and relationships.
3. Draft the exact title, body, acceptance criteria, links, labels, owner, and milestone.
4. Show the proposed operation and target; obtain explicit approval for each remote write.
5. Perform only the approved operation, then read back the created/updated item.
6. Report its canonical URL/ID, observed fields, and any partial failure.

## Safety
Reading remote tracker data is subject to configured access and project policy.
Creating, editing, assigning, closing, or changing project fields is an external
state change and must not occur without explicit per-action approval.
