# Angular engineering

**Scope:** Angular components, templates, routing, forms and client state.
**Version boundary:** inspect Angular/RxJS versions, builder, SSR/hydration,
zone configuration and tests; adopt APIs only when supported by that project.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Follow feature boundaries and existing standalone/NgModule architecture;
  do not migrate architecture as a side effect of a feature change.
- Keep templates and components cohesive. Use typed inputs/outputs and forms;
  avoid computation-heavy template expressions and hidden mutation.
- Use computed state for derivation. Reserve effects for external/imperative
  synchronization, not mirroring state; signals do not replace every RxJS stream.
- Manage subscription lifetime through supported framework mechanisms such as
  async pipe or takeUntilDestroyed. Select stream operators deliberately;
  handle cancellation, races and errors without stale UI updates.
- Respect DI scopes, lazy routes, permission checks and server authorization.
  Avoid unsafe HTML bypasses; client guards are not access-control enforcement.
- Cover loading, empty, error, success and disabled states. Use semantic HTML,
  labels, focus handling and keyboard navigation rather than ARIA as decoration.
- Preserve SSR/browser separation, hydration consistency, i18n and responsive
  behavior when applicable. Never assume window/document exist on the server.

## State, forms and component contracts
- Read signals in their intended reactive context; update owned state through
  supported APIs and compute derived values without hidden mutation. Do not
  maintain the same value in a signal, form control and subject without a clear
  source of truth. Preserve observable cancellation/debounce semantics.
- Use stable identity when tracking rendered lists. Keep input/output ownership
  explicit, and use APIs supported by the installed version rather than copying
  latest standalone, signal-input, forms or change-detection defaults.
- Choose form validation and submission behavior from the existing form model.
  Expose touched/pending/error states accessibly, prevent duplicate submissions
  and handle server validation; client validators do not authorize operations.
- Keep services cohesive. Root, route and component providers have different
  lifetimes; a root service must not hold request/user-specific mutable state
  across SSR requests. Resolve platform-specific behavior at a clear boundary.
- Preserve lazy feature boundaries and avoid heavy eager imports. Test route
  parameters, navigation cancellation, failed requests and stale-response races.
  Mock HTTP at the intended boundary, not by bypassing all framework behavior.

## Verification and performance
Run declared unit/component/integration checks, template/type checks and
production build. Verify keyboard/focus and responsive flows in a browser.
Use Angular DevTools and browser performance traces for change-detection,
rendering, network waterfalls and bundle/lazy-route evidence. Establish a
representative device/workload and user-visible budget before changing state,
memoization, change-detection strategy or loading behavior.

Official references:
- https://angular.dev/style-guide
- https://angular.dev/guide/signals
- https://angular.dev/guide/components/lifecycle
- https://angular.dev/tools/devtools
- https://angular.dev/ai/develop-with-ai
- https://www.w3.org/WAI/ARIA/apg/
