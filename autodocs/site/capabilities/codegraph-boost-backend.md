# boost_backend

boost_backend expone una capacidad del dominio backend llamada backend-coding, servida por el agente backend sobre CodeGraph.

## Contexto

- kind: capability
- domain: backend
- section: capabilities
- provider: codegraph
- checksum: 6251a25b105a2b371e57f1409d16f376c473931e26f54b6f55be6583b5af363f
- owner: backend
- tags: codegraph, backend, capability

## Fuentes

- [repo-intake/generated/boost_backend/capabilities/capability.json](../../repo-intake/generated/boost_backend/capabilities/capability.json)
- [repo-intake/generated/boost_backend/context-manifests/manifest.json](../../repo-intake/generated/boost_backend/context-manifests/manifest.json)

## Relaciones

| relation_type | target |
|---|---|
| none | none |

## Datos tecnicos

<details>
<summary>Ver payload normalizado</summary>

```json
{
  "boost": "boost_backend",
  "capability": {
    "capability": "backend-coding",
    "repo": "boost_backend",
    "domain": "backend",
    "agent": "backend",
    "engine": "CodeGraph",
    "dependencies": [],
    "generated_at": "2026-07-05T09:54:03.484084+00:00"
  },
  "manifest": {
    "repo": "boost_backend",
    "slug": "boost_backend",
    "schema_version": "2.0",
    "domain": "backend",
    "location": "",
    "type": "github",
    "repo_url": "https://github.com/Sertxito/boost_backend.git",
    "branch": "main",
    "cache_location": ".cache/github-repos/boost_backend",
    "resolved_path": "C:/repo/mcp-efficiency-engine/.cache/github-repos/boost_backend",
    "sync": {
      "mode": "github",
      "repo_url": "https://github.com/Sertxito/boost_backend.git",
      "branch": "main",
      "resolved_path": "C:/repo/mcp-efficiency-engine/.cache/github-repos/boost_backend",
      "status": "updated"
    },
    "agent": "backend",
    "skill": "backend-coding",
    "engine": "CodeGraph",
    "engines": {
      "knowledge": "codegraph",
      "execution": "none",
      "snapshot": "repomix"
    },
    "dependencies": [],
    "approval": {
      "status": "approved",
      "approved_by": "platform-team",
      "approved_date": "2026-06-29",
      "review_ticket": "PLATFORM-1006"
    },
    "generated_at": "2026-07-05T09:54:03.473256+00:00"
  }
}
```
</details>
