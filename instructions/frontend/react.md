# React engineering

**Scope:** React components, hooks, client state and rendering boundaries.
**Version boundary:** inspect React, router, framework, bundler and SSR/server
component configuration; do not assume experimental or latest-release APIs.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Keep render pure and state updates immutable. Use stable semantic keys;
  preserve component identity where state should survive.
- Derive values during render where possible. Use effects to synchronize with
  external systems, with correct dependencies and cleanup, not to mirror state.
- Follow hook rules; factor focused hooks around actual reuse and ownership.
  Avoid stale closures, request races and state updates after cancellation.
- Keep state near its owner; use the established data-fetching, form and state
  libraries rather than adding a parallel framework for a small feature.
- Distinguish server/client code and never expose server credentials in bundles.
  Preserve hydration output and established error/suspense boundaries.
- Cover loading, empty, failure and permission states with semantic HTML,
  accessible controls, labels, focus management and keyboard interaction.
- Avoid premature useMemo/useCallback/memo; identity stability is not proof that
  rendering is faster. Do not remove dependency checks to silence warnings.

## State, identity and effects
- Call hooks at the top level of components/custom hooks according to the
  installed React rules; do not invoke components as ordinary functions or
  define component types inside render and accidentally reset their state.
- Treat state as a render snapshot. Use functional updates when deriving from
  previous state, and do not read a just-set value as if state updates were
  synchronous assignments. Keep controlled/uncontrolled inputs consistent.
- Preserve stable keys and intentionally reset state only when identity changes.
  Do not duplicate props in state without a clear independent editing contract.
- Effects must tolerate setup/cleanup cycles and dependency changes; unsubscribe
  and abort/ignore stale work. Strict Mode exposing duplicate effects is evidence
  to fix ownership, not a reason to disable it.
- Use the framework's established loaders/cache/mutation boundaries to avoid
  waterfalls and duplicate fetches. Keep request/user state isolated on servers
  and route failures to appropriate error UI; an error boundary does not handle
  every asynchronous callback failure.
- Prefer semantic forms and user-observable tests, including focus, pending
  submission, recovery and optimistic-update failure behavior when applicable.

## Verification and performance
Test user-observable behavior, error paths and lifecycle cleanup with existing
tools. Run hooks lint, typecheck and production build; verify browser flows.
Use React Profiler and browser traces to attribute rerenders, commits, main
thread stalls, request waterfalls and bundle cost. Compare representative
interactions in equivalent builds/devices before claiming a speedup.

Official references:
- https://react.dev/learn
- https://react.dev/learn/you-might-not-need-an-effect
- https://react.dev/reference/react/Profiler
- https://react.dev/reference/rules
- https://www.w3.org/WAI/ARIA/apg/
