# GitHub MCP Integration

Controlador central para operaciones automatizadas en GitHub mediante Model Context Protocol (MCP).

## Referencia Oficial

- **GitHub MCP Server:** https://github.com/github/github-mcp-server
- **MCP Specification:** https://modelcontextprotocol.io/
- **GitHub API Docs:** https://docs.github.com/en/rest

## Propósito

Replicar la estrategia de `boost_sertxIA` para tener control total sobre el repositorio a través de MCP, permitiendo:

- Automatización de flujos Git (branches, commits, pushes)
- Gestión de issues y pull requests programáticamente
- Control de releases y tags
- Gestión de repositorio (colaboradores, configuración)
- Integración directa con workflows automatizados

## Arquitectura

```
┌─────────────────────────────────────────┐
│  GitHub Copilot / Agent                 │
│  (vscode, scripts, automation)          │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  MCP GitHub Server                      │
│  (Local MCP runtime)                    │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  GitHub REST API v3                     │
│  (Authenticated via PAT token)          │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  GitHub Repository                      │
│  (Sertxito/mcp-efficiency-engine)       │
└─────────────────────────────────────────┘
```

## Herramientas Disponibles (MCP GitHub)

### Rama (Branch) Management
- `create_branch` - Crear rama desde ref específica
- `list_branches` - Listar ramas del repo
- `get_branch` - Obtener detalles de rama

### Archivo (File) Operations
- `get_file_contents` - Leer contenido de archivo
- `create_or_update_file` - Crear/actualizar archivo con commit
- `delete_file` - Eliminar archivo
- `push_files` - Hacer push de múltiples archivos en batch

### Commits
- `get_commit` - Obtener detalles de commit
- `list_commits` - Listar commits (con filtros)

### Pull Requests
- `create_pull_request` - Crear PR con título, descripción
- `create_pull_request_with_copilot` - Crear PR con análisis de Copilot
- `list_pull_requests` - Listar PRs (estado, autores, labels)
- `pull_request_read` - Leer detalles de PR específica
- `pull_request_review_write` - Hacer review de PR
- `merge_pull_request` - Mergear PR a rama target
- `add_reply_to_pull_request_comment` - Responder comentarios en PR

### Issues
- `issue_read` - Leer detalles de issue
- `issue_write` - Crear/actualizar issues
- `list_issues` - Listar issues (con filtros: estado, labels, asignados)
- `add_issue_comment` - Comentar en issue
- `list_issue_fields` - Obtener campos de issue (tipos, labels)

### Repository Management
- `create_repository` - Crear nuevo repo
- `fork_repository` - Fork de repo
- `list_repository_collaborators` - Listar colaboradores
- `get_teams` - Listar equipos con acceso
- `get_team_members` - Miembros de equipo específico

### Releases & Tags
- `list_releases` - Listar releases (con pre-releases, drafts)
- `get_release_by_tag` - Obtener release por tag
- `get_tag` - Información de tag específico
- `get_latest_release` - Última release publicada

### Authentication
- `get_me` - Usuario autenticado (para verificar permisos)

### Copilot Integration (When Available)
- `assign_copilot_to_issue` - Asignar Copilot para resolver issue
- `request_copilot_review` - Solicitar review de Copilot en PR
- `get_copilot_job_status` - Estado de job de Copilot

## Casos de Uso Implementables

### 1. Automatización de Control de Versión
```
Script → Detecta cambios en rama feature
       → Crea PR automáticamente
       → Ejecuta validaciones en CI
       → Auto-merge si pasan todas
       → Crea release si tag detectado
```

### 2. Gestión de Issues y Documentación
```
Issue creado → Copilot asignado automáticamente
            → Genera PR con solución
            → Linkea a documentación relevante
            → Auto-cierra si resolución verificada
```

### 3. Pipeline de Contenido a Redes Sociales
```
(Similar a boost_sertxIA GitHub Devlog Maintainer)
Repo update → Detecta cambios significativos
          → Genera análisis técnico
          → Crea devlog en autodocs/site/devlog/
          → Genera posts para LinkedIn
          → Crea Issues de tracking
```

### 4. Sincronización Multi-Repo
```
Cambio en mcp-efficiency-engine
→ MCP detecta vía webhook
→ Replica cambios en boost_sertxIA (cuando aplique)
→ Crea PRs de sincronización
→ Mantiene repos alineados
```

## Configuración Requerida

### ⚠️ IMPORTANTE: No Necesitas Instalar MCP Server

Los scripts usan **GitHub CLI (`gh`)** que está disponible por defecto. No necesitas `@github/mcp-github-server` en npm.

### 1. GitHub CLI Setup (Obligatorio)

```bash
# Windows
winget install GitHub.cli

# macOS
brew install gh

# Linux
sudo apt install gh

# Verificar
gh auth status
```

### 2. GitHub Personal Access Token (PAT)

```bash
# En Windows - Credential Manager:
cmdkey /add:github.com /user:your-username /pass:ghp_xxxxxxxxxxxxxxxxxxxx

# En PowerShell (sesión):
$env:GITHUB_TOKEN = "ghp_xxxxxxxxxxxxxxxxxxxx"

# En PowerShell (permanente):
Add-Content $PROFILE "`n`$env:GITHUB_TOKEN = 'ghp_xxxxxxxxxxxxxxxxxxxx'"

# En Linux/macOS:
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
echo 'export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"' >> ~/.bashrc
```

