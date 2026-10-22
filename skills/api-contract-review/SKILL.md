---
name: api-contract-review
description: "Review API and event contracts for compatibility, validation, security, and failure behavior. Use for REST, GraphQL, RPC, messaging, or schema changes."
---

# API contract review

## Procedure
1. Inventory endpoints/events, callers, generated clients, current versions, and compatibility guarantees.
2. Trace consumers and affected call sites; distinguish confirmed from inferred consumers.
3. Review fields, validation, authorization, error semantics, pagination, retries, and idempotency.
4. Check backward/forward compatibility, versioning, and expand/contract sequencing.
5. Define contract tests and negative, boundary, and failure-path cases.
6. Document rollout, deprecation, and consumer-migration requirements.

## Protocol-specific checks
- REST/OpenAPI: status codes, Problem Details or the established error envelope,
  content types, validation, stable pagination, rate limits, authentication
  schemes and generated-client compatibility.
- GraphQL/RPC: nullability, resolver authorization, bounded query complexity,
  additive schema evolution, deadlines and typed failure handling.
- Messaging: delivery guarantees, ordering scope, duplicate handling,
  acknowledgement timing, schema versions, dead-letter policy and safe replay.
- Consumer-driven contracts: identify the owning producer and real consumer
  versions; run existing verification against both sides of a proposed change.
  A schema diff or mocked response alone cannot prove consumer compatibility.
- Validate authorization at the object/tenant boundary and test over-posting,
  unknown fields, unsupported versions and downstream partial failure.

## Output
Contract diff, endpoint/consumer inventory, compatibility result, authorization
and failure-path risks, test cases, and migration notes. Escalate breaking changes
to product and architecture owners.
