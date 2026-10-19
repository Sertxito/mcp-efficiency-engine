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

## Output
Contract diff, endpoint/consumer inventory, compatibility result, authorization
and failure-path risks, test cases, and migration notes. Escalate breaking changes
to product and architecture owners.
