# Frontend runtime oracles

These are narrow, executable acceptance fixtures for Angular 19, React 19, and
Vue 3.5. Each candidate is intentionally defective. The checks mount or
server-render the real framework component, exercise observable behavior, and
type-check the TypeScript source; they do not infer framework behavior from
source-pattern matches.

## Setup and run

Use Node.js 24 and npm. The package manifests and lockfiles are oracle inputs,
not MCPEE dependencies. Provision a separate oracle root with copies of the
fixture files, and install packages only in those copies:

```powershell
$oracleRoot = 'C:\path\to\isolated-oracle-root'
npm ci --prefix "$oracleRoot\templates\specialist-acceptance\frontend-runtime\angular"
npm ci --prefix "$oracleRoot\templates\specialist-acceptance\frontend-runtime\react"
npm ci --prefix "$oracleRoot\templates\specialist-acceptance\frontend-runtime\vue"
$env:MCPEE_FRONTEND_ORACLE_ROOT = $oracleRoot
node --test --test-reporter=tap tests\frontend-oracles.test.js
```

For one fixture, run the exact native wrapper command from its isolated copy:

```powershell
node run-oracle.cjs
```

The wrapper performs a real TypeScript compiler API check without emitting
build files, then runs the explicit native TAP checks. Repaired and mutated
sources are passed in memory; no candidate, control, build, or cache file is
written. The root controller verifies that each seeded candidate fails the
expected assertions, the repaired control passes, and a framework-specific
mutant is rejected. It also verifies the fixture file inventory and contents
remain unchanged after every run. Dependency installation belongs to the
separate oracle root, never the packaged fixture directory.

## Scope and limits

- Angular checks input-array immutability, latest-request-wins behavior,
  cancellation on component destruction, server rendering, and TypeScript
  compilation.
- React checks prop immutability, latest-request-wins behavior, effect cleanup,
  server rendering, and TypeScript/TSX compilation.
- Vue checks prop immutability, reactive rendering, latest-request-wins
  behavior, watcher cleanup on unmount, server rendering, and TypeScript
  compilation.
- Network calls are represented by deterministic in-process deferred promises;
  no application server, API, credentials, or live service is used.
- These small fixtures do not establish complete framework, accessibility,
  browser-compatibility, hydration, routing, performance, or broad catalog
  scenario coverage. Passing them demonstrates only the listed behaviors.
