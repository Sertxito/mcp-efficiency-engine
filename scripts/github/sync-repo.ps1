#Requires -Version 7

<#
.SYNOPSIS
Sincroniza cambios entre repositorios principales mediante GitHub MCP.

.DESCRIPTION
Detecta cambios en SourceRepo, filtra por patrón de archivos, y crea PR en TargetRepo.
Usa GitHub MCP Server para operaciones automatizadas.

.PARAMETER SourceRepo
Repo origen (owner/repo). Por defecto: Sertxito/mcp-efficiency-engine

.PARAMETER TargetRepo
Repo destino (owner/repo). Por defecto: Sertxito/boost_sertxIA

.PARAMETER FilesPattern
Patrón glob para filtrar archivos a sincronizar. Por defecto: projects/**

.PARAMETER BranchName
Nombre de rama para PR. Por defecto: sync/{timestamp}

.EXAMPLE
.\sync-repo.ps1 -FilesPattern "projects/**" -DryRun

.EXAMPLE
.\sync-repo.ps1 -SourceRepo "Sertxito/mcp-efficiency-engine" -TargetRepo "Sertxito/boost_sertxIA"

#>

param(
  [string]$SourceRepo = "Sertxito/mcp-efficiency-engine",
  [string]$TargetRepo = "Sertxito/boost_sertxIA",
  [string]$FilesPattern = "projects/**",
  [string]$BranchName = "sync/$(Get-Date -Format 'yyyyMMdd-HHmmss')",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Verificar MCP GitHub disponible
function Test-MCPGitHub {
  try {
    $result = gh api --version 2>&1
    Write-Host "✓ GitHub CLI disponible: $result"
    return $true
  } catch {
    Write-Host "✗ GitHub CLI no disponible. Instalar con: gh --version"
    return $false
  }
}

# Obtener cambios entre branches
function Get-RepoChanges {
  param([string]$Repo, [string]$BaseBranch = "main")
  
  Write-Host "Detectando cambios en $Repo/$BaseBranch..."
  
  try {
    $commits = gh api repos/$Repo/commits --limit 20 | ConvertFrom-Json
    $files = @()
    
    foreach ($commit in $commits) {
      $commit_data = gh api repos/$Repo/commits/$($commit.sha) | ConvertFrom-Json
      $files += $commit_data.files | Where-Object { $_.filename -like $FilesPattern }
    }
    
    return $files | Sort-Object filename -Unique
  } catch {
    Write-Host "Error al obtener cambios: $_"
    return @()
  }
}

# Crear rama en repo destino
function New-TargetBranch {
  param([string]$Repo, [string]$Branch)
  
  Write-Host "Creando rama $Branch en $Repo..."
  
  if ($DryRun) {
    Write-Host "[DRY-RUN] gh api repos/$Repo/git/refs -H 'Accept: application/vnd.github+json' -f ref=refs/heads/$Branch"
    return $true
  }
  
  try {
    # Obtener ref actual
    $mainRef = gh api repos/$Repo/git/refs/heads/main | ConvertFrom-Json
    
    # Crear nueva rama
    gh api repos/$Repo/git/refs `
      -H 'Accept: application/vnd.github+json' `
      -f ref=refs/heads/$Branch `
      -f sha=$mainRef.object.sha
    
    Write-Host "✓ Rama creada: $Branch"
    return $true
  } catch {
    Write-Host "✗ Error creando rama: $_"
    return $false
  }
}

# Sincronizar archivos
function Sync-Files {
  param(
    [string]$SourceRepo,
    [string]$TargetRepo,
    [string]$TargetBranch,
    [array]$Files
  )
  
  Write-Host "Sincronizando $($Files.Count) archivos..."
  
  $synced = 0
  foreach ($file in $Files) {
    try {
      $filePath = $file.filename
      Write-Host "  Sincronizando: $filePath"
      
      # Obtener contenido del archivo fuente
      $content = gh api repos/$SourceRepo/contents/$filePath | ConvertFrom-Json
      $fileContent = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($content.content))
      
      if ($DryRun) {
        Write-Host "  [DRY-RUN] Actualizaría $filePath"
        $synced++
        continue
      }
      
      # Intentar obtener SHA actual en destino
      $targetFile = gh api repos/$TargetRepo/contents/$filePath --jq '.sha' 2>$null || $null
      
      # Crear/actualizar archivo en destino
      $params = @{
        message = "sync: Sincronizar $filePath desde $SourceRepo"
        content = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($fileContent))
        branch = $TargetBranch
      }
      
      if ($targetFile) {
        $params.sha = $targetFile
      }
      
      gh api repos/$TargetRepo/contents/$filePath -X PUT @params | Out-Null
      
      Write-Host "  ✓ $filePath sincronizado"
      $synced++
    } catch {
      Write-Host "  ⚠ Error sincronizando $($file.filename): $_"
    }
  }
  
  return $synced
}

# Crear PR de sincronización
function New-SyncPullRequest {
  param(
    [string]$TargetRepo,
    [string]$TargetBranch,
    [int]$FileCount
  )
  
  $title = "sync: Sincronizar cambios desde $SourceRepo"
  $body = @"
## Sincronización Automática

**Origen:** $SourceRepo
**Destino:** $TargetRepo
**Archivos sincronizados:** $FileCount

### Patrón de archivos
\`\`\`
$FilesPattern
\`\`\`

### Verificación
- [ ] Revisar cambios
- [ ] Ejecutar validaciones locales
- [ ] Confirmar comportamiento esperado

### Referencias
- Source commit: $(gh api repos/$SourceRepo/commits/main --jq '.sha' | Cut -c 1-7)
- Sincronizado automáticamente vía GitHub MCP
"@
  
  if ($DryRun) {
    Write-Host "[DRY-RUN] Crearría PR:"
    Write-Host "  Título: $title"
    Write-Host "  Rama: $TargetBranch"
    return $true
  }
  
  try {
    $pr = gh pr create `
      --repo "$TargetRepo" `
      --base main `
      --head $TargetBranch `
      --title $title `
      --body $body `
      --draft
    
    Write-Host "✓ PR creada: $pr"
    return $true
  } catch {
    Write-Host "✗ Error creando PR: $_"
    return $false
  }
}

# ===================
# Main Execution
# ===================

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "GitHub MCP Repo Synchronizer"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host ""
Write-Host "Origen:  $SourceRepo"
Write-Host "Destino: $TargetRepo"
Write-Host "Patrón:  $FilesPattern"
Write-Host "Rama:    $BranchName"

if ($DryRun) {
  Write-Host "🔍 Modo DRY-RUN: No se realizarán cambios"
}
Write-Host ""

# 1. Verificar MCP GitHub
if (-not (Test-MCPGitHub)) {
  exit 1
}

# 2. Obtener cambios
$changes = Get-RepoChanges -Repo $SourceRepo
if ($changes.Count -eq 0) {
  Write-Host "ℹ No hay cambios que sincronizar"
  exit 0
}

Write-Host "Encontrados $($changes.Count) cambios"
Write-Host ""

# 3. Crear rama destino
if (-not (New-TargetBranch -Repo $TargetRepo -Branch $BranchName)) {
  exit 1
}

# 4. Sincronizar archivos
$synced = Sync-Files -SourceRepo $SourceRepo -TargetRepo $TargetRepo `
  -TargetBranch $BranchName -Files $changes

Write-Host ""
Write-Host "Sincronizados: $synced/$($changes.Count) archivos"

if ($synced -gt 0) {
  # 5. Crear PR
  if (-not $DryRun) {
    New-SyncPullRequest -TargetRepo $TargetRepo -TargetBranch $BranchName -FileCount $synced
  } else {
    Write-Host "[DRY-RUN] PR sería creada con $synced archivos"
  }
}

Write-Host ""
Write-Host "✓ Sincronización completada"
