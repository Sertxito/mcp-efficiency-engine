# NPM Runtime Release Notes

Usa este archivo como alternativa a `README.md` cuando una PR cambie superficie publicada por npm.

## Template de entrada

- Fecha: YYYY-MM-DD
- PR: #<numero>
- Área: <ruta o modulo>
- Cambio: <que cambia en runtime/contrato>
- Impacto: <breaking|compatible>
- Accion recomendada para consumidores: <si aplica>

## Historial

- Fecha: 2026-08-08
- PR: #28
- Área: `bin/install-host.js`, `scripts/wiki/compiler_main.py`, `scripts/wiki/wiki_compiler.py`
- Cambio: reinstalación/update ahora ejecuta limpieza de legado por defecto y reindex de GitNexus con fallback robusto; el compilador wiki fuerza limpieza de salidas (`AUTODOCS_FORCE_CLEAN=1` por defecto en wrapper) antes de regenerar.
- Impacto: compatible
- Accion recomendada para consumidores: sin acción; si se necesita preservar artefactos históricos, usar flags de control (`--no-cleanup-legacy`, `--cleanup-dry-run`, `--skip-gitnexus-reindex`).

- Fecha: 2026-08-07
- PR: #25
- Área: `bin/core-v2/plugin-loader.js`
- Cambio: discovery de boosts soporta paquetes npm unscoped (`mcpee-*`), symlink/junction en `boosts/` y deduplicación por nombre.
- Impacto: compatible
- Accion recomendada para consumidores: sin acción; mejora de detección automática.
