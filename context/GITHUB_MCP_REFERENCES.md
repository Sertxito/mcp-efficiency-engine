# GitHub MCP Server — Referencia Oficial

Documento de **referencias canónicas** para integración de GitHub MCP Server en `mcp-efficiency-engine`.

## Servidor GitHub MCP Oficial

- **Repositorio:** https://github.com/github/github-mcp-server
- **Descripción:** Model Context Protocol (MCP) server para GitHub, proporcionado por GitHub
- **Licencia:** MIT
- **Documentación:** README oficial del repo

### Capacidades Principales

El servidor MCP de GitHub expone las siguientes capacidades:

1. **Gestión de Branches**
   - Crear, listar, eliminar branches
   - Obtener detalles de branch específica
   - Resolver referencias (branches, tags, commits)

2. **Operaciones de Archivo**
   - Leer contenido de archivos
   - Crear/actualizar archivos con commit automático
   - Eliminar archivos
   - Batch push de múltiples archivos

3. **Gestión de Commits**
   - Obtener detalles de commit específico
   - Listar commits con filtros
   - Resolver referencias de commit

4. **Control de Pull Requests**
   - Crear PRs con título y descripción
   - Listar PRs (con filtros: estado, author, labels)
   - Leer detalles completos de PR
   - Hacer reviews de PR
   - Mergear PRs
   - Comentar en PRs

5. **Gestión de Issues**
   - Leer/crear/actualizar issues
   - Listar issues (con filtros)
   - Comentar en issues
   - Obtener campos disponibles de issue

6. **Gestión de Repository**
   - Crear repositorio
   - Fork de repository
   - Listar colaboradores
   - Obtener información de equipos

7. **Releases y Tags**
   - Listar releases
   - Obtener release por tag
   - Información de tags
   - Latest release

8. **Integración Copilot**
   - Asignar Copilot a issues
   - Solicitar review de Copilot en PRs
   - Obtener estado de jobs de Copilot

## Model Context Protocol (MCP)

- **Especificación:** https://modelcontextprotocol.io/
- **Descripción:** Protocolo estándar abierto para conectar LLMs con herramientas y datos
- **Ventajas:**
  - Comunicación bidireccional segura
  - Definición clara de "tools" (funciones disponibles)
  - Manejo de contexto y recursos
  - Soporte para múltiples servidores MCP simultáneos

### Arquitectura MCP

```
┌──────────────────────────┐
│  Client (LLM/Agent)      │
│  (VS Code, CLI, etc.)    │
└──────────────┬───────────┘
               │ (Bidirectional JSON-RPC)
               │
┌──────────────┴───────────┐
│  MCP Runtime             │
│  (Coordinador)           │
└──────────────┬───────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐┌────────┐┌────────┐
│GitHub  ││Python  ││Database│
│ MCP    ││ MCP    ││  MCP   │
└────────┘└────────┘└────────┘
```

## Integración en mcp-efficiency-engine

### Archivos de Configuración

#### `.github/GITHUB_MCP_INTEGRATION.md`
- Documentación completa de arquitectura y capacidades
- Casos de uso implementables
- Configuración requerida
- Scripts de automatización
- Estrategia de seguridad

#### `.github/agents/github-repository-manager.agent.md`
- Agente especializado para control de repo
- Flujos automáticos
- Mapeo de comandos a scripts
- Reglas de guardrail
- Advanced workflows

### Scripts de Automatización

#### `scripts/github/sync-repo.ps1`
- Sincronización multi-repo (mcp-efficiency-engine ↔ boost_sertxIA)
- Detección automática de cambios
- Creación de PRs de draft
- Filtrado de archivos por patrón glob
- Modo DryRun para validación

**Uso:**
```powershell
.\sync-repo.ps1 -FilesPattern "projects/**" -DryRun
```

#### `scripts/github/create-devlog.ps1`
- Generación automática de devlogs técnicos
- Categorización de commits (features/fixes/refactor/docs/tests)
- Markdown formateado con enlaces a commits
- Creación automática de PRs
- Análisis de últimos N commits

**Uso:**
```powershell
.\create-devlog.ps1 -CommitsToAnalyze 20
```

#### `scripts/github/manage-issues.ps1`
- Gestión automática de issues y PRs
- Asignación de Copilot a issues
- Solicitud de reviews
- Auto-cierre de issues resueltas
- Reportes de actividad

**Uso:**
```powershell
.\manage-issues.ps1 -Action assign
```

### Documentación

#### `scripts/github/README.md`
- Guía completa de uso de scripts
- Ejemplos detallados
- Troubleshooting
- Mejores prácticas
- Integración con GitHub Actions

#### `README.md` (root)
- Sección "Control de Repositorio vía GitHub MCP"
- Quick start
- Referencias a documentación completa

## Referencias Relacionadas en boost_sertxIA

