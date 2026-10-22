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

## Service and data-access review
- Identify the real controller/handler, application/domain boundary and data
  owner. Keep transaction scope explicit; select familiar patterns rather than
  adding repositories, CQRS or design patterns without a concrete need.
- Review tenant/object authorization as well as authentication. Preserve
  validation and version-compatible error contracts such as Problem Details;
  return correlation identifiers without leaking internal exceptions.
- For database-first code, inspect the authoritative schema and generated-code
  boundary; do not hand-edit regenerated entities or infer migration ownership.
- Verify projections, tracking, pagination, N+1 calls, concurrency tokens,
  optimistic conflict handling and transaction isolation against the actual
  ORM/provider. Compare emitted SQL, not just fluent query syntax.
- Trace cancellation, deadlines, bounded retries and circuit/failure isolation
  across downstream calls. Check idempotency under duplicate delivery and
  partial failure; add an outbox only when atomic event publication is required.
- Preserve structured logs and trace propagation; test that secrets and
  customer payloads are absent. Telemetry enablement or external export needs
  its own authorization.

## Exit evidence
For container changes, inspect the real build context, ignore rules, base image
support/pins and native dependencies. Use existing multi-stage/non-root patterns
where supported, avoid build secrets in layers and verify signals/graceful
shutdown, writable paths and health checks in the actual target image.
Building or publishing an image is an action, not a free consequence of review.

Include API/consumer compatibility, storage effects, failure/cancellation tests,
declared build/type/analyzer results and checks not run. A passing unit test does
not demonstrate authentication integration or provider-specific data behavior.

## Safety
Do not alter production state, external services, or secrets. Obtain owner review
for API-breaking, data-destructive, or security-sensitive changes.
