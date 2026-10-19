# Azure engineering guidance

**Scope:** Azure architecture, identity, Functions, Bicep, Pipelines, and
Cosmos DB. **Version boundary:** service, region, API, SDK, and runtime
availability are workload-specific and are not certified by this guide;
validate the target combination in the project and official docs.
**References checked:** 2026-10-12 (HTTP reachability only, not a review of
every page's technical content).

Use the project's declared architecture and SDK versions as the authority. For
uncertain or version-sensitive details, consult the linked Microsoft Learn
pages, verify their applicability to the target service/region/runtime, and
cite the source used.

- Prefer managed identity and least-privilege RBAC over embedded credentials.
- For new .NET Azure Functions, verify the currently supported isolated-worker
  model and runtime support before changing the hosting model; do not assume
  legacy in-process guidance applies.
- For Bicep, prefer typed parameters, verified modules, explicit API versions,
  secure parameters, and `what-if` validation before an approved deployment.
- For Azure Pipelines YAML, use templates and parameters for repeated logic,
  pin/limit permissions and service connections, and never echo secrets.
- For Cosmos DB, inspect partition key, request-unit cost, consistency,
  indexing, and region requirements before changing query or data design.
- Make identity, networking, observability, availability, cost, deployment,
  and recovery constraints explicit in architecture proposals.
- Run the repository's declared Bicep/Terraform, YAML, build, and test checks;
  report unavailable checks rather than implying enforcement.

Official references:
- Azure Well-Architected Framework: https://learn.microsoft.com/azure/well-architected/
- Azure Functions .NET isolated worker: https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide
- Bicep best practices: https://learn.microsoft.com/azure/azure-resource-manager/bicep/best-practices
- Azure Pipelines YAML schema: https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/
- Managed identities: https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/overview
- Cosmos DB partitioning: https://learn.microsoft.com/azure/cosmos-db/partitioning
- Azure Cosmos DB design: https://learn.microsoft.com/azure/cosmos-db/
