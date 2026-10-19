# Releasing MCPEE

## Identity and version

- Repository: <https://github.com/Sertxito/mcp-efficiency-engine>
- npm package: `mcp-efficiency-engine`
- Commands: `mcpee` and `mcp-efficiency-engine`
- Current candidate: **0.1.23**, following published **0.1.22**
- Runtime: Node.js **>=24**

Keep the normal pre-1.0 version sequence until stable acceptance is complete.
Do not label the target architecture fully implemented or promote to 1.0.0
based only on passing automated tests.

## Before merging

1. Update the committed version with `npm version patch --no-git-tag-version`
   (or choose the intended version explicitly). Commit both manifests.
2. Align the README installation examples and migration notes with the
   release. Document incompatible changes and the supported Node version.
3. Run:

   ```sh
   npm ci
   npm test
   npm run docs:check-links
   npm run pack:check
   ```

   The tarball check seeds a consumer lockfile with the exact dependency
   versions and integrities from the project lockfile, then uses `npm ci
   --offline` with the cached tarballs populated by the initial `npm ci`.
   It does not require previously cached registry metadata. It
   tests both command aliases, preserves consumer-owned instructions on
   refresh, and exports local OTLP. Its CodeGraph fixture is a contract test,
   not a real indexer certification. Optional official-reference URL checks
   can be run with `npm run docs:check-official-links`.
4. Review the exact Git diff and npm file manifest. Do not commit local tool
   installations, credentials, traces, private project fixtures or derived
   knowledge. The MIT license must remain in the tarball.
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

Registry verification retries for up to three minutes with a fresh npm cache
on each attempt. Both registry errors and a version mismatch remain retryable
during propagation; publication is not repeated by this verification step.

After deployment, verify:

```sh
npm view mcp-efficiency-engine version
npm view mcp-efficiency-engine@0.1.23 bin engines dist.integrity --json
npx --package=mcp-efficiency-engine@0.1.23 mcpee help
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

Delete a local legacy checkout only after verifying the new deployment and
preserving any uncommitted work it contains. Never include its `.env`,
dependencies or locally captured telemetry in a release.
