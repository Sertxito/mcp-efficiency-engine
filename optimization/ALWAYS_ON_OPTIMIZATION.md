# Always-On Optimization Policy

## Objetivo

Caveman Mode y Token Saver deben estar activos por defecto para todo el sistema, incluidos flujos con GitHub Copilot, agentes, prompts, skills y routing.

```txt
Token Saver = siempre activo en la capa de contexto / retrieval / tools
Caveman     = siempre activo en la capa de interacción / respuesta
```

Memory MCP y Learning tambien son always-on:

```txt
Memory MCP = memoria operativa/persistente y reutilizacion de patrones
Learning   = feedback post-ejecucion para mejora continua del routing
```

## Frontera de capas

1. Capa Always-On (fija): Token Saver + Caveman + Memory MCP + Learning.
1. Capa Routing (variable): eleccion de agente/motor por intencion, dominio y fuente.
1. Capa Ejecucion: toolchain especifico por motor elegido.

Los motores (CodeGraph, GitNexus, Graphify, Azure RAG Builder, Repomix) no se fijan en Always-On: se resuelven en routing.

## Regla global

```txt
Siempre optimizar contexto.
Siempre optimizar respuesta.
Nunca eliminar evidencia necesaria.
Nunca eliminar claridad necesaria.
```

## Excepciones permitidas

Caveman puede relajarse a modo didáctico si el usuario pide explícitamente:

- explicación larga,
- formación,
- documentación para terceros,
- storytelling,
- material comercial/formativo.

Token Saver NO se desactiva. Solo puede cambiar de intensidad:

- `strict` para debug/coding/CLI,
- `balanced` para arquitectura/RAG,
- `evidence-first` para Azure RAG con fuentes obligatorias,
- `didactic` para formación, manteniendo contexto mínimo suficiente.

## Aplicación por motor

| Motor | Token Saver | Caveman |
| --- | --- | --- |
| CodeGraph | strict | full en debug/coding |
| GitNexus | balanced/strict | lite/full según caso |
| Graphify | balanced | lite salvo formación |
| Azure RAG Builder | evidence-first | lite, fuentes obligatorias |
| Repomix | strict scope | N/A o lite |

## Regla para Copilot

GitHub Copilot debe leer esta política desde:

- `.github/copilot-instructions.md`
- `.github/instructions/always-on-optimization.instructions.md`
- `.github/skills/token-saver/SKILL.md`
- `.github/skills/caveman-mode/SKILL.md`

Comandos caveman gestionados como capacidades propias del repo:

- `.github/skills/caveman/SKILL.md`
- `.github/skills/caveman-help/SKILL.md`
- `.github/skills/caveman-review/SKILL.md`
- `.github/skills/caveman-commit/SKILL.md`
- `.github/skills/caveman-stats/SKILL.md`
- `.github/skills/caveman-compress/SKILL.md`
- `.github/skills/cavecrew/SKILL.md`
- `.github/prompts/caveman.prompt.md`
- `.github/prompts/caveman-help.prompt.md`
- `.github/prompts/caveman-review.prompt.md`
- `.github/prompts/caveman-commit.prompt.md`
- `.github/prompts/caveman-stats.prompt.md`
- `.github/prompts/caveman-compress.prompt.md`
- `.github/prompts/cavecrew.prompt.md`

Si hay conflicto, prevalece:

```txt
1. Seguridad / fuentes / grounding
2. Token Saver
3. Memory MCP
4. Learning
5. Caveman
6. Estilo específico del agente
```
