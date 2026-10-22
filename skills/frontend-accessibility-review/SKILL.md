---
name: frontend-accessibility-review
description: "Review frontend interaction and accessibility. Use for UI changes, keyboard behavior, screen-reader semantics, responsive states, or accessibility defects."
---

# Frontend accessibility review

## Procedure
1. Identify user journey, supported interaction modes, and expected states.
2. Prefer native semantic HTML; use ARIA only when native semantics cannot express
   the required interaction.
3. Check accessible names/roles, keyboard-only operation, tab order, focus
   visibility/management, and understandable validation/errors.
4. Check contrast against the project's target, zoom/reflow, motion preferences,
   responsive behavior, and touch-target usability where applicable.
5. Run available automated checks and manual keyboard/screen-reader/browser
   checks; report evidence and coverage separately.
6. Convert findings into reproducible acceptance criteria for frontend and QA.

## Interaction patterns
Verify applicable dialog focus entry/trapping/return, menu/listbox/tab keyboard
models, live-region announcements, form error association and route-change
focus. Do not add roles without implementing the required behavior.
Use the project's actual accessibility target and supported browser/assistive
technology combinations; record automatic versus manual results separately.
Respect reduced motion and zoom/reflow while preserving loading, disabled and
error feedback. Give each barrier a reproducible journey, impact, owner and
retest criterion instead of a generic checklist score.

## Output
Affected journey, findings with evidence/severity, automated versus manual checks,
browser/assistive-technology coverage limits, and recommended acceptance criteria.
Do not claim WCAG conformance from an automated scan or partial manual review.
