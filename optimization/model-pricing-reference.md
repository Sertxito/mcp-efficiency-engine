# Model Pricing Reference (Usage-based)

Referencia operativa rapida para seleccionar modelo por coste/valor.

## Multiplicadores orientativos

| Modelo | Multiplicador | Uso recomendado |
| --- | --- | --- |
| Claude Haiku 4.5 | 0.33x | tareas ligeras, lookup, Q&A corto |
| GPT-4o | 0.33x | equivalente de bajo coste para tareas simples |
| Gemini 2.5 Pro | 1x | baseline eficiente para tareas medias |
| GPT-5.1 | 1-3x | refactor/bugfix con mejor razonamiento |
| Claude Sonnet 4.6 | 6-9x | analisis complejo y flujos agentic |
| Claude Opus 4.6 | 27x | solo escenarios criticos y ambiguos |
| GPT-5.5 | 57x | evitar salvo necesidad excepcional |

## Politica recomendada

1. Empezar por el modelo minimo viable.
2. Escalar solo si la evidencia es insuficiente.
3. Documentar justificacion para cualquier uso de tier critico.
4. Revisar deprecaciones y sustitutos al menos una vez al mes.

## Nota

Los multiplicadores cambian con el catalogo de GitHub Copilot y proveedores.
Verificar periodicamente contra fuente oficial de planes/precios.
