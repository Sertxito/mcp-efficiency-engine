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

- Fecha: 2026-08-07
- PR: #25
- Área: `bin/core-v2/plugin-loader.js`
- Cambio: discovery de boosts soporta paquetes npm unscoped (`mcpee-*`), symlink/junction en `boosts/` y deduplicación por nombre.
- Impacto: compatible
- Accion recomendada para consumidores: sin acción; mejora de detección automática.
