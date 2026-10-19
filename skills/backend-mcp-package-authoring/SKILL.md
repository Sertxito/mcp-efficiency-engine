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

## Output
Version-aware implementation or review, protocol/package contract, focused tests, build artifact verification, and explicit compatibility limits.

## Safety and limitations
- Do not publish, release, or register servers with a remote host without explicit approval.
- Never expose secrets, arbitrary filesystem access, shell execution, or unrestricted network access through an MCP tool.
- Do not claim package availability or MCP client compatibility without testing the actual built artifact/protocol pair.
- If the SDK or protocol guidance is stale or unavailable, state that and avoid inventing method signatures.
