---
name: dotnet-legacy-runtime
description: "Assess .NET time-zone correctness and containerization paths for legacy ASP.NET Framework applications."
---

# .NET legacy runtime

## Use when
- Reviewing time-zone handling in .NET services or scheduled jobs.
- Evaluating whether a legacy ASP.NET Framework application can be containerized or needs an intermediate modernization step.

## Inputs
- Target framework and runtime, operating system/container base, supported regions, time-zone identifiers, and deployment constraints.

## Procedure
1. Identify framework/runtime, OS, globalization settings, time-zone database source, and the source of each timestamp.
2. Distinguish UTC instants from local civil times; test daylight-saving transitions, ambiguous/nonexistent local times, and serialization contracts.
3. For legacy containerization, inventory native dependencies, IIS/System.Web assumptions, authentication, storage, health checks, and supported Windows/Linux container constraints.
4. Compare supported hosting/container options using official lifecycle and compatibility evidence; define one representative build/run slice.
5. Verify behavior in the actual target image/runtime and report unsupported dependencies, lifecycle constraints, and migration steps.

## Output
Time-zone risk findings or a container compatibility matrix, test cases, selected next step, and evidence/unknowns.

## Safety and limitations
- Do not silently change time-zone identifiers, persisted timestamps, or public date/time semantics.
- Do not assume a legacy .NET Framework application runs on Linux or an arbitrary container base.
- Do not deploy or publish an image without approval.
- Verify support dates and platform constraints from current official sources.