**Token requerido con scopes:**
- `repo` — Acceso a repositorios
- `workflow` — Permisos para workflows

### 3. Verificar Setup

```powershell
gh auth status
gh repo view Sertxito/mcp-efficiency-engine
```

## Scripts de Automatización

### `scripts/github/sync-repo.ps1`
Mantiene sincronización entre repos principales.

```powershell
param(
  [string]$SourceRepo = "Sertxito/mcp-efficiency-engine",
  [string]$TargetRepo = "Sertxito/boost_sertxIA",
  [string]$FilesPattern = "projects/**"
)

# 1. Detectar cambios en SourceRepo
# 2. Filtrar por FilesPattern
# 3. Crear rama en TargetRepo
# 4. Aplicar cambios
# 5. Crear PR con link a commit original
```

### `scripts/github/create-devlog.ps1`
Genera devlog técnico a partir de commits recientes.

```powershell
param(
  [string]$Repo = "Sertxito/mcp-efficiency-engine",
  [int]$CommitsToAnalyze = 10
)

# 1. Obtener últimos N commits
# 2. Analizar cambios (análisis MCP via codegraph)
# 3. Generar markdown con insights
# 4. Crear file en autodocs/site/devlog/
# 5. Abrir PR automáticamente
```

### `scripts/github/manage-issues.ps1`
Gestiona issues con Copilot y automatización.

```powershell
param(
  [ValidateSet("assign", "review", "close")]
  [string]$Action = "assign"
)

# Acciones:
# - assign: Asigna Copilot a issues sin asignar
# - review: Solicita review de Copilot en PRs abiertas
# - close: Auto-cierra issues si solución en PR merged
```

## Integración con Workflows Existentes

### GitHub Actions Workflow Enhancement

```yaml
# .github/workflows/sync-to-boost.yml
name: Sync to boost_sertxIA

on:
  push:
    branches: [main]
    paths:
      - 'projects/**'
      - '.github/specs/**'

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup MCP GitHub
        run: npm install -g @github/mcp-github-server
      
      - name: Run sync via MCP
        run: |
          pwsh scripts/github/sync-repo.ps1 \
            -SourceRepo "${{ github.repository }}" \
            -TargetRepo "Sertxito/boost_sertxIA"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### CI Workflow Integration

```yaml
# En .github/workflows/ci.yml

- name: Assign Copilot to review
  if: success()
  run: |
    pwsh scripts/github/manage-issues.ps1 -Action review
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Create devlog from commits
  if: contains(github.event.head_commit.message, '[devlog]')
  run: |
    pwsh scripts/github/create-devlog.ps1 -CommitsToAnalyze 5
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Estrategia de Seguridad

### Token Management

1. **Nunca commitar tokens en Git**
   ```gitignore
   .env
   .env.local
   secrets.*
   ```

2. **Usar GitHub Secrets en CI/CD**
   ```yaml
   - name: Use token from secrets
     env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

3. **Scope del PAT**
   - `repo` - Acceso completo a repositorios públicos y privados
   - `workflow` - Permisos para workflows
   - `admin:repo_hook` - Para webhooks si es necesario
   - NO usar `admin:org_hook` (demasiado permisivo)

### Auditoría

```powershell
# Script para auditar uso de MCP GitHub
# scripts/github/audit-mcp-usage.ps1

# 1. Listar todos los commits hechos vía MCP (autor específico)
# 2. Verificar PRs creadas automáticamente
# 3. Reportar acciones de Copilot asignadas
# 4. Alertar si uso excepcional (batch operations)
```

## Próximos Pasos

1. **Configurar MCP GitHub Server localmente**
   - Instalar servidor
   - Configurar PAT token
   - Verificar conectividad con `gh` CLI

2. **Implementar scripts de automatización**
   - `sync-repo.ps1` para mantener boost_sertxIA alineado
   - `create-devlog.ps1` para documentación automática
   - `manage-issues.ps1` para gestión inteligente

3. **Integrar con workflows existentes**
   - Añadir pasos en CI para devlog automático
   - Setup de sync automation para PRs cross-repo
   - Gestión de issues con Copilot

4. **Documentar playbooks**
   - Cómo crear PR programáticamente
   - Cómo mergear cuando validaciones pasan
   - Cómo sincronizar cambios a otros repos

## Referencias

- [GitHub MCP Server (Oficial)](https://github.com/github/github-mcp-server)
- [MCP Specification](https://modelcontextprotocol.io/)
- [GitHub REST API Documentation](https://docs.github.com/en/rest)
- [GitHub CLI (gh) Documentation](https://cli.github.com/manual)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [boost_sertxIA - GitHub Devlog Maintainer](https://github.com/Sertxito/boost_sertxIA/blob/main/.github/agents/github-devlog-maintainer.agent.md)

## Estado

- ✅ Documentación creada
- ⏳ Configuración local de MCP Server
- ⏳ Implementación de scripts de automatización
- ⏳ Integración con CI/CD workflows
- ⏳ Documentación de playbooks operacionales
