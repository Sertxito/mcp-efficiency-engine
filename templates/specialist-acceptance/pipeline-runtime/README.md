# Native GitHub Actions workflow validation

Requires Node.js >=24, HTTPS access to the pinned upstream actionlint release,
and `tar` (including Windows' built-in `tar.exe`). No global installation,
package restore, GitHub token, workflow dispatch or deployment is used.
Copy all seven packaged runtime/documentation files into an isolated disposable
candidate directory, then run:

```powershell
node run-oracle.cjs
```

Repair **only `workflow.yml`**. The baseline is valid YAML but names a nonexistent
job prerequisite; the actual GitHub Actions-aware actionlint parser rejects it.
Preserve `actionlint.yaml`, `toolchain.json`, `native-tool.cjs`, `checks.cjs`,
`run-oracle.cjs` and this README unchanged. The source-only `.gitignore` excludes
generated assets but is not a packaged runtime input or retained evidence.

The runner downloads **actionlint 1.7.7** from its upstream GitHub release,
verifies the archive against the pinned release SHA256, extracts a fresh binary,
and checks its version on every run. Platform archives are pinned for Windows,
Linux and macOS x64/arm64. The verified archive cache is local to the disposable
copy (`.oracle-tools/`); unique per-run working directories are always removed.
There is no arbitrary PATH-installed linter or environment-selected executable.
The child receives only OS executable-discovery variables and isolated home/temp
paths, not inherited credentials, Node test options or npm configuration.
External shellcheck/pyflakes integration is explicitly disabled.

The immutable checker consumes actionlint's structured native diagnostics for:

- `native-workflow-schema-and-graph`: workflow schema, required keys, valid
  permissions and job dependency references/cycles;
- `native-expression-contracts`: available expression contexts, expression types
  and built-in function arity, declared job outputs and actionlint's known
  `upload-artifact` output names;
- `native-script-input-trust`: actionlint's rejection of potentially untrusted
  event data interpolated directly into shell scripts. The control passes the
  pull-request title through an environment variable instead.

These are classifications of real native diagnostics, **not custom regex
validation of workflow text**. A diagnostic-free native run emits, as its final
stdout line, `MCPEE_ORACLE_RESULT` with schema version 1 and all three check IDs.
Native workflow diagnostics emit `MCPEE_ORACLE_FAILURE` listing the affected
known IDs and exit 1. Download/hash/version failures, unavailable tools/platforms,
missing fixture files, timeouts and malformed tool output emit
`MCPEE_ORACLE_SETUP_ERROR` to stderr, exit 1 and emit neither acceptance marker.

The regression runs the real invalid baseline, a test-only repaired control,
nine schema/graph/expression/trust mutations, and missing-file/corrupt-tool setup
failures, using a unique disposable repository-local copy. It never edits the
shipped workflow or checker. Exported MCPEE run specs also execute both native
variants with test-only approval, retain distinct evaluation IDs and verify
`buildBehavioralAcceptance` marks this bounded fixture checked, without specialist
certification. Both retained final markers survive the 2048-character stdout tail.
No npm dependencies or root installation are needed:

```powershell
node --test tests\pipeline-oracle.test.js
```

## Exact scope and limitations

This is **lint and static expression validation**, not remote CI pass, approval,
release or deployment acceptance. It does not evaluate expressions against a live
GitHub event, execute jobs or shell commands, upload/download artifacts, test
cross-job failure propagation, validate action implementations, enforce least
privilege, audit all trust boundaries, or demonstrate that a failed build cannot
release. Artifact coverage is limited to declared expression references and the
pinned linter's action metadata; `success()` coverage is its native argument/type
validation, not execution of success/failure gating. No remote APIs are called
apart from downloading the public, checksum-pinned tooling archive.
