# Performance investigation baseline

## Record before diagnosing
- User-visible objective, numeric acceptance threshold and no-regression budgets.
- Workload/data shape, concurrency, environment/hardware, runtime/build and window.
- Measurement command/tool configuration, warmup, cache state, repeated sample
  count, units, median/tail metrics where meaningful, and dispersion.
- Relevant correctness and resource signals.
- Candidate bottleneck, evidence that would disprove it, and safe test boundary.
- Comparable before/after method and stop/recovery conditions.
- Artifact paths, correctness results, checks not run and measurement limits.
- Pass, fail or inconclusive against the threshold; incomparable data is
  inconclusive, not a speedup.

Never equate a single timing sample or profiler hotspot with a verified user
impact.
