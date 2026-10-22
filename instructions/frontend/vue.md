# Vue engineering and component styling

**Scope:** Vue single-file components and related client code; apply Nuxt
server/client rules only when that framework is actually present.
**Version boundary:** inspect Vue/Nuxt, router, state library and build versions;
preserve the existing Options/Composition API conventions and supported targets.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Preserve one-way data flow with explicit typed props/emits where supported.
  Do not mutate parent props or duplicate state without an ownership reason.
- Use computed values for derivation and watchers for deliberate external
  synchronization; handle async races, cancellation and lifecycle cleanup.
- Keep components/co-located styles cohesive, follow existing composables and
  token conventions and use stable semantic list keys.
- Understand scoped-style boundaries, CSS custom property inheritance and
  global resets. Avoid deep/global selectors that accidentally change another
  component; justify and test any supported escape hatch.
- Use semantic HTML, accessible names, focus/keyboard behavior and explicit
  loading/empty/error/disabled states; styling alone cannot make a widget usable.
- Preserve SSR/hydration and server/client boundaries when relevant. Do not
  access browser globals during server render or expose server configuration.

## Reactivity and component contracts
- Understand ref versus reactive identity and the installed version's prop
  destructuring behavior. Do not lose reactive access by copying a primitive
  out of a proxy and assuming the copy stays live.
- Keep computed getters pure. Select watch/watchEffect and their dependencies
  deliberately; register cleanup using APIs supported by the installed version
  and avoid deep watching a large object to hide unclear ownership.
- Keep composables' inputs, returned reactive state and teardown explicit.
  Avoid module-global mutable user state shared across SSR requests.
- Validate prop/emitted event and v-model contracts; avoid direct prop mutation,
  unstable list keys and unsafe v-html for untrusted content.
- Use the configured router/Nuxt data-loading boundaries to prevent duplicate
  server/client requests and hydration mismatches. Handle pending, not-found,
  forbidden and failed navigation states explicitly.

## Verification and performance
Run the installed template/type/lint checks, tests and production build. Verify
component variants, themes, responsive behavior and keyboard journeys.
Use existing browser/framework tools to measure render/network/bundle behavior
under declared workloads; keep memoization, lazy loading and state rewrites
evidence-led. No specific version or browser is certified by this guide.

Official references:
- https://vuejs.org/guide/introduction.html
- https://vuejs.org/api/sfc-css-features.html
- https://vuejs.org/guide/best-practices/accessibility.html
- https://vuejs.org/guide/essentials/reactivity-fundamentals.html
