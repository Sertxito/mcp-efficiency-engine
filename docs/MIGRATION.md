# Migrating from the legacy implementation

## Package continuity, implementation replacement

The GitHub repository remains `Sertxito/mcp-efficiency-engine` and the npm
package remains `mcp-efficiency-engine`. Version 0.1.22 replaces the legacy
implementation with MCPEE. The version stays below 1.0 while product
acceptance is incomplete. Both installed command names launch the new CLI.

This is an intentionally incompatible pre-1.0 upgrade. Node.js 18/20/22 are
no longer supported by the package; use Node.js 24 or newer. Complete local
tool installation checks the latest official LTS patch as described in the
[README](../README.md).

## Upgrade a workspace deliberately

1. Back up or commit your existing project configuration, instructions, memory,
   hooks and locally authored assets. Do not publish `.env`, credentials,
   telemetry or private knowledge.
2. Stop the old MCPEE MCP process and inspect existing project hooks, MCP
   entries and instructions. Disable legacy registrations deliberately; the
   new CLI does not uninstall or translate them automatically.
3. Install `npm install --global mcp-efficiency-engine@0.1.22`. Installation
   has no `postinstall` project mutation. Do not use the old `install:host`
   script or assume installation alone initializes a workspace.
4. Run `mcpee init --project C:\path\to\project`. Approve the required local
   CodeGraph setup and choose optional tools and embeddings. Existing
   user-owned files are preserved, so inspect any reported conflict rather
   than assuming old instructions were upgraded.
5. Check the generated root `.mcp.json` entries and use the host's MCP
   migration if the old servers are still registered in `.vscode/mcp.json`.
   Restart the project's MCP server after changing the installed package.
6. Run `mcpee doctor`, inspect `mcpee capabilities list`, then check the
   project validation specs under `.mcpee/workflows/`. Init discovers supported
   commands but does not execute or certify them.
7. Start with a read-only Chat request. Verify context-transfer approval,
   the returned result and the trace before authorizing writes.

Legacy boosts, bundles, presets, Python routing scripts, AutoDocs wiki
projection and global installation hooks are not carried into the new
runtime. Old memory and knowledge stores are not automatically imported.
Retain backups until you have reviewed and explicitly reintroduced relevant
information through the supported memory and source-ingestion commands.
`mcpee update` refreshes project integration from the installed package; it
does not download a new npm version.

## Repository and automation

The source repository contains the runtime packages, catalog, reusable assets,
tests and release scripts. Self-initialization output (`.mcpee`, `.codegraph`,
generated Copilot assets, normalized knowledge, generated documentation and
local configuration) is not part of the product source or npm payload.

CI now runs the Node test suite, local documentation checks and the installed
tarball checks on Linux and Windows. Legacy routing and AutoDocs checks are
replaced by these gates rather than retained with missing script targets.
The obsolete dry-run devlog, cross-repository sync, issue-management and
TechRiders-specific workflows are retired. GitHub Pages publishes a product
landing page linking to the maintained documentation, not the legacy wiki.

The release workflow keeps the existing `NPM_TOKEN` secret and npm identity.
Unlike the old workflow, it publishes only the version committed in the
manifest and lockfile, after the new CI passes. See [RELEASING.md](RELEASING.md).
