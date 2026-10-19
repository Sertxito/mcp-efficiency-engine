---
name: backend-change
description: "Implement and verify a focused backend or service change. Use for API handlers, domain logic, integrations, input validation, or server-side regressions."
---

# Backend change

## Procedure
1. Reproduce or specify current behavior and the requested outcome.
2. Trace callers, contracts, authorization, persistence, and failure paths.
3. Implement the smallest complete behavior change with explicit error handling.
4. Add regression tests for success, invalid input, and relevant failure cases.
5. Run project-declared checks and report exact results and remaining risks.

## Safety
Do not alter production state, external services, or secrets. Obtain owner review
for API-breaking, data-destructive, or security-sensitive changes.
