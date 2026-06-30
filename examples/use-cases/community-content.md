# community-content

## Escenario

Generar contenido tecnico para comunidad (post, hilo, resumen didactico).

## Prompt de ejemplo

"Prepara un post tecnico sobre observabilidad en esta plataforma."

## Ruta esperada

- `agent`: `community-manager-agent`
- `engine`: Graphify
- `domain`: community/content

## Validacion

```powershell
py -3 .\scripts\intake\resolve-routing.py --input "Prepara un post tecnico sobre observabilidad en esta plataforma" --intent content --domain community --source-type technical-docs --capability community-content
```

<!-- diagramas-v1 -->
## Diagrama Visual Del Caso De Uso

```mermaid
flowchart LR
  IDEA[Idea] --> CM[community-manager-agent]
  CM --> GUIDE[Guidelines]
  GUIDE --> POST[Contenido final]
```
