# Troubleshooting MCPEE

Start with [Getting started](GETTING-STARTED.md).
For normal document edits, follow
[Keep knowledge current](KNOWLEDGE.md#keep-knowledge-current).
The checks below are for actual errors, not mandatory setup steps.

## Check project integration

Run `mcpee doctor --project C:\path\to\project` and review any missing artifacts.
Inspect `mcpee capabilities list` and the generated validation specs under
`.mcpee/workflows/`. Discovering checks does not execute or certify them.
After changing the installed package, `mcpee update` refreshes project
integration; it does not download a new npm version. Restart the project's MCP
server after updating its integration.

Run `doctor` with the same MCPEE version that generated the project. An older
global install can report removed outputs (for example `.github/prompts` before
0.1.27) as missing; check `npm ls -g mcp-efficiency-engine`, upgrade, then run
`mcpee update`. `Required CodeGraph index healthy (not initialized)` means an
earlier `init` stopped before indexing; rerun `mcpee init`, which keeps your
capability selections.

## npm blocks the native SDK dependency

If npm reports a blocked `koffi` install script, repeat the pinned installation
with `--allow-scripts=koffi`, as shown in the README. Do not allow all scripts
globally. Successful `mcpee help` output does not verify native SDK execution
or Copilot authentication.

## Approval waits fail before a decision is returned

The CLI's authenticated loopback approval request allows up to ten minutes for
the host decision. It uses direct HTTP so a separate fetch headers timeout does
not shorten that wait. Each request uses a fresh connection rather than reusing
an idle approval socket. Rejection, disconnection, malformed responses and deadline
expiry remain failures, never implied approval.

The Copilot session allows ten minutes of active execution, excluding time spent
inside its human tool/permission approval callbacks. Overlapping approval waits
pause that budget only once; it resumes with the remaining time, not a fresh ten
minutes. A separate thirty-minute total deadline includes all approval waits.
Individual approval requests still expire after ten minutes, and denial or
expiry never authorizes the action. Host cancellation remains effective during
an approval wait.

Preserve failed runs before retrying. A retry after a task was sent to Copilot is
another transfer and must be authorized; do not disable hooks or reuse an expired
approval as success.

## BGE model available but profile not enabled

A downloaded model is not a completed index. Check:

```sh
mcpee knowledge embeddings status --profile bge-m3 --project C:\path\to\project
```

If the environment and model are available, build the index:

```sh
mcpee knowledge embeddings index --profile bge-m3 --project C:\path\to\project
```

The profile is enabled only after successful indexing. Keep existing model
weights and cached vectors. If the model is reported missing despite downloaded
weights, check the installed package version before deleting anything: Windows
ownership-marker handling was fixed after 0.1.22.

## Python dependency import fails

An older environment may contain incompatible Transformers,
sentence-transformers or PEFT releases. If FlagEmbedding fails to import
`is_torch_fx_available`, install a current MCPEE release and run:

```sh
mcpee knowledge embeddings setup --profile bge-m3 --project C:\path\to\project
```

Authorize with `download` when prompted. Setup repairs the pinned environment,
reuses an existing owned model and indexes sources. Do not edit installed
library code or delete model weights to repair dependency versions.

## Indexing is slow or interrupted

CPU indexing can take hours for a large corpus. Terminal activity only proves
the command is alive, not that inference is advancing. Measured progress reports
phase, completed/total chunks, cache hits and inference batch sizes to stderr,
including redirected logs. Machine-output flags suppress progress lines.

Completed batches are persisted in an owned local SQLite cache. Retry the same
command after interruption; do not run concurrent indexers for one project.
The timeout is 30 minutes without backend progress, not a total-run deadline.
Errors include the last progress event. CPU batches are limited to 16 texts
and 4,096 padded tokens, preserving the 4,000-token chunk limit.

Inspect the current run's log rather than a previous run's error. Confirm
successful completion output and a real semantic query; a partial cache is
not a usable index, and an enabled profile does not prove a later refresh
succeeded. Preserve the error and last progress event if a retry fails.

## Windows Unicode errors

Use MCPEE 0.1.25 or newer if indexing fails with `surrogates not allowed` or
non-ASCII text appears corrupted. The backend uses strict UTF-8 independently
of the Windows console code page.

Repeat indexing after updating, keeping model weights and cache. Correctly
decoded matching entries are reused; misdecoded entries are recalculated.
Rebuild a previously completed index made with the affected version before
trusting its non-ASCII semantic results. Cache-hit counts may differ.

## Skill name errors or a "Convert Prompt to Skills" migration

MCPEE 0.1.26 and earlier rendered skills and agents with `name: "MCPEE <id>"`, which does
not match the skill folder, and rendered workflows as `.github/prompts/*.prompt.md`,
which the VS Code Copilot harness does not load. From 0.1.27, every skill uses
`name: mcpee-<id>` and workflows are skills with `disable-model-invocation: true`
(invoke them with `/mcpee-<workflow>`). Run `mcpee update` after upgrading: it
rewrites only MCPEE-marked files, reuses workflows already migrated by VS Code
and removes MCPEE-owned legacy prompts. Skills without the MCPEE marker are
user-owned and left unchanged.
