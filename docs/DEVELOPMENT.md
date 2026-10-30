# Development

For contributors working on MCPEE itself. To publish a release, see
[Releasing](RELEASING.md).

## Commands

Requires the latest Node.js LTS release for a complete tool installation. From
the repository root:

```sh
npm test                          # node --test
npm run pack:check                # verify the packed npm tarball end to end
npm run docs:check-links          # local Markdown links, anchors and guide metadata
npm run docs:check-official-links # network reachability of official guide URLs
npm run init                      # initialize this repository with MCPEE
```

- `pack:check` installs the packed tarball in a temporary offline consumer and
  seeds its dependency lock from the exact project lockfile. It runs the
  installed CLI and initialization against a deterministic local CodeGraph
  fixture, checks that user-owned instructions survive refresh, and tests local
  OTLP export from the installed package.
- `docs:check-links` runs offline. It checks local Markdown targets and anchors
  plus the scope, version and review metadata of technical guides.
- `docs:check-official-links` checks HTTP reachability of official guide URLs,
  not the technical correctness of those pages.
- Tool version probes default to three seconds. npm gets ten seconds; packaged
  Python and Node tools get thirty seconds for cold starts. Callers can supply
  a specific timeout.

## Try an unpublished build in a project

```sh
node packages/cli/bin/mcpee.js init --project C:\path\to\project
```

Interactive initialization asks for an embeddings profile and applies it after
the initial sync. For a non-interactive run, pass `--embeddings bge-m3`,
`--embeddings light` or `--embeddings none`. Then open the project in VS Code
and use Copilot Chat normally; see [Getting started](GETTING-STARTED.md).

## Documentation layout

`README.md` is the npm and GitHub entry point. It covers installation and
first use and links to the guides in `docs/`. Keep detailed behavior in the
guides, and add any new published guide to `files` in `package.json`.
`docs/ARCHITECTURE.md` describes the intended complete product, not a claim
that everything in it is already implemented.

## Release acceptance boundaries

Passing the automated suite and installed-package checks is necessary but does
not certify every capability in the target architecture. Release acceptance
also requires a real Copilot execution with:

- recorded permissions;
- the intended file change;
- post-change graph synchronization;
- a passing declared check;
- documentation refreshed only after that check passes.

Repeated passing workflow evidence may propose learning; adopting it remains a
separate human decision.

A controlled fixture proves harness orchestration, not the quality of the
application or its tests. An MCP SDK client exercises the real transport and
runtime but does not replace acceptance in the VS Code Chat UI. Memory or
knowledge included in the prompt proves delivery, not causal use. A lexical
fallback is not a successful vector-embedding query. SDK cost values without a
declared unit are not a currency estimate.

Human specialist scorecards, live vector-profile checks and external cloud
operations need their own evidence before they can be called validated.
Historical telemetry warnings remain findings, because later redaction fixes
do not retroactively validate old records. A timeout, blocked stage or missing
human evaluation must stay visible rather than be reported as overall product
acceptance.
