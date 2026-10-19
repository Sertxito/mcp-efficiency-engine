# Design and accessibility gate

**Trigger:** New or changed UI components, design tokens, cross-screen behavior,
or a release gate requiring accessibility evidence.

**Lead roles:** UX/accessibility engineer; senior frontend engineer; QA lead.

## Stages
1. Identify the approved design source, relevant tokens/components, journeys,
   supported viewports, and accessibility target.
2. Verify component reuse, semantic structure, states, responsive behavior, and
   traceability from requirement/design to implementation.
3. Run available automated accessibility checks and record tool/scope/results.
4. Manually inspect keyboard operation, focus, names/roles, error handling,
   zoom/reflow, motion, and representative assistive-technology behavior.
5. Record browser/device/assistive-technology coverage, deviations, and findings;
   convert gaps into testable acceptance criteria.

## Outputs
Design-system and requirement trace, automated and manual evidence, prioritized
findings, coverage limits, and release-gate recommendation. Automated checks
alone do not establish conformance.
