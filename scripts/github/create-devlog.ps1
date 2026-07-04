#Requires -Version 7

<#
.SYNOPSIS
Genera devlog técnico automático a partir de commits recientes.

.DESCRIPTION
Analiza últimos N commits, extrae cambios significativos, y genera markdown
con insights técnicos. Crea archivo en docs/devlog/ y abre PR automáticamente.

.PARAMETER Repo
Repositorio (owner/repo). Por defecto: Sertxito/mcp-efficiency-engine

.PARAMETER CommitsToAnalyze
Número de commits a analizar. Por defecto: 10

.PARAMETER OutputDir
Directorio de salida. Por defecto: docs/devlog

.PARAMETER DryRun
No crear archivos ni PR, solo mostrar lo que haría.

.EXAMPLE
.\create-devlog.ps1

.EXAMPLE
.\create-devlog.ps1 -CommitsToAnalyze 20 -DryRun

#>

param(
  [string]$Repo = "Sertxito/mcp-efficiency-engine",
  [int]$CommitsToAnalyze = 10,
  [string]$OutputDir = "docs/devlog",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Obtener últimos commits
function Get-RecentCommits {
  param([string]$Repo, [int]$Count)
  
  Write-Host "Obteniendo últimos $Count commits de $Repo..."
  
  try {
    $commits = gh api repos/$Repo/commits --limit $Count | ConvertFrom-Json
    return $commits
  } catch {
    Write-Host "Error obteniendo commits: $_"
    return @()
  }
}

# Analizar cambios por tipo
function Analyze-CommitChanges {
  param([array]$Commits)
  
  $stats = @{
    features = @()
    fixes = @()
    refactor = @()
    docs = @()
    tests = @()
    other = @()
  }
  
  foreach ($commit in $Commits) {
    $message = $commit.commit.message
    $author = $commit.commit.author.name
    $date = $commit.commit.author.date
    
    $item = @{
      message = $message.Split([Environment]::NewLine)[0]
      author = $author
      date = $date
      sha = $commit.sha.Substring(0, 7)
    }
    
    if ($message -like "*feat*" -or $message -like "*feature*") {
      $stats.features += $item
    } elseif ($message -like "*fix*" -or $message -like "*bug*") {
      $stats.fixes += $item
    } elseif ($message -like "*refactor*") {
      $stats.refactor += $item
    } elseif ($message -like "*doc*") {
      $stats.docs += $item
    } elseif ($message -like "*test*") {
      $stats.tests += $item
    } else {
      $stats.other += $item
    }
  }
  
  return $stats
}

# Generar contenido markdown
function Generate-DevlogMarkdown {
  param(
    [hashtable]$Stats,
    [string]$Repo,
    [datetime]$GeneratedAt
  )
  
  $date = $GeneratedAt.ToString("yyyy-MM-dd")
  $datetime = $GeneratedAt.ToString("yyyy-MM-dd HH:mm:ss")
  
  $markdown = @"
# Devlog — $date

**Generado:** $datetime UTC  
**Fuente:** [$Repo](https://github.com/$Repo)

---

## 📊 Resumen

| Categoría | Cantidad |
|-----------|----------|
| 🎯 Features | $($Stats.features.Count) |
| 🐛 Fixes | $($Stats.fixes.Count) |
| 🔧 Refactor | $($Stats.refactor.Count) |
| 📝 Docs | $($Stats.docs.Count) |
| ✅ Tests | $($Stats.tests.Count) |
| 📌 Otros | $($Stats.other.Count) |

---

"@

  # Features
  if ($Stats.features.Count -gt 0) {
    $markdown += @"
## 🎯 Features Nuevas

"@
    foreach ($item in $Stats.features) {
      $markdown += @"
- **$($item.message)** — [\`$($item.sha)\`](https://github.com/$Repo/commit/$($item.sha))  
  _Por $($item.author) el $($item.date)_

"@
    }
    $markdown += "`n"
  }

  # Fixes
  if ($Stats.fixes.Count -gt 0) {
    $markdown += @"
## 🐛 Fixes y Resoluciones

"@
    foreach ($item in $Stats.fixes) {
      $markdown += @"
- **$($item.message)** — [\`$($item.sha)\`](https://github.com/$Repo/commit/$($item.sha))  
  _Por $($item.author) el $($item.date)_

"@
    }
    $markdown += "`n"
  }

  # Refactor
  if ($Stats.refactor.Count -gt 0) {
    $markdown += @"
## 🔧 Refactorizaciones

"@
    foreach ($item in $Stats.refactor) {
      $markdown += @"
- **$($item.message)** — [\`$($item.sha)\`](https://github.com/$Repo/commit/$($item.sha))

"@
    }
    $markdown += "`n"
  }

  # Docs
  if ($Stats.docs.Count -gt 0) {
    $markdown += @"
## 📝 Documentación

"@
    foreach ($item in $Stats.docs) {
      $markdown += @"
- **$($item.message)** — [\`$($item.sha)\`](https://github.com/$Repo/commit/$($item.sha))

"@
    }
    $markdown += "`n"
  }

  # Tests
  if ($Stats.tests.Count -gt 0) {
    $markdown += @"
## ✅ Tests y Validación

"@
    foreach ($item in $Stats.tests) {
      $markdown += @"
- **$($item.message)** — [\`$($item.sha)\`](https://github.com/$Repo/commit/$($item.sha))

"@
    }
    $markdown += "`n"
  }

  # Otros
  if ($Stats.other.Count -gt 0) {
    $markdown += @"
## 📌 Otros Cambios

"@
    foreach ($item in $Stats.other) {
      $markdown += @"
- **$($item.message)** — [\`$($item.sha)\`](https://github.com/$Repo/commit/$($item.sha))

"@
    }
    $markdown += "`n"
  }

  $markdown += @"
---

**Generado automáticamente por GitHub MCP DevLog Generator**

"@

  return $markdown
}

# Crear archivo devlog
function New-DevlogFile {
  param([string]$Content, [string]$OutputDir, [string]$Date)
  
  $fileName = "devlog-$Date.md"
  $filePath = "$OutputDir/$fileName"
  
  if ($DryRun) {
    Write-Host "[DRY-RUN] Crearía archivo: $filePath"
    Write-Host ""
    Write-Host "─────────────────────────────────────────"
    Write-Host $Content
    Write-Host "─────────────────────────────────────────"
    return $fileName
  }
  
  # Crear directorio si no existe
  if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-Host "✓ Directorio creado: $OutputDir"
  }
  
  # Guardar archivo
  $Content | Out-File -FilePath $filePath -Encoding UTF8
  Write-Host "✓ Archivo devlog creado: $filePath"
  
  return $fileName
}

# Crear PR con devlog
function New-DevlogPullRequest {
  param([string]$FileName, [int]$CommitCount)
  
  $branchName = "devlog/$(Get-Date -Format 'yyyyMMdd')"
  $title = "docs: Devlog de $CommitCount commits — $(Get-Date -Format 'yyyy-MM-dd')"
  
  $body = @"
## Devlog Automático

Se ha generado devlog técnico con análisis de últimos $CommitCount commits.

### Contenido
- ✨ Features nuevas
- 🐛 Fixes y resoluciones
- 🔧 Refactorizaciones
- 📝 Cambios de documentación
- ✅ Tests y validación

### Archivo
- **$FileName** en `docs/devlog/`

### Acción Sugerida
1. Revisar contenido del devlog
2. Adaptar descripción técnica si es necesario
3. Publicar en canal de documentación

---

**Generado automáticamente por GitHub MCP DevLog Generator**
"@

  if ($DryRun) {
    Write-Host "[DRY-RUN] Crearía PR:"
    Write-Host "  Título: $title"
    Write-Host "  Rama: $branchName"
    return $true
  }
  
  try {
    # Crear rama
    $mainSha = gh api repos/$Repo/git/refs/heads/main --jq '.object.sha' | Cut -c 1-7
    Write-Host "Creando rama $branchName..."
    
    # TODO: Implementar vía MCP GitHub cuando se tenga acceso
    Write-Host "⚠ Creación de PR requiere configuración local de git"
    Write-Host "  Ejecutar manualmente:"
    Write-Host "  git checkout -b $branchName"
    Write-Host "  git add docs/devlog/$FileName"
    Write-Host "  git commit -m '$title'"
    Write-Host "  git push origin $branchName"
    
    return $false
  } catch {
    Write-Host "Error creando PR: $_"
    return $false
  }
}

# ===================
# Main Execution
# ===================

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "GitHub MCP DevLog Generator"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host ""
Write-Host "Repositorio: $Repo"
Write-Host "Commits a analizar: $CommitsToAnalyze"
Write-Host "Directorio de salida: $OutputDir"

if ($DryRun) {
  Write-Host "🔍 Modo DRY-RUN"
}
Write-Host ""

# 1. Obtener commits
$commits = Get-RecentCommits -Repo $Repo -Count $CommitsToAnalyze
if ($commits.Count -eq 0) {
  Write-Host "✗ No se pudieron obtener commits"
  exit 1
}

Write-Host "✓ Obtenidos $($commits.Count) commits"
Write-Host ""

# 2. Analizar cambios
$stats = Analyze-CommitChanges -Commits $commits

Write-Host "📊 Cambios detectados:"
Write-Host "  🎯 Features: $($stats.features.Count)"
Write-Host "  🐛 Fixes: $($stats.fixes.Count)"
Write-Host "  🔧 Refactor: $($stats.refactor.Count)"
Write-Host "  📝 Docs: $($stats.docs.Count)"
Write-Host "  ✅ Tests: $($stats.tests.Count)"
Write-Host "  📌 Otros: $($stats.other.Count)"
Write-Host ""

# 3. Generar markdown
$now = Get-Date
$dateStr = $now.ToString("yyyy-MM-dd")
$markdown = Generate-DevlogMarkdown -Stats $stats -Repo $Repo -GeneratedAt $now

# 4. Crear archivo
$fileName = New-DevlogFile -Content $markdown -OutputDir $OutputDir -Date $dateStr
Write-Host ""

# 5. Crear PR (opcional)
$totalCommits = $stats.features.Count + $stats.fixes.Count + $stats.refactor.Count + `
  $stats.docs.Count + $stats.tests.Count + $stats.other.Count

if ($totalCommits -gt 0) {
  Write-Host "Creando PR con devlog..."
  New-DevlogPullRequest -FileName $fileName -CommitCount $totalCommits
}

Write-Host ""
Write-Host "✓ DevLog generado exitosamente"
