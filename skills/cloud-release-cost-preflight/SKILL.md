---
name: cloud-release-cost-preflight
description: "Check cloud deployment prerequisites, least-privilege role needs, quota, and current pricing before proposing a release."
---

# Cloud release and cost preflight

## Use when
- Checking Azure or AWS deployment prerequisites, quota, region/SKU availability, or estimated cost.
- Identifying the least-privileged role needed for a stated operation.
- Reviewing a deployment plan before, but not performing, a cloud change.

## Inputs
- Provider, target scope, region, resource types/SKUs, workload assumptions, and exact proposed operation.
- Current provider documentation or read-only provider tools when available.

## Procedure
1. Resolve the provider, operation, resource scope, region, and workload assumptions from the project and request.
2. Identify only the permissions required for that operation; cite the provider role/policy definition and scope. Do not grant roles.
3. Verify region/SKU availability and quota against current provider evidence; distinguish requested quota from remaining usable capacity.
4. Estimate cost from explicit usage quantities and current pricing data. State currency, billing assumptions, exclusions, and estimate date.
5. List blockers, unknowns, reversible checks, and the approvals required before deployment or access changes.

## Output
Preflight checklist with evidence, minimum permission scope, quota/capacity state, cost assumptions, blockers, and unverified items.

## Safety and limitations
- A preflight is not authorization to deploy, purchase, or change IAM/RBAC.
- Never infer permissions from a role name alone; verify actions and assignable scope from authoritative provider sources.
- Do not present a pricing estimate as a quote or assume discounts, taxes, data transfer, or utilization that were not supplied.
- If live provider data or current pricing cannot be obtained, mark it unavailable rather than using stale values as current.
