Use this guidance only for Angular projects, and first inspect the installed
Angular version and the repository's existing state-management conventions.
Follow project architecture when it intentionally differs.

## Reactive state

1. Prefer signals for component-local and service-owned synchronous reactive
   state when that fits the existing design; do not mechanically replace
   RxJS or other state management.
2. Use `computed()` for values derived from signals. Reach for `linkedSignal()`
   when a value is derived but must also be manually reset or changed, and
   verify that API exists in the project's Angular version.
3. Keep `effect()` for synchronizing signal state with imperative,
   non-reactive APIs. Do not use effects to copy or propagate application
   state when `computed()`, `linkedSignal()`, or a clearer source of truth fits.
4. Keep async streams, cancellation, errors, and teardown explicit; use
   Angular/RxJS interop at clear boundaries rather than maintaining duplicate
   sources of truth.

## Architecture and maintainability

1. Follow the project's feature boundaries, public APIs, dependency-injection
   scopes, routing, and standalone/module conventions.
2. Keep components focused on presentation and interaction; place reusable
   domain behavior and state at the narrowest appropriate service or feature
   boundary.
3. Preserve one-way data flow and explicit ownership of writable state.
   Avoid broad global stores, cross-feature imports, and hidden side effects
   unless the repository's architecture calls for them.
4. Follow the Angular version's official style guidance and local lint rules;
   do not apply newer APIs or migration patterns unsupported by the project.
5. Validate with configured Angular lint, typecheck, unit, and build commands.
   Report absent checks as gaps, not as passed enforcement.

References:
- https://angular.dev/guide/signals
- https://angular.dev/guide/signals/effect
- https://angular.dev/style-guide
