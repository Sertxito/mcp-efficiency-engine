---
name: backend-mcp-package-authoring
description: "Build maintainable .NET or Python MCP servers and publishable Python packages with explicit protocol, packaging, and validation contracts."
---

# Backend MCP and package authoring

## Use when
- Creating or updating an MCP server in .NET or Python.
- Preparing a Python package for publication or reviewing package metadata and build artifacts.

## Inputs
- Target runtime/version, protocol/client contract, supported transports, package namespace, license, and distribution requirements.

## Procedure
1. Inspect the selected SDK/runtime versions and verify current official protocol and packaging guidance before choosing APIs.
2. Define tools/resources, input/output schemas, errors, cancellation, logging, and transport behavior; keep tool authority narrow and validate every input.
3. Separate protocol logic from application services; test initialization, capability negotiation, malformed input, failures, and shutdown.
4. For Python packages, verify project metadata, package discovery, included files, license, supported Python range, and reproducible build/install in a clean environment.
5. Run protocol and package checks locally; report the exact artifact contents and client/runtime compatibility tested.

## MCP transport and tool contract
- Inspect the actual Python/.NET SDK version before using FastMCP decorators
  or typed .NET tool APIs. Validate input schemas and structured outputs with
  supported schema/types; annotations alone do not validate runtime input.
- Reserve stdout for protocol frames in stdio mode; send diagnostic logs to
  stderr. Test Unicode, malformed frames, empty/large output and nonzero exits.
- Use explicit lifespan/resource ownership for clients, pools and background
  work. Propagate cancellation/deadlines and report measurable progress, not
  fabricated percentages; close resources on disconnect and shutdown.
- Negotiate capabilities before using progress, elicitation or structured
  output. Denied/unavailable approval must fail closed rather than become
  permission to execute; protocol annotations are not authorization.
- For HTTP transports, verify the configured authentication, origin validation,
  session handling and applicable CORS policy against current protocol guidance.
  Do not weaken host/transport checks merely to make a local demo connect.
- Separate tool registration metadata from installed executables. Test a real
  client/server pair for initialization, schema discovery, invalid input,
  cancellation, reconnect and shutdown; mocks cannot certify interoperability.

## Package artifact contract
Verify source and wheel contents, optional/native dependencies, entry points,
license/notice inclusion and supported platform tags. Build/install into a
clean approved environment and test imports/CLI from the built artifact, not
only the source checkout. Record unsupported platforms (including Windows ARM64
where relevant); never imply a compatible wheel exists without verification.

## Output
Version-aware implementation or review, protocol/package contract, focused tests, build artifact verification, and explicit compatibility limits.

## Safety and limitations
- Do not publish, release, or register servers with a remote host without explicit approval.
- Never expose secrets, arbitrary filesystem access, shell execution, or unrestricted network access through an MCP tool.
- Do not claim package availability or MCP client compatibility without testing the actual built artifact/protocol pair.
- If the SDK or protocol guidance is stale or unavailable, state that and avoid inventing method signatures.
