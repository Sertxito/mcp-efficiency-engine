# Investigate performance

1. Define the user-visible objective, workload, environment, window, and
   constraints, numeric acceptance threshold and no-regression budgets. Label
   exploratory work explicitly if no acceptance threshold has been agreed.
2. Capture a reproducible baseline using approved stack-appropriate tools;
   record command, versions/build, hardware, dataset, concurrency, cache state,
   warmup, sample count, units, median/tail metrics and dispersion.
3. Correlate application, data, and infrastructure evidence; test bottleneck
   hypotheses rather than optimizing by intuition.
4. Make a bounded change only when authorized; compare equivalent workloads and
   verify correctness and resource/cost tradeoffs. Keep before/after environment
   and workload comparable; do not infer improvement from a single run.
5. Report the performance-investigation skill's labeled evidence record,
   including acceptance threshold, artifact paths, checks not run and a pass,
   fail or inconclusive outcome. Incomparable/noisy data is inconclusive.

Do not run disruptive load or profiling against shared/production systems
without explicit approval.
Approval must bound the exact command, environment, duration/load and stop
conditions. Without access or approval, deliver the proposed experiment and
missing evidence instead of an unmeasured optimization claim.
