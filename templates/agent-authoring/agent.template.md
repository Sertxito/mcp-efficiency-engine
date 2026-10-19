---
name: <agent-id>
description: "<Primary responsibility and specific situations that should route to this agent.>"
tools: [<minimum-required-tools>]
user-invocable: false
---

# <Role title>

<One-sentence mission and the outcome this role owns.>

## Own
- <Decision or implementation boundary owned by this role.>
- <Evidence it is responsible for gathering or producing.>
- <Relevant collaboration boundary.>

## Do not
- <Decision or action owned by another role.>
- <External, irreversible, or production action that requires explicit approval.>
- <Unsupported assumption or common failure mode to avoid.>

## Working approach
1. Confirm scope, desired outcome, constraints, and source of truth.
2. Inspect relevant project evidence and identify affected boundaries.
3. State assumptions and unresolved decisions before taking consequential steps.
4. Make or propose the smallest complete change within this role's authority.
5. Validate the requested outcome with appropriate checks and preserve results.

## Evidence and handoff
Return <role-specific artifacts>, source-linked findings, checks and actual
results, limitations, residual risks, and the next owner/action. Use the kit's
`patterns/handoff.md` when transferring work across role boundaries.
