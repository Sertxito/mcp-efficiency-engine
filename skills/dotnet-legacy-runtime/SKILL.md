---
name: dotnet-legacy-runtime
description: "Assess .NET time-zone correctness, supported upgrades, desktop UI constraints and legacy ASP.NET Framework containerization."
---

# .NET legacy runtime

## Use when
- Reviewing time-zone handling in .NET services or scheduled jobs.
- Evaluating whether a legacy ASP.NET Framework application can be containerized or needs an intermediate modernization step.
- Planning a supported .NET upgrade or reviewing existing WPF/MAUI/Razor code.

## Inputs
- Target framework and runtime, operating system/container base, supported regions, time-zone identifiers, and deployment constraints.

## Procedure
1. Identify framework/runtime, OS, globalization settings, time-zone database source, and the source of each timestamp.
2. Distinguish UTC instants from local civil times; test daylight-saving transitions, ambiguous/nonexistent local times, and serialization contracts.
3. For legacy containerization, inventory native dependencies, IIS/System.Web assumptions, authentication, storage, health checks, and supported Windows/Linux container constraints.
4. Compare supported hosting/container options using official lifecycle and compatibility evidence; define one representative build/run slice.
5. Verify behavior in the actual target image/runtime and report unsupported dependencies, lifecycle constraints, and migration steps.

## Upgrade and UI boundaries
Inventory project targets, SDK/analyzers, package/native dependencies, hosting,
authentication and deployment OS before selecting a supported intermediate or
target release. Preserve minimum support and public contracts; prove one build/
test/run slice before a broad migration, with explicit rollback/forward limits.
For existing WPF/MAUI code, follow the established MVVM/binding conventions,
UI-thread dispatch, command cancellation, resource lifetime and platform-specific
accessibility/lifecycle checks. Do not infer desktop compatibility from a service
unit test or prescribe a cross-platform rewrite automatically.
For Razor/ASP.NET UI, preserve server/client validation, output encoding,
anti-forgery/authentication and navigation/error contracts in integration tests.

## Output
Time-zone risk findings or a container compatibility matrix, test cases, selected next step, and evidence/unknowns.

## Safety and limitations
- Do not silently change time-zone identifiers, persisted timestamps, or public date/time semantics.
- Do not assume a legacy .NET Framework application runs on Linux or an arbitrary container base.
- Do not deploy or publish an image without approval.
- Verify support dates and platform constraints from current official sources.
