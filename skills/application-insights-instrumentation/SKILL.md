---
name: application-insights-instrumentation
description: "Instrument Azure applications with Application Insights while preserving privacy, sampling, correlation, and operational signal quality."
---

# Application Insights instrumentation

## Use when
- Adding or reviewing Application Insights telemetry for .NET, Node.js, or another supported application.
- Defining traces, metrics, dependencies, availability checks, or distributed correlation.

## Inputs
- Application framework and version, hosting model, existing telemetry configuration, data classification, and operational questions.

## Procedure
1. Inspect existing SDK, hosting, deployment, and configuration versions; verify current setup guidance for the detected stack.
2. Map user and service outcomes to a small set of actionable signals, including dependency and failure context.
3. Configure correlation and sampling consistently across services; keep instrumentation and connection configuration environment-specific.
4. Exclude secrets, credentials, request bodies, and unnecessary personal data. Define redaction and retention constraints before emitting custom dimensions.
5. Validate telemetry in a local/test environment, confirm expected events and correlation, and test the no-telemetry or exporter-failure path.

## Output
Version-aware instrumentation change or proposal, privacy review, expected signal examples, validation evidence, and unverified deployment assumptions.

## Safety and limitations
- Do not emit production data to an unapproved workspace or add remote telemetry without explicit approval.
- Never hard-code an instrumentation key or connection string; use the project's approved secret/configuration mechanism.
- Do not claim observability coverage from SDK installation alone; verify actual signal flow and usefulness.
- If framework-specific current guidance is unavailable, state the uncertainty and avoid inventing APIs.
