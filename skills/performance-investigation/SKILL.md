---
name: performance-investigation
description: "Investigate and improve application or data-system performance using comparable measurements. Use for latency, throughput, resource, query, rendering, or bundle regressions."
---

# Performance investigation

## Procedure
1. Define the user-visible or system-level performance objective, workload,
   environment, and relevant constraints before choosing a metric.
2. Capture a reproducible baseline with available project-approved profilers,
   traces, query plans, browser measurements, or resource metrics.
3. Use evidence to locate the dominant bottleneck; distinguish measurement
   noise, environmental variance, and correlation from a demonstrated cause.
4. Make the smallest targeted optimization that preserves behavior, security,
   reliability, and resource limits.
5. Repeat the measurement under comparable conditions and run relevant
   correctness/regression checks; report the result and any limitations.

## Safety
Do not claim improvement without before/after evidence. Do not run load tests,
expensive queries, production profilers, or infrastructure changes against
shared or production systems without explicit approval. Avoid premature
optimization and changes that trade correctness or security for speed.

## Output
Objective and workload, baseline and measurement method, identified bottleneck,
change made or recommended, comparable before/after evidence, and residual risk.
