---
name: performance-investigation
description: "Investigate and improve application or data-system performance using comparable measurements. Use for latency, throughput, resource, query, rendering, or bundle regressions."
---

# Performance investigation

## Procedure
1. Define the user-visible or system-level performance objective, workload,
   environment, and relevant constraints before choosing a metric. Record a
   numeric acceptance threshold with units and a no-regression budget; if
   unknown, obtain them or explicitly label the work exploratory.
2. Capture a reproducible baseline with available project-approved profilers,
   traces, query plans, browser measurements, or resource metrics. Record the
   command/configuration, build/runtime, dataset size/shape, concurrency, hardware,
   warmup, sample count and cache state. Use repeated samples; report median,
   tail latency when meaningful, and dispersion. Do not invent percentiles
   from insufficient samples.
3. Use evidence to locate the dominant bottleneck; distinguish measurement
   noise, environmental variance, and correlation from a demonstrated cause.
   State a falsifiable hypothesis and one bounded experiment; identify whether
   CPU, allocation/GC, I/O, contention, rendering or a dependency dominates.
4. Make the smallest targeted optimization that preserves behavior, security,
   reliability, and resource limits.
5. Repeat the measurement under comparable conditions and run relevant
   correctness/regression checks; report the result and any limitations.
   Report pass, fail or inconclusive against the agreed threshold. Changed
   environment/workload or excessive variance makes the comparison inconclusive,
   not an improvement. Check resource/cost and reliability tradeoffs too.

## Select evidence by stack
Use existing installed, project-approved tools, never auto-install a profiler.
- C#/.NET: counters/traces for CPU, allocations, GC, thread-pool and waits;
  inspect database calls separately from application CPU.
- Python: CPU/call profiling, Python allocation tracing and async blocking;
  native allocations and RSS need separate interpretation.
- Node.js: CPU/heap profiles, event-loop delay, backpressure and queue depth.
- Angular/React: framework profiler plus browser main-thread, rendering,
  network waterfalls and production bundle evidence on representative devices.
- SQL: engine/version, parameter distribution, plans, cardinality, reads,
  spills, waits and locks; an actual plan executes the statement.
- Cosmos DB: RU/request, key distribution, fan-out, throttling and latency.
Correlate signals across boundaries; do not optimize the layer that is easiest
to edit if the measured bottleneck is elsewhere.

## Safety
Do not claim improvement without before/after evidence. Do not run load tests,
expensive queries, production profilers, or infrastructure changes against
shared or production systems without explicit approval. Avoid premature
optimization and changes that trade correctness or security for speed.
Approval must cover the exact environment, command, duration/load cap and stop
conditions. Do not collect secret payloads or unredacted production profiles.
If measurement access or approval is missing, stop at a proposed experiment
and report the missing evidence; recommendations are not measured results.

## Output
Use these labeled sections: `Objective:`, `Acceptance threshold:`, `Workload:`,
`Baseline:`, `Hypothesis:`, `Experiment:`, `Before/after:`, `Correctness:`,
`Measurement limits:`, `Outcome:`, and `Residual risks:`.
Include measurement artifact paths, units, samples and dispersion; distinguish
observed results from proposed commands and explicitly list checks not run.
