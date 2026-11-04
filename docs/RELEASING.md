# Releasing MCPEE

## Identity and version

- Repository: <https://github.com/Sertxito/mcp-efficiency-engine>
- npm package: `mcp-efficiency-engine`
- Commands: `mcpee` and `mcp-efficiency-engine`
- Current candidate: **0.1.46**, following published **0.1.45**
- Runtime: Node.js **>=24**

Keep the normal pre-1.0 version sequence until stable acceptance is complete.
Do not label the target architecture fully implemented or promote to 1.0.0
based only on passing automated tests.

The 0.1.46 patch asks for confirmation before replacing an existing plan or task
pair. It archives the previous contents and review approvals under
`.mcpee/reports/phase-revisions/`, bound to the exact candidate and current files.
Changing a plan also archives its dependent tasks so they can be regenerated
against the new plan. Refusal preserves the files and the saved authoring
candidate; approval of replacement does not authorize risky actions or grant
product acceptance. Canonical validation workflow collisions use a separate
revision-specific path without discarding the earlier workflow.

The 0.1.45 patch registers MCPEE independently of CodeGraph readiness, supports
explicit portable or VS Code MCP configuration, and repairs registration on
update without creating duplicate servers. Brownfield reconciliation loads
before execution, the installed-package check requires that module, and unified
graphs have a dedicated 64 MiB read limit (other JSON keeps its 16 MiB limit).
Office extraction forces UTF-8 strict output and rejects replacement characters;
sync retries damaged owned conversions without changing original sources or
granting authority to earlier proposals.

TR reached 304/304 structurally validated units while preserving prior proposals.
Its last draft required an audited citation-only repair against an already
damaged normalized source. That project-specific result is not catalogue-wide
acceptance, semantic approval, or proof that model timeouts cannot recur.
The UTF-8 prevention fix is covered by automated extraction tests and a separate
read-only converter check; TR's reviewed evidence is not silently regenerated
by publication. Greenfield coverage remains automated, not a new real-model
certification. This remains a pre-1.0 reliability patch, not a stable 1.0 claim.

The 0.1.44 patch unifies greenfield and brownfield specification lifecycle,
descriptive names and document-state navigation. It adds bounded, resumable
brownfield extraction with primary/context ranges, recoverable JSON replacement
repairs, Spanish-safe placeholder checks and streaming telemetry retention.
Preparation shares lexical-index parsing and batch-local scope plans, with
invalidation and source-integrity checks. Automatic concurrency selects one
session per ten pending units, rounded up and capped at ten; explicit 1..10
overrides remain available. Reused proposals do not inflate worker count.

Greenfield/lifecycle behavior is covered by automated fixtures and installed
package checks, not a new real-model greenfield certification. Real brownfield
acceptance remains partial: new units have completed, but timeouts and
descriptive-name conflicts still occur. Preserve their evidence; do not call
this release complete project acceptance or promise proportional speedups.
The ongoing acceptance project is not bundled or changed by publication.

The 0.1.43 security patch updates vulnerable transitive dependencies and bundles
the pinned SDK JavaScript without its vulnerable transitive Zod installation.
The source build uses patched Zod; the published package retains its patched
direct Zod. Native runtime packages remain platform-selected and version-aligned
with the SDK. Build provenance and MIT notices are included. Both the source
dependency audit and a fresh consumer audit must pass, along with an actual
native library load on Linux and Windows. No model session is started.

The 0.1.42 follow-up delivers the no-Git/documentation-only guidance through
the generated operating contract as well as fresh project instructions and
executor prompts. Existing project instructions remain untouched on update;
tests verify that upgrades still receive the new rules.

The 0.1.41 patch extends documentation-only routing to discovery and architecture,
not only functional specifications. Init, sync, rebuild, post-change sync and
doctor do not require code-index health when no application code exists.
Existing CodeGraph state and index files are preserved. Harness-only package
metadata is excluded from documentation-only impact targets; actual source drift
and phase approvals remain blocking. Generated guidance makes Git optional and
requires direct file review when diff/status is unavailable. Adding application
code restores CodeGraph gates. Acceptance uses fixtures, with no paid SDK run.

The 0.1.40 patch automatically authorizes exact internal MCP task/status/cancel
transport, the task's selected context to authenticated Copilot and post-task
local sync. Nested high-impact tools and runtime permissions remain gated.
Host-level trust and confirmation cannot be overridden by MCPEE; its generated
hook provides the narrow internal allowance where supported. No paid SDK run
was started for this patch.

