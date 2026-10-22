---
name: frontend-modernization-review
description: "Evaluate Angular/React production readiness, microfrontend boundaries, and incremental frontend modernization from project evidence."
---

# Frontend modernization review

## Use when
- Reviewing a production Angular or React change against the project's actual framework version.
- Deciding whether microfrontends or a frontend modernization are justified.
- Planning an incremental move from a legacy frontend.

## Inputs
- Framework/runtime versions, user journeys, deployment topology, team boundaries, bundle/runtime measurements, and current pain evidence.

## Procedure
1. Identify framework/version, application boundaries, deployment model, consumers, and relevant production evidence.
2. Review route/state/error handling, security boundaries, accessibility, dependency lifecycle, and release compatibility for the affected user journey.
3. For microfrontend proposals, compare a modular monolith/current architecture and other proportionate options against independent release need, ownership, runtime coupling, and operational cost.
4. For modernization, define an incremental slice with compatibility boundaries, measurable outcomes, fallback, and retirement criteria for legacy code.
5. Validate with project-supported checks and representative browser evidence; state unsupported versions and untested devices explicitly.

## Distributed frontend contracts
For microfrontends, identify shell/remotes, route and authentication ownership,
shared dependency/version policy, isolation and runtime integration contracts.
Verify independently deployed combinations, remote unavailability, timeout/
fallback behavior, cross-app navigation and observability. Define compatible
rollout/rollback and ownership before assuming independent delivery is beneficial.
Do not create duplicate global state or rely on one application's authorization
guard to protect a different backend.

## Incremental migration
Inventory deprecated APIs, browser support, SSR/hydration, routing and state
semantics. Prove one reversible user journey with existing tests and production
build before extending the migration. Keep SEO/accessibility and error/loading
behavior observable; a compile pass does not establish production parity.
For other detected frameworks, apply the cross-framework procedure but verify
their actual APIs; do not label Angular/React advice as Vue-specific coverage.

## Output
Version-aware production findings, architecture trade-offs, an incremental option, measurable acceptance checks, and unresolved decisions.

## Safety and limitations
- Do not recommend microfrontends, rewrites, or framework upgrades from fashion or labels alone.
- Do not claim production readiness without production-relevant evidence and explicit scope.
- Avoid changing public routes, state contracts, or deployment boundaries without the owning role's approval.
- Verify framework APIs against current official guidance for the detected version.
