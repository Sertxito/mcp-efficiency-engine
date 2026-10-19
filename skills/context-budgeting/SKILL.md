---
name: context-budgeting
description: "Minimize agent context while preserving task-critical evidence, source traceability, and uncertainty."
---

# Context budgeting

## Use when
- Selecting repository or provider context for an agent task.
- Reducing prompt/token use, choosing a context window, or deciding whether to summarize or retrieve more evidence.

## Inputs
- User objective, acceptance criteria, relevant task history, source repositories, available context/retrieval tools, and any token budget.

## Procedure
1. Convert the request into a short intent, required output, constraints, and unresolved decisions.
2. Retrieve only files and evidence that can affect those outcomes; prioritize authoritative, current sources and use narrow excerpts with path/line provenance.
3. Keep exact identifiers, code, errors, and safety constraints verbatim when changing them would lose correctness; summarize repeated background with explicit source links.
4. Remove unrelated history and duplicate context; preserve uncertainty, conflicting evidence, and tool limitations rather than smoothing them away.
5. Check that the reduced context still supports every acceptance criterion; retrieve more evidence when a claim or decision lacks support.

## Output
A compact context package with objective, constraints, relevant evidence/provenance, required actions, unknowns, and an explicit budget or stopping condition when one exists.

## Safety and limitations
- Never remove a safety boundary, approval requirement, or contradiction merely to meet a token target.
- Summaries are navigation aids, not substitutes for source evidence where exact behavior matters.
- Do not assume provider/model context-window sizes; verify current limits for the selected model.
- Report when the available budget cannot support the requested analysis instead of implying complete coverage.
