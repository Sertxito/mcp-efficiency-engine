# Deliver frontend change

1. Establish review/change intent, framework version, local conventions and user journey.
2. Trace input/output contracts, state ownership, effects, subscriptions, cleanup,
   asynchronous ordering and accessibility through actual source.
3. Plan a bounded correction or vertical slice and meaningful regression evidence.
4. In review mode, report findings only. For approved implementation, preserve
   compatible behavior and avoid introducing APIs unavailable in the pinned version.
5. Check normal, loading, empty, error, cancellation and stale-response behavior.
   Run available focused tests and browser/accessibility checks; mark unrun checks.
6. Document source-linked findings or changed artifacts and exact results. Observe
   regressions and propose learning without automatically persisting it.

Do not equate static inspection with browser validation, or an audit request with
permission to rewrite the UI, install packages or execute commands.
