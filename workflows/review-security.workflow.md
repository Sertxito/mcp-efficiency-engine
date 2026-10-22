# Review security

1. Define repository/system boundary, changed scope, and review limitations.
2. Trace inputs through trust boundaries, authorization, secrets, data handling,
   dependencies, and privileged operations.
3. Confirm candidate findings with concrete source evidence and a plausible
   threat path; separate hypotheses from confirmed issues.
4. Prioritize severity and confidence; recommend minimal mitigations and
   verification.
5. Report coverage, unreviewed areas, evidence, and unresolved questions.

Include configured dependency/license policy, SBOM/provenance, immutable
artifact/action pins, privileged PR/runner boundaries, secret rotation/
revocation and audit retention when in scope. Verify observed controls and
exceptions with owners; a configuration file does not establish a passing scan.
Reviews do not authorize credential rotation, permission writes or external
uploads of source/manifests.

Do not claim a clean bill of health from partial review or expose secret values.
