# Evaluation case: <stable-case-id>

- **Asset under test:** <agent, skill, or workflow ID and revision>
- **Scenario:** <Representative user request and relevant project context>
- **Setup:** <Available/missing tools, evidence, files, and permissions>
- **Expected behavior:** <Required steps, evidence, output shape, and decisions>
- **Forbidden behavior:** <Unsafe actions, unsupported claims, or boundary violations>
- **Approval boundary:** <Exact action that must request approval, if applicable>
- **Validation oracle:** <Observable assertions or reviewer rubric>
- **Observed result:** <What happened; link evidence>
- **Outcome:** pass | fail | blocked | not run
- **Coverage gap / follow-up:** <...>

Keep cases deterministic where possible. A passing case supports only the behavior
it exercised; it is not proof that the asset is safe or correct in all contexts.
