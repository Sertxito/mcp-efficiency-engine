---
name: observability-design
description: "Define useful metrics, logs, traces, dashboards, and alerts. Use for new services, production readiness, diagnosis gaps, or alert/dashboard changes."
---

# Observability design

## Procedure
1. Map user-visible service outcomes and critical dependencies.
2. Define SLIs and signals with units, dimensions, owners, and time windows.
3. Add correlation and diagnostic context while excluding sensitive payloads.
4. Tie each alert to an action, severity, runbook, and tested threshold.
5. Verify query cost, cardinality, retention, and external data destinations.

## Output
Signal contract, dashboard/alert intent, queries or instrumentation changes,
privacy considerations, owners, and validation evidence.
