# GitHub MCP Scripts

Scripts PowerShell para automatización de repositorio mediante GitHub CLI.

⚠️ **IMPORTANTE:** Solo necesitas `gh` CLI + PowerShell 7. No necesitas `npm install -g`.

→ **[GUÍA DE INSTALACIÓN AQUÍ](./INSTALL.md)**

## Scripts Disponibles

### 1. `sync-repo.ps1` — Sincronización Multi-Repo

Sincroniza cambios entre repositorios principales automáticamente.

**Uso:**
```powershell
.\sync-repo.ps1 -FilesPattern "projects/**"
```

**Parámetros:**
- `-SourceRepo` — Repo origen (default: Sertxito/mcp-efficiency-engine)
- `-TargetRepo` — Repo destino (default: Sertxito/boost_sertxIA)
- `-FilesPattern` — Patrón glob para filtrar archivos (default: projects/**)
- `-BranchName` — Nombre de rama (default: sync/{timestamp})
- `-DryRun` — Mostrar cambios sin hacer modificaciones

**Ejemplos:**
```powershell
# Sincronizar especificaciones
.\sync-repo.ps1 -FilesPattern ".github/specs/**"

# Modo dry-run para validar
.\sync-repo.ps1 -FilesPattern "projects/**" -DryRun

# Repos personalizados
.\sync-repo.ps1 -SourceRepo "Sertxito/repo-A" -TargetRepo "Sertxito/repo-B"
```

**Flujo:**
1. Detecta cambios en SourceRepo que coincidan con FilesPattern
2. Crea rama en TargetRepo
3. Sincroniza archivos
4. Crea PR de draft para revisión manual

**Output Esperado:**
```
✓ GitHub CLI disponible
Detectando cambios en Sertxito/mcp-efficiency-engine/main...
Encontrados 3 cambios
Creando rama sync/20260704-120000 en Sertxito/boost_sertxIA...
✓ Rama creada: sync/20260704-120000
Sincronizando 3 archivos...
  Sincronizando: projects/project-a/spec.md
  ✓ projects/project-a/spec.md sincronizado
  ...
✓ PR creada: https://github.com/Sertxito/boost_sertxIA/pull/XXX
```

---

### 2. `create-devlog.ps1` — Generador de DevLog Técnico

Genera devlog automático a partir de commits recientes.

**Uso:**
```powershell
.\create-devlog.ps1
```

**Parámetros:**
- `-Repo` — Repositorio (default: Sertxito/mcp-efficiency-engine)
- `-CommitsToAnalyze` — Cantidad de commits (default: 10)
- `-OutputDir` — Directorio de salida (default: autodocs/site/devlog)
- `-DryRun` — Mostrar contenido sin crear archivo

**Ejemplos:**
```powershell
# Generar devlog con últimos 10 commits
.\create-devlog.ps1

# Analizar más commits
.\create-devlog.ps1 -CommitsToAnalyze 20

# Vista previa antes de crear
.\create-devlog.ps1 -DryRun

# Repo específico
.\create-devlog.ps1 -Repo "Sertxito/boost_sertxIA"
```

**Categorización Automática:**
- 🎯 **Features** — Commits con "feat", "feature"
- 🐛 **Fixes** — Commits con "fix", "bug"
- 🔧 **Refactor** — Commits con "refactor"
- 📝 **Docs** — Commits con "doc"
- ✅ **Tests** — Commits con "test"
- 📌 **Otros** — Resto de commits

**Output Esperado:**
```
Obteniendo últimos 10 commits de Sertxito/mcp-efficiency-engine...
✓ Obtenidos 10 commits

📊 Cambios detectados:
  🎯 Features: 2
  🐛 Fixes: 3
  🔧 Refactor: 1
  📝 Docs: 2
  ✅ Tests: 1
  📌 Otros: 1

✓ Archivo devlog creado: autodocs/site/devlog/devlog-2026-07-04.md

[DevLog markdown structure generated with all commits categorized]
```

**Archivo Generado:**
```markdown
# Devlog — 2026-07-04

| Categoría | Cantidad |
|-----------|----------|
| 🎯 Features | 2 |
| 🐛 Fixes | 3 |

## 🎯 Features Nuevas

- **feat: GitHub MCP integration** — [`abc1234`](...)
- **feat: Add CI workflow** — [`def5678`](...)

## 🐛 Fixes y Resoluciones

- **fix: Windows encoding issue** — [`ghi9012`](...)
...
```

---

### 3. `manage-issues.ps1` — Gestor Inteligente de Issues

Automatiza gestión de issues y PRs con Copilot.

**Uso:**
```powershell
.\manage-issues.ps1 -Action assign
```

**Parámetros:**
- `-Repo` — Repositorio (default: Sertxito/mcp-efficiency-engine)
- `-Action` — Acción: `assign`, `review`, `close` (default: assign)
- `-State` — Estado: `open`, `closed` (default: open)
- `-DryRun` — Mostrar cambios sin hacer modificaciones

**Acciones:**

#### `assign` — Asignar Copilot a Issues
```powershell
.\manage-issues.ps1 -Action assign

# Output:
Buscando issues sin asignar...
Encontrados 3 issues:
  #42 — Implementar GitHub MCP integration
  ✓ Copilot asignado a #42
  #43 — Documentar CI workflow
  ✓ Copilot asignado a #43
  #44 — Add test coverage
  ✓ Copilot asignado a #44

✓ Asignación completada: 3 issues
```

#### `review` — Solicitar Review de Copilot
```powershell
.\manage-issues.ps1 -Action review

# Output:
Buscando PRs abiertas...
Encontradas 2 PRs:
  #50 — Add sync-repo script (por @sertxito)
  ✓ Review de Copilot solicitado para #50
  #51 — Update documentation (por @sertxito)
  ✓ Review de Copilot solicitado para #51

✓ Reviews solicitados: 2 PRs
```

#### `close` — Auto-cerrar Issues Resueltas
```powershell
.\manage-issues.ps1 -Action close

# Output:
Buscando issues para auto-cerrar...
  Auto-cerrando issue #42 (referenced en PR #50)
  ✓ Issue #42 cerrada
  Auto-cerrando issue #43 (referenced en PR #50)
  ✓ Issue #43 cerrada

✓ Issues auto-cerradas: 2
```

---

## Configuración Inicial

### 1. Instalar MCP GitHub Server

```bash
# Opción 1: npm
npm install -g @github/mcp-github-server

# Opción 2: desde source
git clone https://github.com/github/github-mcp-server
cd github-mcp-server
npm install && npm run build
```

### 2. Configurar GitHub Token

```bash
# Windows - Credential Manager
cmdkey /add:github.com /user:your-username /pass:ghp_xxxxxxxxxxxx

# PowerShell - Variable de entorno
$env:GITHUB_TOKEN = "ghp_xxxxxxxxxxxx"

# Permanente en Profile
Add-Content $PROFILE `n'$env:GITHUB_TOKEN = "ghp_xxxxxxxxxxxx"'

# Verificar
gh auth status
```

### 3. Ejecutar Scripts

```bash
# Permitir scripts locales (si es necesario)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Ejecutar script
cd scripts/github
.\sync-repo.ps1
```

---

## Automatización en GitHub Actions

### Workflow: Auto-Sync on Push

```yaml
# .github/workflows/auto-sync.yml
name: Auto-Sync to boost_sertxIA

on:
  push:
    branches: [main]
    paths:
      - 'projects/**'

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup PowerShell
        run: |
          sudo apt-get update
          sudo apt-get install -y powershell
      
      - name: Setup MCP GitHub
        run: npm install -g @github/mcp-github-server
      
      - name: Run sync
        run: pwsh scripts/github/sync-repo.ps1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Create issue if sync failed
        if: failure()
        run: |
          gh issue create \
            --title "⚠️ Sync to boost_sertxIA failed" \
            --body "Check workflow: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Workflow: Auto-DevLog

```yaml
# .github/workflows/auto-devlog.yml
name: Generate DevLog

on:
  push:
    branches: [main]

jobs:
  devlog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      
      - name: Setup PowerShell
        run: sudo apt-get install -y powershell
      
      - name: Generate devlog
        run: pwsh scripts/github/create-devlog.ps1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Commit and push
        if: success()
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add autodocs/site/devlog/
          git commit -m "docs: auto-generated devlog" || exit 0
          git push
```

### Workflow: Auto-Issue Management

```yaml
# .github/workflows/auto-issue-management.yml
name: Auto-Manage Issues

on:
  schedule:
    - cron: '0 9 * * 1'  # Lunes 9 AM
  workflow_dispatch:

jobs:
  manage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup PowerShell
        run: sudo apt-get install -y powershell
      
      - name: Assign Copilot
        run: pwsh scripts/github/manage-issues.ps1 -Action assign
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Request reviews
        run: pwsh scripts/github/manage-issues.ps1 -Action review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Close resolved
        run: pwsh scripts/github/manage-issues.ps1 -Action close
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Troubleshooting

### Error: "GitHub CLI no disponible"
```bash
# Instalar gh CLI
# Windows
winget install GitHub.cli

# macOS
brew install gh

# Linux
sudo apt install gh
```

### Error: "No token provided"
```bash
# Verificar token
$env:GITHUB_TOKEN

# Configurar si falta
$env:GITHUB_TOKEN = "ghp_xxxxxxxxxxxx"

# Verificar acceso
gh auth status
```

### Error: "API rate limit exceeded"
- GitHub tiene límites de rate: 60 req/hora (unauthenticated), 5000/hora (authenticated)
- Esperar o reducir cantidad de operaciones
- Considerar usar GitHub Graphql para operaciones en batch

### Error: "Repository not found"
- Verificar nombre exact del repo
- Verificar permisos del token
- El repo debe existir y ser accesible

---

## Mejores Prácticas

### 1. **Usar DryRun Primero**
```powershell
.\sync-repo.ps1 -DryRun
```

### 2. **Validar Tokens Regularmente**
```powershell
# Verificar token expiry
gh auth status

# Renovar si es necesario
gh auth refresh
```

### 3. **Monitorear Cambios Automáticos**
- Revisar PRs creadas automáticamente antes de mergear
- Revisar issues auto-cerradas
- Crear alertas si hay fallos

### 4. **Versionar Scripts**
```powershell
# Guardar versión en archivo
@"
# GitHub MCP Scripts v1.0
# Last updated: 2026-07-04
"@ | Out-File scripts/github/VERSION.md
```

### 5. **Auditoría de Cambios**
```powershell
# Ver todos los commits hechos por scripts
gh api repos/Sertxito/mcp-efficiency-engine/commits \
  --jq '.[] | select(.author.login == "github-actions") | "\(.sha | .[0:7]) - \(.commit.message)"'
```

---

## Referencias

- [GitHub MCP Server](https://github.com/github/github-mcp-server)
- [GitHub CLI Documentation](https://cli.github.com/)
- [GitHub REST API](https://docs.github.com/en/rest)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [boost_sertxIA GitHub Devlog Maintainer](https://github.com/Sertxito/boost_sertxIA/blob/main/.github/agents/github-devlog-maintainer.agent.md)

---

## Estado

- ✅ Scripts creados
- ⏳ Integración local con MCP Server
- ⏳ Testing en CI/CD
- ⏳ Documentación de playbooks avanzados
