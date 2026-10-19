---
name: frontend-observability-performance
description: "Instrument frontend user journeys and assess Core Web Vitals with privacy-aware, comparable browser evidence."
---

# Frontend observability and performance

## Use when
- Adding or reviewing frontend telemetry, real-user monitoring, or user-journey signals.
- Investigating Core Web Vitals, bundle cost, navigation latency, or client-side regressions.

## Inputs
- Supported browser/framework versions, critical journeys, existing telemetry, consent/privacy rules, and a comparable test environment.

## Procedure
1. Select user-visible outcomes and the smallest signal set that can diagnose them; identify consent and data-minimization requirements.
2. Trace navigation, resource, interaction, and error signals to their source and correlation identifiers without recording sensitive input.
3. Capture representative Core Web Vitals and bundle/network measurements under a declared device, network, route, and cache profile.
4. Compare like-for-like baseline and candidate runs; segment only where sample size and privacy policy allow.
5. Report measurement variability, thresholds, regressions, and a focused fix/verification proposal.

## Output
Signal specification, privacy constraints, reproducible measurement setup, baseline/comparison evidence, and remaining coverage gaps.

## Safety and limitations
- Do not add tracking or collect user identifiers without explicit approval and a documented privacy basis.
- Lab metrics do not substitute for representative field data; field data does not explain cause by itself.
- Do not claim a performance improvement from incomparable runs or a single noisy sample.
- Treat browser/device coverage and metric attribution limits as explicit.
