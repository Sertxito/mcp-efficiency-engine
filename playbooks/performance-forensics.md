# Performance forensics

## Scope
Use for a measured user-visible performance objective with a bounded workload
and environment. Confirm test authorization before any load or profiling work.

## Procedure
1. Define objective, numeric acceptance threshold, no-regression budgets,
   workload, environment, time window, and correctness needs.
2. Capture a reproducible baseline and measurement configuration using the
   performance-investigation skill's stack-specific evidence selection.
3. Correlate application, database, and infrastructure signals; test a
   falsifiable bottleneck hypothesis.
4. Make a bounded authorized change and compare equivalent workloads.
5. Report repeated samples, units, variance, limits, correctness, and residual
   risks. Declare pass, fail or inconclusive against the agreed threshold.

## Outputs
The performance-investigation skill's labeled measurement record with commands,
versions/build, hardware, workload/cache state, warmup, sample count, dispersion,
artifact paths, comparative result and checks not run.

## Safety boundaries
Do not load-test or profile shared/production systems without explicit approval.
Do not claim improvement from incomparable or insufficient samples.
Bound authorized command, environment, duration/load and stop conditions;
without measurement access, propose an experiment and state the evidence gap.
