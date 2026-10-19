---
name: <skill-folder-name>
description: "<Task phrases and situations that should trigger this skill.>"
---

# <Skill title>

## Use when
- <Specific task, change, or decision.>

## Inputs
- <Required project context, evidence, or approvals; state optional inputs.>

## Procedure
1. <Inspect the project source of truth and confirm scope.>
2. <Follow the task-specific analysis or change method.>
3. <Handle uncertainty, errors, and approval boundaries explicitly.>
4. <Validate the requested behavior and report exact evidence.>

## Output
<Observable artifact or decision proposal, evidence, validation status, coverage
limits, and next owner.>

## Safety and limitations
- <State unavailable tools/data and what the skill must not infer.>
- <Require specific approval for external, destructive, production, or data-transfer actions.>

<!--
Optional skill bundle layout; create only items the procedure actually needs:
<skill-folder>/
  SKILL.md
  references/   Stable reference material loaded when needed
  assets/       Templates, examples, or other reusable input files
  scripts/      Deterministic helpers with documented inputs and outputs
  evals/        Representative cases and expected behavior
-->
