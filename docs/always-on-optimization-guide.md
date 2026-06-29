# Always-On Optimization Guide

## Qué cambia

Caveman y Token Saver ya no son opcionales. Están activos para todo.

```txt
Token Saver -> siempre optimiza contexto.
Caveman -> siempre optimiza respuesta.
```

## Cómo se aplica en GitHub Copilot

La activación vive en:

- `.github/copilot-instructions.md`
- `.github/instructions/always-on-optimization.instructions.md`
- `.github/skills/token-saver/SKILL.md`
- `.github/skills/caveman-mode/SKILL.md`

Runtime MCP local para Token Saver:

- `.vscode/mcp.json`

Servidor esperado:

- `token-saver-mcp`

## Cómo se aplica por tarea

| Tarea | Perfil |
| --- | --- |
| Bug/debug | Token Saver strict + Caveman full |
| SQL/DBA | Token Saver strict + Caveman lite/full |
| Azure RAG | Token Saver evidence-first + Caveman evidence-first |
| Formación | Token Saver balanced + Caveman didactic-lite |
| Arquitectura | Token Saver balanced + Caveman lite |

## Regla clave

Caveman no significa “responder mal por corto”. Significa:

```txt
menos paja, misma claridad.
```

Token Saver no significa “perder fuentes”. Significa:

```txt
menos contexto inútil, misma evidencia.
```
