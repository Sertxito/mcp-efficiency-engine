---
name: database-test-data-protection
description: "Create privacy-safe database test fixtures through synthetic data or validated anonymization."
---

# Database test-data protection

## Use when
- Preparing database fixtures, masked copies, or synthetic datasets for testing.
- Reviewing whether a test-data workflow exposes sensitive or re-identifiable records.

## Inputs
- Source schema, data classification, test purpose, permitted environment, and applicable privacy constraints.

## Procedure
1. Identify sensitive columns, indirect identifiers, relationships, and data-dependent constraints from schema and approved policy.
2. Prefer deterministic synthetic data that preserves required distributions and relationships without copying real records.
3. If anonymization is explicitly authorized, define transformations per field and test uniqueness, referential integrity, and re-identification risk.
4. Limit samples and access; ensure logs, snapshots, exports, and fixtures do not retain raw values.
5. Validate the dataset against schema constraints and representative test cases, then record the method and residual risks.

## Output
Data-generation or anonymization specification, integrity checks, privacy limitations, and approval/evidence record.

## Safety and limitations
- Do not access, export, or include real sensitive records unless explicitly authorized for the exact environment and purpose.
- Masking a few direct identifiers does not establish anonymization.
- Do not put secrets or personal data in source control, prompts, logs, or generated reports.
- If data classification or policy is unknown, stop before processing records and request an approved synthetic fixture or policy decision.
