## v10 Extension — Memory-first + Learning

Pipeline actualizado:

1. Detect intent
2. Detect domain
3. **Select memory (memory layer)**
4. **Apply cross-memory reasoning if multi-domain**
5. Route to agent
6. Execute tool (if needed)
7. Register feedback (learning layer)

Clasifica intención y enruta a agente/motor según AGENTS.md y optimization-routing.md.

## Contrato operativo de routing (implementado)

Pipeline operativo:

1. Detect intent
2. Detect domain
3. Select memory
4. Route by capability (si existe) o por default de dominio
5. Emitir evento estructurado JSON (observability)
6. Registrar feedback

Dependencia Memory y CodeGraph en flujo de código:

1. Memory selecciona alcance y señales (repo-memory, routing-memory, code-memory)
2. CodeGraph resuelve simbolos/callpaths para retrieval estructural
3. codebase-memory conserva patrones y contexto persistente

Requirements operativos (runtime):

- MCP server activo: `codegraph` en `.vscode/mcp.json`
- Comando disponible: `codegraph --version`
- Repo inicializado: `codegraph status` debe reportar index up to date
- Preflight recomendado: `.\scripts\validate-context.ps1`

Comando de resolución y emisión de evento:

```powershell
python .\scripts\resolve-routing.py --input "Arregla bug de login" --intent bug-fix --domain dev --source-type code --capability dev-coding
```

Salida:

- Evento append en `observability/logs/routing-decisions.jsonl`
- Estructura validable contra `observability/logs.schema.json`

Campos mínimos del evento:

- `timestamp`
- `input`
- `intent`
- `source_type`
- `agent`
- `engine`
- `optimization_profile`
- `fallback`
- `grounded`
- `sources`

Extensiones always-on:

- `optimization` (token saver + caveman)
- `memory` (selección previa)
- `learning` (feedback)
