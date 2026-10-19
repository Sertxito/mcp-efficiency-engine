# Implement and review feature

**Trigger:** An approved feature has acceptance criteria and a selected design.

**Lead roles:** Team lead and the relevant senior engineering specialist.

## Stages
1. Confirm acceptance criteria, affected user journeys, boundaries, dependencies,
   and current behavior; flag missing decisions before implementation.
2. Decompose into independently reviewable vertical slices with an outcome,
   acceptance criteria, owner, dependencies, and validation evidence each.
3. Assign frontend/backend/data/AI/database/UX work to the relevant role; agree
   UI/API contract and cross-role handoffs before parallel implementation.
4. Implement the smallest complete slice with focused regression tests.
5. Trace affected producers, consumers, permissions, failure paths, data changes,
   accessibility, design-system use, and operational signals as applicable.
6. Run relevant checks, preserve exact results, and document untested scope and
   residual risk before proposing merge readiness.

## Outputs
Changed artifacts, requirement-to-change traceability, review findings, checks
and results, residual risks, and merge-readiness proposal. Merging requires approval.
No work item creation, merge, external publication, or deployment is implied by
this workflow; each state-changing action needs specific approval.
