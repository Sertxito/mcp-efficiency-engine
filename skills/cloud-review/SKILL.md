---
name: cloud-review
description: "Review a declared cloud environment for identity, networking, reliability, recovery, observability, and cost using provider-specific evidence."
---

# Cloud review

## Procedure
1. Confirm provider, services, region, deployment identity, versions, and review
   boundary from project evidence.
2. Trace network exposure, identity, secrets, data, and service dependencies.
3. Assess reliability, backup/recovery, observability, capacity, and cost only
   against stated objectives and current evidence.
4. Run provider-native static validation only when locally configured and
   approved; distinguish validation from deployment approval.
5. Record unknowns, owner decisions, mitigations, and safe verification steps.

## Output
Provider-specific findings with sources, impact, assumptions, checks, and
recovery constraints. Do not assume a cloud, region, or availability target.
