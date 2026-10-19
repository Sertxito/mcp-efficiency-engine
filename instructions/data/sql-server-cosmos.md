# Data engineering: SQL Server and Cosmos DB

**Scope:** relational SQL Server and Azure Cosmos DB design, performance,
security, and rollout. **Version boundary:** engine versions, Cosmos DB API,
region, consistency, and workload constraints are project-specific; this guide
does not certify a deployment configuration. **References checked:**
2026-10-12 (HTTP reachability only, not a review of every page's technical
content).

Identify the engine, version, data classification, workload, and authoritative
schema before recommending or changing data behavior. Baseline before tuning.
Anonymize sensitive samples before sharing or exporting them.

## SQL Server

- Inspect schema, keys, constraints, stored procedures, callers, execution
  plans, Query Store, and workload evidence before proposing changes.
- Capture performance baselines; validate query/index changes with
  representative plans and regression data.
- Prefer additive and staged migrations with integrity checks, rollback limits,
  and explicit treatment of irreversible data transformations.
- Apply least privilege, auditing, encryption requirements, and the project's
  supported SQL Server version.

## Cosmos DB

- Evaluate partition key/cardinality, RU consumption, index policy, query
  patterns, consistency, region topology, and backup/recovery together.
- Prefer point reads for known partition-key and item-key lookups where
  applicable. Reuse the configured client and avoid creating one per request.
- Validate change-feed lease configuration and idempotency for consumers.

Never infer safe production changes from static examples alone. Require
environment-specific evidence, owner approval, and a tested recovery plan.

Official references:
- SQL Server documentation: https://learn.microsoft.com/sql/sql-server/
- Query Store: https://learn.microsoft.com/sql/relational-databases/performance/monitoring-performance-by-using-the-query-store
- SQL Server security: https://learn.microsoft.com/sql/relational-databases/security/
- Cosmos DB documentation: https://learn.microsoft.com/azure/cosmos-db/
- Cosmos DB partitioning: https://learn.microsoft.com/azure/cosmos-db/partitioning
- Cosmos DB change feed: https://learn.microsoft.com/azure/cosmos-db/change-feed
