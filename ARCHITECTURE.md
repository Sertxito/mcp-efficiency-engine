# Arquitectura de MCP Efficiency Engine

```mermaid
flowchart TD
    U[Usuario] --> CM[Caveman Mode / Interaction Policy]
    CM --> O[Orchestrator / Corporate Router]
    O --> A[Agents Layer]

    A --> DEV[backend]
    A --> FE[frontend-agent]
    A --> LEG[legacy]
    A --> DBA[dba]
    A --> UX[ux-ui]
    A --> RAG[rag-local]
    A --> AZ[rag-azure]
    A --> IOT[iot]
    A --> COM[community-manager]
    A --> WIKI[wiki-agent]
    A --> SNAP[snapshot]

    DEV --> TS[Token Saver Policy]
    FE --> TS
    LEG --> TS
    DBA --> TS
    UX --> TS
    RAG --> TS
    AZ --> TS
    IOT --> TS
    COM --> TS
    WIKI --> TS
    SNAP --> TS

    TS --> CG[CodeGraph]
    TS --> GN[GitNexus]
    TS --> GF[Graphify]
    TS --> AZRAG[RAG-Azure-Builder]
    TS --> RPM[Repomix]

    CG --> CODE[Repos de código]
    GN --> CODE
    GF --> KG[graphify-out / knowledge graph local]
    AZRAG --> AIS[Azure AI Search / embeddings / docs corporativos]
    RPM --> SNAPOUT[Snapshot portable]

    CODE --> RESP[Respuesta / Acción]
    KG --> RESP
    AIS --> RESP
    SNAPOUT --> RESP

    RESP --> OBS[Observability]
    OBS --> MET[Metrics]
    OBS --> LOGS[Logs]
    OBS --> EVAL[Evaluation]
```

## Lectura rápida

```txt
Caveman optimiza cómo se habla.
Token Saver optimiza qué contexto se usa.
Routing decide qué motor se usa.
Observability mide si todo funciona.
```

## Routing base (resumen)

- `backend` y `frontend-agent` -> `CodeGraph`
- `legacy` -> `GitNexus`
- `dba`, `ux-ui`, `rag-local`, `community-manager` -> `Graphify`
- `rag-azure` -> `Azure RAG Builder`
- `wiki-agent` -> `CodeGraph` (fallback `Graphify`)
- `snapshot` -> `Repomix`
