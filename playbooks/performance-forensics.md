# Performance forensics

## Scope
Use for a measured user-visible performance objective with a bounded workload
and environment. Confirm test authorization before any load or profiling work.

## Procedure
1. Define objective, workload, environment, time window, and correctness needs.
2. Capture a reproducible baseline and measurement configuration.
3. Correlate application, database, and infrastructure signals; test a
   falsifiable bottleneck hypothesis.
4. Make a bounded authorized change and compare equivalent workloads.
5. Report variance, limits, correctness, and residual risks.

## Outputs
Baseline, bottleneck evidence, measurement record, comparative result, and
unverified scope.

## Safety boundaries
Do not load-test or profile shared/production systems without explicit approval.
Do not claim improvement from incomparable or insufficient samples.
