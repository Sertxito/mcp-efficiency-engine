# Performance investigation baseline

## Record before diagnosing
- User-visible objective, workload shape, environment, version, and window.
- Measurement tool, configuration, sample count, and baseline distribution.
- Relevant correctness and resource signals.
- Candidate bottleneck, evidence that would disprove it, and safe test boundary.
- Comparable before/after method and stop/recovery conditions.

Never equate a single timing sample or profiler hotspot with a verified user
impact.
