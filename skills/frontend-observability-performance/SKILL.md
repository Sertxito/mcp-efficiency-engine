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

## Browser performance gates
Record LCP, INP and CLS when relevant, including route, build mode, device,
network, viewport, sample window and percentile basis. Separate laboratory
proxies from field interaction evidence; do not equate an obsolete metric or
one Lighthouse score with all Core Web Vitals.
Agree bundle/route and user-visible budgets before optimization. Inspect
resource waterfalls, render-blocking work, hydration, long tasks, image/font
loading, cache behavior and third-party scripts to test the dominant cause.
Avoid blind memoization, lazy-loading critical above-the-fold content or
over-splitting requests into a slower waterfall.
Compare equivalent runs with repeated samples and the shared performance
contract. Check accessibility, SEO and UX tradeoffs, then propose a configured
CI budget or monitoring alert with owner; do not claim it is active until tested.

## Output
Signal specification, privacy constraints, reproducible measurement setup, baseline/comparison evidence, and remaining coverage gaps.

## Safety and limitations
- Do not add tracking or collect user identifiers without explicit approval and a documented privacy basis.
- Lab metrics do not substitute for representative field data; field data does not explain cause by itself.
- Do not claim a performance improvement from incomparable runs or a single noisy sample.
- Treat browser/device coverage and metric attribution limits as explicit.
