---
name: frontend-change-review
description: "Review frontend changes for behavior, state coverage, accessibility, security, performance, and browser regressions. Use for UI pull requests or client-side changes."
---

# Frontend change review

## Procedure
1. Trace requirements to changed components, routes, API contracts, and user journeys.
2. Check loading, success, empty, error, offline, and permission states where applicable.
3. Review state transitions, navigation, data exposure, and input handling.
4. Check semantic/accessibility requirements and responsive/browser coverage.
5. Inspect rendering, asset/bundle, and client performance risk when relevant.
6. Separate automated results from manual browser/assistive-technology observations.

## Output
Prioritized findings with evidence, affected journey, checks/results, browser/device
coverage, performance/security concerns, and untested states. Complement the
dedicated accessibility review rather than repeating its full checklist.
