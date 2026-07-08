# boost_dba

boost_dba expone una capacidad del dominio dba llamada database-analysis, servida por el agente dba sobre Graphify.

## Contexto

- kind: capability
- domain: dba
- section: capabilities
- provider: graphify
- checksum: 04334af363fd0422805236a89d278b21b3dea43f1d2a59b64d05a74d3d106966
- owner: dba
- tags: graphify, dba, capability

## Fuentes

- [repo-intake/generated/boost_dba/capabilities/capability.json](../../repo-intake/generated/boost_dba/capabilities/capability.json)
- [repo-intake/generated/boost_dba/context-manifests/manifest.json](../../repo-intake/generated/boost_dba/context-manifests/manifest.json)

## Relaciones

| relation_type | target |
|---|---|
| none | none |

## Datos tecnicos

<details>
<summary>Ver payload normalizado</summary>

```json
{
  "boost": "boost_dba",
  "capability": {
    "capability": "database-analysis",
    "repo": "boost_dba",
    "domain": "dba",
    "agent": "dba",
    "engine": "Graphify",
    "dependencies": [],
    "generated_at": "2026-07-05T09:53:49.529524+00:00"
  },
  "manifest": {
    "repo": "boost_dba",
    "slug": "boost_dba",
    "schema_version": "2.0",
    "domain": "dba",
    "location": "",
    "type": "github",
    "repo_url": "https://github.com/Sertxito/boostDBA.git",
    "branch": "master",
    "cache_location": ".cache/github-repos/boost_dba",
    "resolved_path": "C:/repo/mcp-efficiency-engine/.cache/github-repos/boost_dba",
    "sync": {
      "mode": "github",
      "repo_url": "https://github.com/Sertxito/boostDBA.git",
      "branch": "master",
      "resolved_path": "C:/repo/mcp-efficiency-engine/.cache/github-repos/boost_dba",
      "status": "sync_failed",
      "error": "fatal: couldn't find remote ref master"
    },
    "agent": "dba",
    "skill": "database-analysis",
    "engine": "Graphify",
    "engines": {
      "knowledge": "graphify",
      "execution": "none",
      "snapshot": "repomix"
    },
    "dependencies": [],
    "approval": {
      "status": "approved",
      "approved_by": "platform-team",
      "approved_date": "2026-06-29",
      "review_ticket": "PLATFORM-1001"
    },
    "generated_at": "2026-07-05T09:53:49.527856+00:00"
  }
}
```
</details>
