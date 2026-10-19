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
3. Install `npm install --global mcp-efficiency-engine@0.1.23`. If npm blocks
   `koffi`'s native install script, repeat this install with
   `--allow-scripts=koffi` rather than allowing all scripts globally. Installation
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

### BGE-M3 marker issue on Windows in 0.1.22

Version 0.1.22 may finish downloading BGE-M3 and then report that the local
model is missing: Python writes a CRLF ownership marker on Windows while the
JavaScript check expects LF. This is not proof of a missing model download.
The corrected implementation accepts either line ending and writes new
markers with LF. Keep the model directory; do not delete downloaded weights
to resolve this error. Once its marker is corrected, run
`mcpee knowledge embeddings index --profile bge-m3` to build the index and
enable the profile, then check its status. A downloaded model alone is not
an indexed or enabled embedding profile.

An older BGE environment can also contain incompatible transitive releases
of Transformers, sentence-transformers and PEFT. If importing FlagEmbedding
fails on `is_torch_fx_available`, upgrade to 0.1.23 and run
`mcpee knowledge embeddings setup --profile bge-m3 --project C:\path\to\project`.
Authorize with `download` when prompted. This repairs the pinned compatibility
stack and indexes the sources, reusing an already downloaded owned model;
do not edit installed library code or delete the model.
Environment repair and model indexing are separate operations. The terminal
activity indicator reports elapsed time during long commands, not a measured
completion percentage.

### CPU indexing timeout in 0.1.22

Version 0.1.23 replaces the fixed 30-minute whole-index timeout with a
30-minute inactivity timeout refreshed by backend progress. Indexing emits
phases, completed/total chunks and cache hits, and persists completed batches
in a project-local SQLite cache. Repeating the index command after interruption
reuses matching vectors rather than starting inference from zero. This cache
does not enable semantic search until the complete index has been written.
The older 0.1.22 implementation did not save intermediate vectors, so work
lost in that version's timeout cannot be recovered retroactively.

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