El agente `github-devlog-maintainer` en [boost_sertxIA](https://github.com/Sertxito/boost_sertxIA) inspiró esta integración:

- **Archivo:** `.github/agents/github-devlog-maintainer.agent.md`
- **URL:** https://github.com/Sertxito/boost_sertxIA/blob/main/.github/agents/github-devlog-maintainer.agent.md
- **Funcionalidades base:**
  - Análisis automático de repos
  - Detección de problemas técnicos
  - Generación de contenido publicable
  - Integración con múltiples plataformas

## Configuración de GitHub Token

### Crear PAT (Personal Access Token)

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token (classic)
3. **Scopes recomendados:**
   - `repo` — Acceso completo a public/private repos
   - `workflow` — Permisos para workflows
   - `admin:repo_hook` — Para webhooks si es necesario

4. **NO usar:**
   - `admin:org_hook` — Demasiado permisivo
   - `admin:*` — Scopes administrativos globales

### Configurar Token en Sistema

#### Windows
```powershell
# Credential Manager (permanente)
cmdkey /add:github.com /user:your-username /pass:ghp_xxxxxxxxxxxx

# Variable de entorno (sesión)
$env:GITHUB_TOKEN = "ghp_xxxxxxxxxxxx"

# Permanente en PowerShell Profile
Add-Content $PROFILE "`n`$env:GITHUB_TOKEN = 'ghp_xxxxxxxxxxxx'"
```

#### Linux/macOS
```bash
# Archivo
echo "ghp_xxxxxxxxxxxx" > ~/.github/token
chmod 600 ~/.github/token

# Variable de entorno
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"

# Permanente en ~/.bashrc o ~/.zshrc
echo 'export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"' >> ~/.bashrc
```

## GitHub CLI (gh)

### Instalación

```bash
# Windows
winget install GitHub.cli

# macOS
brew install gh

# Linux
sudo apt install gh  # o tu gestor de paquetes

# Verificar
gh --version
```

### Autenticación

```bash
# Login interactivo
gh auth login

# Verificar estado
gh auth status

# Renovar token
gh auth refresh
```

## Mejores Prácticas

### 1. Usar DryRun Primero

```powershell
# Ver qué hace antes de ejecutar
.\sync-repo.ps1 -DryRun
```

### 2. Validar Tokens Regularmente

```powershell
gh auth status
gh auth refresh
```

### 3. Monitorear Rate Limits

```powershell
# Verificar límites de API
gh api rate_limit
```

### 4. Auditoría de Cambios

```powershell
# Ver commits hechos por automation
gh api repos/Sertxito/mcp-efficiency-engine/commits \
  --jq '.[] | select(.author.login == "github-actions")'
```

### 5. Mantener Logs

```powershell
# Guardar output de scripts
.\sync-repo.ps1 | Tee-Object -FilePath "logs/sync-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
```

## Limitaciones y Consideraciones

### GitHub API Rate Limits

- **Unauthenticated:** 60 requests/hour
- **Authenticated:** 5,000 requests/hour
- **GraphQL:** Separate limits basados en puntos

### Operaciones que Requieren Permisos

- Push directo requiere `repo` scope
- Crear releases requiere `repo` scope
- Acceder a repos privados requiere `repo` scope

### Ejecutar en GitHub Actions

```yaml
# Usar secrets para token
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Recursos Adicionales

### Documentación Oficial

- [GitHub MCP Server - Oficial](https://github.com/github/github-mcp-server)
- [GitHub REST API v3](https://docs.github.com/en/rest)
- [GitHub GraphQL API](https://docs.github.com/en/graphql)
- [GitHub CLI Manual](https://cli.github.com/manual)
- [MCP Specification](https://modelcontextprotocol.io/)

### Documentación Local

- [.github/GITHUB_MCP_INTEGRATION.md](.github/GITHUB_MCP_INTEGRATION.md) — Guía completa de integración
- [.github/agents/github-repository-manager.agent.md](.github/agents/github-repository-manager.agent.md) — Agente especializado
- [scripts/github/README.md](scripts/github/README.md) — Uso de scripts

### Proyectos Relacionados

- [boost_sertxIA - GitHub Devlog Maintainer](https://github.com/Sertxito/boost_sertxIA)
- [MCP Ecosystem](https://modelcontextprotocol.io/ecosystem)

## Changelog

### v1.0 (2026-07-04)

- ✅ Documentación de GitHub MCP Integration creada
- ✅ Agente GitHub Repository Manager implementado
- ✅ Scripts de automatización (sync, devlog, manage-issues)
- ✅ Guía de uso y troubleshooting
- ✅ Integración con README.md
- ✅ Documento de referencias creado

### Próximos (Planned)

- ⏳ Integración con GitHub Actions workflows
- ⏳ Dashboard de monitoreo de actividad
- ⏳ Advanced workflows (release automation, etc.)
- ⏳ Webhooks para reactividad en tiempo real

## Contacto & Soporte

Para preguntas o problemas:

1. Verificar [scripts/github/README.md](scripts/github/README.md) — Troubleshooting
2. Revisar [.github/GITHUB_MCP_INTEGRATION.md](.github/GITHUB_MCP_INTEGRATION.md) — Configuración
3. Consultar oficial repo: https://github.com/github/github-mcp-server
4. Crear issue en: https://github.com/Sertxito/mcp-efficiency-engine/issues

---

**Última actualización:** 2026-07-04  
**Maintainer:** GitHub Repository Manager Agent  
**Fuente oficial:** https://github.com/github/github-mcp-server
