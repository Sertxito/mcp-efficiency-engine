# Guía de Instalación y Uso — GitHub MCP Scripts

## ✅ Lo que NECESITAS

Solo necesitas estas dos cosas:

1. **GitHub CLI (`gh`)** — Disponible en todas las plataformas
2. **PowerShell 7+** — Para ejecutar scripts

## ❌ Lo que NO NECESITAS

- ~~`npm install -g @github/mcp-github-server`~~ (no existe en npm registry)
- ~~MCP Server local~~ (no es necesario para estos scripts)

Los scripts usan `gh` CLI que ya está optimizado para GitHub.

---

## Instalación Rápida

### Opción 1: Windows (Recomendado)

```powershell
# 1. Instalar GitHub CLI
winget install GitHub.cli

# 2. Instalar PowerShell 7 (si no tienes)
winget install Microsoft.PowerShell

# 3. Reinicia terminal

# 4. Login
gh auth login

# 5. Configura token (permanente)
$env:GITHUB_TOKEN = "ghp_xxxxxxxxxxxxxxxxxxxx"
Add-Content $PROFILE "`n`$env:GITHUB_TOKEN = 'ghp_xxxxxxxxxxxxxxxxxxxx'"

# 6. Verifica
gh auth status
```

### Opción 2: macOS

```bash
# 1. Instalar GitHub CLI
brew install gh

# 2. PowerShell (opcional, ya tienes bash)
brew install powershell

# 3. Login
gh auth login

# 4. Configura token
echo 'export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"' >> ~/.zshrc
source ~/.zshrc

# 5. Verifica
gh auth status
```

### Opción 3: Linux (Ubuntu/Debian)

```bash
# 1. Instalar GitHub CLI
sudo apt install gh

# 2. Instalar PowerShell
sudo apt install powershell

# 3. Login
gh auth login

# 4. Configura token
echo 'export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"' >> ~/.bashrc
source ~/.bashrc

# 5. Verifica
gh auth status
```

---

## Crear GitHub Personal Access Token (PAT)

1. **GitHub Settings:**
   - https://github.com/settings/tokens

2. **Generate new token (classic):**
   - Name: `MCP Efficiency Engine`
   - Scopes: `repo`, `workflow`
   - Expiration: 30 days (renovar después)

3. **Copiar token:**
   ```
   ghp_xxxxxxxxxxxxxxxxxxxx
   ```

4. **Guardar en tu sistema:**
   - Windows: `cmdkey /add:github.com /user:username /pass:ghp_xxxx`
   - macOS/Linux: `echo 'export GITHUB_TOKEN="ghp_xxxx"' >> ~/.bashrc`

---

## Usar los Scripts Localmente

### Paso 1: Clonar Repo

```bash
git clone https://github.com/Sertxito/mcp-efficiency-engine.git
cd mcp-efficiency-engine
```

### Paso 2: Ejecutar Scripts

#### Sincronizar Repos (Preview)

```powershell
# Ver qué haría sin hacer cambios
pwsh scripts/github/sync-repo.ps1 -FilesPattern "projects/**" -DryRun
```

#### Generar DevLog

```powershell
# Generar devlog con últimos 20 commits
pwsh scripts/github/create-devlog.ps1 -CommitsToAnalyze 20

# Ver preview sin crear archivo
pwsh scripts/github/create-devlog.ps1 -DryRun
```

#### Gestionar Issues

```powershell
# Asignar Copilot a issues sin asignar
pwsh scripts/github/manage-issues.ps1 -Action assign

# Solicitar reviews de Copilot en PRs
pwsh scripts/github/manage-issues.ps1 -Action review

# Auto-cerrar issues resueltas
pwsh scripts/github/manage-issues.ps1 -Action close
```

---

## Uso en GitHub Actions (CI/CD)

Los workflows ya están configurados. Se ejecutan automáticamente:

| Workflow | Trigger | Qué Hace |
|----------|---------|---------|
| **auto-sync.yml** | Push a main (projects/) | Sincroniza cambios a boost_sertxIA |
| **auto-devlog.yml** | Push a main | Genera devlog de commits |
| **auto-manage-issues.yml** | Lunes 9 AM | Gestiona issues automáticamente |

### Trigger Manual

```bash
# Desde tu terminal local
gh workflow run auto-sync.yml -r main
gh workflow run auto-devlog.yml -r main
gh workflow run auto-manage-issues.yml -r main
```

### Ver Resultados

```bash
# Ver workflows en ejecución
gh workflow list

# Ver runs de un workflow
gh run list

# Ver logs de un run
gh run view <run-id> --log
```

---

## Troubleshooting

### Error: "GitHub CLI not found"

```bash
# Instalar
# Windows
winget install GitHub.cli

# macOS
brew install gh

# Linux
sudo apt install gh
```

### Error: "Not authenticated"

```bash
# Login
gh auth login

# Verificar
gh auth status
```

### Error: "Token expired or invalid"

```bash
# Renovar token en: https://github.com/settings/tokens
# Guardar nueva vez:
$env:GITHUB_TOKEN = "ghp_nuevo_token"
```

### Error: "Rate limit exceeded"

GitHub API tiene límites:
- **Unauthenticated:** 60 requests/hora
- **Authenticated:** 5,000 requests/hora

Si ves este error, espera 1 hora o reduce cantidad de operaciones.

### Error: "Permission denied"

```bash
# Verificar permisos del token
gh auth status

# El token debe tener:
# - repo (acceso a repositorios)
# - workflow (permisos para workflows)
```

---

## Cambios Clave Desde v1.0

### Setup Simplificado

- ✅ Eliminado requisito de `npm install -g @github/mcp-github-server`
- ✅ Solo necesitas `gh` CLI (disponible everywhere)
- ✅ Funciona en CI/CD sin configuración extra

### Workflows Añadidos

- ✅ `auto-sync.yml` — Sincronización automática
- ✅ `auto-devlog.yml` — DevLog automático
- ✅ `auto-manage-issues.yml` — Gestión de issues

### Documentación

- ✅ Guía de instalación simplificada
- ✅ Troubleshooting actualizado
- ✅ Ejemplos de uso locales + CI/CD

---

## Próximos Pasos

1. **Instalar localmente:**
   ```powershell
   winget install GitHub.cli
   gh auth login
   ```

2. **Test un script:**
   ```powershell
   pwsh scripts/github/manage-issues.ps1 -Action assign -DryRun
   ```

3. **Verificar workflows activos:**
   ```bash
   gh workflow list
   ```

4. **Personalizar según necesidad:**
   - Editar `.github/workflows/*.yml`
   - Ajustar triggers (schedules, paths)
   - Agregar más acciones

---

## Referencias

- [GitHub CLI Documentation](https://cli.github.com/)
- [GitHub REST API](https://docs.github.com/en/rest)
- [Scripts README](./README.md)
- [GitHub MCP Integration Guide](../.github/GITHUB_MCP_INTEGRATION.md)

---

**Última actualización:** 2026-07-04  
**Estado:** ✅ Guía completa + Workflows listos para usar
