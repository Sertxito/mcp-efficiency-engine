---
name: backend-change-example
description: "Example request for a grounded backend change using repository conventions and checks."
---

Implement [user-visible behavior] in the [service/API] in this repository.

First identify the runtime/version, existing architecture, relevant contract,
validation/auth behavior, callers, and the repository's conventions. Keep the
change scoped and compatible. Add regression coverage for success and relevant
failure paths. Run the declared focused build, lint/type checks, and tests.
Report changed files, evidence, exact checks/results, API or data risks, and
anything not verified. Do not call a check passed if it was not run.
