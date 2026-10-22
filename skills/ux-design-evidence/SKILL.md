---
name: ux-design-evidence
description: "Turn approved design sources and implemented UI into traceable UX specifications, component inventories, and visual evidence."
---

# UX design evidence

## Use when
- Connecting approved Figma or other design sources to implementation review.
- Producing a component inventory, functional-to-UX specification, screenshot report, or Storybook documentation.

## Inputs
- User journey, approved design source, app routes/components, available browser/design integrations, and capture environment.

## Procedure
1. Confirm the authoritative design revision, target journey, viewport/state, and access boundaries.
2. Inventory relevant components and states from source code and approved design evidence; link each mapping to its source.
3. Describe functional behavior, loading/error/empty/success states, responsive behavior, semantics, and accessibility expectations.
4. Capture screenshots only from an approved non-sensitive environment; label route, viewport, state, and build/revision.
5. Compare implementation to approved design intent, document deviations and uncertainty, and update Storybook/component docs only from verified behavior.

## Reviewable handoff
Map each journey requirement to design revision, component/route, interaction
state and acceptance check. Include content/validation rules, responsive/theme
variants, keyboard/focus transitions and unresolved decisions with owners.
For existing Storybook, add fixtures and interaction evidence using its
installed version and project conventions; do not invent a running preview.
Keep screenshots labeled and redacted, distinguish lab/design evidence from
observed user research, and record capture/browser limitations.

## Output
Traceable UX specification, component/state inventory, labeled visual evidence, and prioritized findings or documentation changes.

## Safety and limitations
- Do not access design workspaces, upload screenshots, or transmit assets without the user's authorization and a configured integration.
- Redact personal, customer, and secret data from captures.
- A screenshot cannot prove interaction correctness, accessibility, or responsive coverage by itself.
- If design access is unavailable, report the missing source and assess implementation evidence only.
