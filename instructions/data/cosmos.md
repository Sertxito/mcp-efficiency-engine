# Cosmos DB engineering

**Scope:** Cosmos DB application access, data modeling and operational changes.
**Version boundary:** identify the account API, SDK/version, consistency,
partition model, environment and actual service configuration before advice.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Choose partition keys from access patterns, distribution, cardinality and
  growth evidence; a syntactically valid key is not proof against hot partitions.
- Prefer point reads for a known partition key and item ID where supported.
  Reuse configured SDK clients and respect cancellation and continuation tokens.
- Measure request charge/RUs, latency, throttling, cross-partition fan-out and
  index utilization. Index changes affect write and storage cost too.
- Preserve consistency and concurrency semantics; use ETags/conditional writes
  where needed and keep retries bounded and idempotent.
- Validate change-feed checkpoint/lease configuration and duplicate processing.
  Define retention, recovery and replay limitations explicitly.
- Parameterize queries, enforce tenant/partition authorization at boundaries,
  and keep sensitive document payloads out of logs and traces.
- Partition routing is not an authorization model. Cross-tenant data alone does
  not prove unauthorized access; inspect the caller's permitted tenant scope.
  When a fragment returns a batch response, inspect the caller before claiming
  it silently treats failure as success. Verify the SDK's response/exception
  behavior and the retry implementation instead of inferring them from names.

## Modeling and reliability boundaries
- Model documents around bounded access/aggregate patterns, not an automatic
  relational-table translation. Avoid unbounded arrays and item growth; review
  denormalization update costs and partition-key changes as migration work.
- For the NoSQL API, transaction/transactional-batch scope is a logical partition;
  do not promise atomic writes across partitions or assume other account APIs
  share that model. Check the chosen API's actual guarantees.
- Handle 429 throttling with the SDK's supported retry-after behavior and an
  overall operation budget; do not layer unlimited application retries on top.
  Preserve conditional-write conflict handling and idempotency.
- Treat continuation tokens as opaque and bind their use to a compatible query
  and authorization context. Do not log tokens or assume offset pagination has
  constant RU cost.
- Distinguish TTL/backup/recovery from a business retention or deletion guarantee.
  Check multi-region conflict handling and consistency/failover requirements
  before changing writes or promising recovery.

## Verification and performance
Use representative queries, keys, item sizes and concurrency. Compare RU and
latency distributions with throttling and correctness results, not one query.
Account/schema/index/throughput changes require reviewed scope and approval;
an emulator test does not certify cloud capacity, consistency or failover.

Official references:
- https://learn.microsoft.com/azure/cosmos-db/
- https://learn.microsoft.com/azure/cosmos-db/partitioning
- https://learn.microsoft.com/azure/cosmos-db/change-feed
