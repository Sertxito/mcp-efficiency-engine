# rag-local

## Escenario

Responder preguntas de arquitectura usando documentacion tecnica local del workspace.

## Prompt de ejemplo

"Explica la arquitectura local del orquestador y el flujo de agentes."

## Ruta esperada

- `agent`: `rag-local-agent`
- `engine`: Graphify
- `source_type`: `technical-docs`

## Validacion

```powershell
py -3 .\scripts\intake\resolve-routing.py --input "Explica la arquitectura local del orquestador y el flujo de agentes" --intent explain --domain rag-local --source-type technical-docs --capability local-knowledge
```
