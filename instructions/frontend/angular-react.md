# Frontend engineering: Angular and React

**Scope:** Angular/React application architecture, state, accessibility, and
validation. **Version boundary:** framework and API support follows the
project's installed versions; this guide does not certify a specific release.
**References checked:** 2026-10-12 (HTTP reachability only, not a review of
every page's technical content).

Determine the framework and version from the project. Preserve the existing
state-management, routing, styling, and test architecture unless a deliberate
migration is in scope. Verify version-specific APIs in official documentation.

## Angular

- Prefer standalone components in projects using that architecture; follow
  existing feature boundaries, lazy routes, dependency injection, and
  functional guards/interceptors where supported by the installed version.
- Use signals for suitable synchronous reactive state, `computed()` for
  derivation, and `linkedSignal()` only when supported and appropriate.
- Reserve `effect()` for imperative synchronization; do not use it to mirror
  or propagate derived state.
- Keep components cohesive, async subscriptions managed, and loading/error/
  empty/accessibility states covered.

## React

- Prefer function components, composition, and focused custom hooks aligned
  with the existing data-fetching and form libraries.
- Keep effects for synchronization with external systems, not for values
  derivable during render. Avoid premature memoization and global state.
- Preserve stable component boundaries, accessible semantics, and explicit
  loading/error/empty behavior.

For both frameworks, verify accessibility (including keyboard operation),
responsive behavior, security, performance, and project-declared lint,
typecheck, tests, and production build.

Official references:
- Angular style guide: https://angular.dev/style-guide
- Angular signals: https://angular.dev/guide/signals
- Angular effects: https://angular.dev/guide/signals/effect
- React: https://react.dev/learn
- React effects: https://react.dev/learn/synchronizing-with-effects
- WAI-ARIA Authoring Practices: https://www.w3.org/WAI/ARIA/apg/
