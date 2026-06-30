Usa prompts naturales. El orchestrator decide agente/motor.

## Hook Automatico De Prompts

El routing selecciona un prompt automaticamente en cada decision y lo registra en el evento de observabilidad.

Archivo de implementacion:
- `scripts/intake/resolve-routing.py`

Campo emitido por evento:
- `prompt.selected`
- `prompt.exists`
- `prompt.selection_mode`

Reglas actuales de seleccion:
- `corporate-docs` o `domain=azure-rag` -> `.github/prompts/azure-rag.query.prompt.md`
- `domain=dev` y `intent=bug-fix` -> `.github/prompts/dev.fix-bug.prompt.md`
- `domain=legacy` -> `.github/prompts/legacy.impact-analysis.prompt.md`
- `domain=dba` -> `.github/prompts/dba.query-review.prompt.md`
- `agent=rag-local-agent` o `source_type=technical-docs` -> `.github/prompts/rag.knowledge-answer.prompt.md`
- fallback -> `.github/prompts/auto-route.prompt.md`

Si el prompt seleccionado no existe, el evento añade una nota `prompt_not_found=...`.