The 0.1.39 patch installs the full local catalog by default for new projects,
while routing only relevant guidance. Explicit agent selections and existing
removals are preserved. Existing projects can approve `capabilities install all`
to expand their local catalog; installation does not execute specialists.

The human entry point is `docs/README.md` (or adjacent `MCPEE.md` when preserving
owner edits), with every specification indexed under `docs/specifications/`.
Functional specs, independent cases, decisions, plans, tasks and review snapshots
move together through `proposed`, `reviewed` and `approved` directories. Explicit
approval or implemented-and-currently-verified behavior establishes authority;
automatic structural validation does not. Legacy root-workspace migration
rebases links and preserves existing reviews with audited hashes, without
inventing authority or atomic decomposition. Older pre-workspace drafts are
imported as unapproved copies. Existing projects should
upgrade and run `mcpee update`, followed by `mcpee sync` to refresh detection
and inventories. Old drafts and approved contracts are preserved.

The functional gate checks structure and provenance, not semantic correctness.
The prior 0.1.37 release had one authorized real SDK acceptance with a small
synthetic requirements document. No additional paid SDK attempt has been run
for 0.1.39. The workspace routing, execution and persistence tests use an
SDK fixture with a different synthetic product; they do not prove semantic
decomposition quality or certify arbitrary project completeness. Automated SDK
tests remain mocked and do not spend model quota.

## Before merging

1. Update the committed version with `npm version patch --no-git-tag-version`
   (or choose the intended version explicitly). Commit both manifests.
2. Align the README installation examples and troubleshooting guidance with the
   release. Document incompatible changes and the supported Node version.
3. Run:

   ```sh
   npm ci
   npm test
   npm run audit:dependencies
   npm run docs:check-links
   npm run pack:check
   ```

   The tarball check builds the pinned SDK JavaScript and installs the package
   in a fresh consumer without copying repository overrides or its lockfile.
   Installation prefers cached downloads but may query registry metadata;
   auditing contacts npm's advisory service.
   It checks that the vulnerable SDK dependency tree is absent, verifies the
   bundle digest/export surface and loads the actual native library in a child
   process. It
   tests both command aliases, preserves consumer-owned instructions on
   refresh, and exports local OTLP. Its CodeGraph fixture is a contract test,
   not a real indexer certification. Optional official-reference URL checks
   can be run with `npm run docs:check-official-links`.
4. Review the exact Git diff and npm file manifest. Do not commit local tool
   installations, credentials, traces, private project fixtures or derived
   knowledge. The MIT license must remain in the tarball.
   CI downloads Bicep 0.39.26 to the runner's temporary directory and passes its
   explicit path to native acceptance tests. A different preinstalled version
   is not accepted as equivalent evidence; no cloud deployment is performed.
5. Open a PR against `main`. The existing branch protection requires a PR;
   do not bypass it. Both operating-system CI jobs must pass before merging.

## Deployment

`.github/workflows/release-npm.yml` runs on a push to `main` or an explicit
dispatch on `main`. It first invokes the same reusable CI workflow on Linux
and Windows. Publication is serialized and requires the existing repository
secret `NPM_TOKEN`; no secret is stored in source.

The workflow installs locked dependencies with `npm ci --ignore-scripts`,
checks that the committed version is newer than the registry version,
publishes the tested tarball, verifies the registry result, and creates the
matching GitHub release and tag. It does not silently bump the version in CI
or overwrite an existing release. The optional dispatch `npm_version` must
match the committed version.

Registry verification retries for up to ten minutes with a fresh npm cache
on each attempt. Both registry errors and a version mismatch remain retryable
during propagation; publication is not repeated by this verification step.

After deployment, verify:

```sh
npm view mcp-efficiency-engine version
npm view mcp-efficiency-engine@0.1.46 bin engines dist.integrity --json
npx --package=mcp-efficiency-engine@0.1.46 mcpee help
```

Also check the release workflow and GitHub Pages deployment. A failed
publish or registry check is a failed deployment, not an accepted release.
If npm publication succeeded but release creation failed, repair the GitHub
release for that published version; do not republish it or move its tag.
For a runtime regression publish a new patch version rather than replacing
an immutable npm version.

## Scope of acceptance

The real controlled harness cycle has evidence for approved mutation,
post-change synchronization, a declared check, documentation and pending
learning. This does not certify application quality, all catalog specialists,
vector-model profiles or the complete target architecture. Final Chat UI
acceptance and human specialist reviews remain separate. Historical trace
warnings are not erased by newer successful runs.

Never include project `.env` files, installed dependencies or locally captured
telemetry in a release.
