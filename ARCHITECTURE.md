# Arquitectura final v6

```mermaid
flowchart TD
    U[Usuario] --> CM[Caveman Mode / Interaction Policy]
    CM --> O[Orchestrator / Corporate Router]
    O --> A[Agents Layer]

    A --> DEV[dev-agent]
    A --> LEG[legacy-agent]
    A --> DBA[dba-agent]
    A --> RAG[rag-agent]
    A --> AZ[azure-rag-agent]
    A --> IOT[iot-agent]
    A --> COM[community-manager-agent]
    A --> SNAP[snapshot-agent]

    DEV --> TS[Token Saver Policy]
    LEG --> TS
    DBA --> TS
    RAG --> TS
    AZ --> TS
    IOT --> TS
    COM --> TS
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
