---
name: design-system-governance
description: "Review design tokens, component reuse, visual consistency, responsive behavior, and design-to-code traceability. Use for design-system changes, new components, or cross-screen UI work."
---

# Design-system governance

## Procedure
1. Identify the source of truth for tokens, components, design artifacts, and supported themes.
2. Inventory existing components and patterns before proposing new ones.
3. Check reuse, variants, naming, states, responsive rules, and token consistency.
4. Map design requirements to implementation and acceptance evidence.
5. Note deviations, accessibility impact, and the owner of unresolved design decisions.

## Tokens and component lifecycle
Keep CSS/SCSS selectors local and predictable; use existing layers, tokens and
layout primitives instead of specificity escalation or blanket !important.
Check theme inheritance, focus/contrast, zoom/reflow and reduced motion across
Angular, React and Vue styling boundaries; CSS scoping is not a security boundary.
Distinguish primitive, semantic and component tokens; record the authoritative
design revision and code package/version, supported themes, contrast target,
responsive scales and generated CSS/SCSS/Tailwind outputs when already used.
Change the source of truth, not only generated output. Review token diffs,
aliases, deprecations, consumers and compatible rollout; generation is not
approval of a design decision.
Use existing Storybook or component documentation to exercise real variants
and loading/empty/error/disabled/focus states with synthetic fixtures. Include
interaction/accessibility checks and visual regression where configured.
Review image diffs at named viewport/theme/build; do not blindly approve
baseline updates or infer interaction correctness from matching pixels.
If Figma/other design integration is absent, link the missing evidence instead
of inventing token synchronization. Import/upload and remote writes require
their own approval; do not install a connector just because a boost named one.

## Output
Relevant tokens/components, reuse decision, design-to-code traceability, responsive
and state coverage, deviations, and reviewable recommendations. Do not invent
design tokens or represent an unverified mock as approved design.
