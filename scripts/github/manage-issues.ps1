#Requires -Version 7

<#
.SYNOPSIS
Gestiona issues y PRs con asignación automática de Copilot.

.DESCRIPTION
Realiza acciones automáticas en issues y PRs:
- Asignar Copilot a issues sin asignar
- Solicitar review de Copilot en PRs abiertas
- Auto-cerrar issues cuando PR relacionada se mergea

.PARAMETER Repo
Repositorio (owner/repo). Por defecto: Sertxito/mcp-efficiency-engine

.PARAMETER Action
Acción a ejecutar: assign, review, close. Por defecto: assign

.PARAMETER State
Estado de issues: open, closed. Por defecto: open

.PARAMETER DryRun
No hacer cambios, solo mostrar lo que haría.

.EXAMPLE
.\manage-issues.ps1 -Action assign

.EXAMPLE
.\manage-issues.ps1 -Action review -DryRun

#>

param(
  [string]$Repo = "Sertxito/mcp-efficiency-engine",
  [ValidateSet("assign", "review", "close")]
  [string]$Action = "assign",
  [ValidateSet("open", "closed")]
  [string]$State = "open",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Obtener issues sin asignar
function Get-UnassignedIssues {
  param([string]$Repo)
  
  Write-Host "Buscando issues sin asignar..."
  
  try {
    $issues = gh issue list --repo $Repo --state $State --assignee none --json number,title,labels
    return $issues | ConvertFrom-Json
  } catch {
    Write-Host "Error obteniendo issues: $_"
    return @()
  }
}

# Obtener PRs abiertas sin review
function Get-OpenPullRequests {
  param([string]$Repo)
  
  Write-Host "Buscando PRs abiertas..."
  
  try {
    $prs = gh pr list --repo $Repo --state open --json number,title,author
    return $prs | ConvertFrom-Json
  } catch {
    Write-Host "Error obteniendo PRs: $_"
    return @()
  }
}

# Asignar Copilot a issue
function Assign-CopilotToIssue {
  param([string]$Repo, [int]$IssueNumber)
  
  Write-Host "  Asignando Copilot a issue #$IssueNumber..."
  
  if ($DryRun) {
    Write-Host "  [DRY-RUN] Asignaría Copilot a issue #$IssueNumber"
    return $true
  }
  
  try {
    # Usar GitHub MCP: assign_copilot_to_issue
    $body = @{
      assignee = "copilot"
    } | ConvertTo-Json
    
    gh api repos/$Repo/issues/$IssueNumber \
      -X PATCH \
      -H "Accept: application/vnd.github+json" \
      -f assignees=copilot | Out-Null
    
    Write-Host "  ✓ Copilot asignado a #$IssueNumber"
    return $true
  } catch {
    Write-Host "  ⚠ Error asignando Copilot: $_"
    return $false
  }
}

# Solicitar review de Copilot en PR
function Request-CopilotReview {
  param([string]$Repo, [int]$PRNumber)
  
  Write-Host "  Solicitando review de Copilot para PR #$PRNumber..."
  
  if ($DryRun) {
    Write-Host "  [DRY-RUN] Solicitaría review de Copilot para PR #$PRNumber"
    return $true
  }
  
  try {
    # Usar GitHub MCP: request_copilot_review
    gh api repos/$Repo/pulls/$PRNumber/requested_reviewers \
      -X POST \
      -H "Accept: application/vnd.github+json" \
      -f reviewers=copilot | Out-Null
    
    Write-Host "  ✓ Review de Copilot solicitado para #$PRNumber"
    return $true
  } catch {
    Write-Host "  ⚠ Error solicitando review: $_"
    return $false
  }
}

# Auto-cerrar issue si PR relacionada merged
function Auto-CloseResolvedIssues {
  param([string]$Repo)
  
  Write-Host "Buscando issues para auto-cerrar..."
  
  try {
    $closedPRs = gh pr list --repo $Repo --state closed --merged --limit 20 `
      --json number,title,body,closedAt | ConvertFrom-Json
    
    $closed = 0
    foreach ($pr in $closedPRs) {
      # Buscar referencias a issues en PR (Closes #123, Fixes #456, etc.)
      $issueMatches = [regex]::Matches($pr.body, '#(\d+)')
      
      foreach ($match in $issueMatches) {
        $issueNum = $match.Groups[1].Value
        
        # Verificar si issue aún está abierta
        $issue = gh api repos/$Repo/issues/$issueNum | ConvertFrom-Json
        
        if ($issue.state -eq "open") {
          Write-Host "  Auto-cerrando issue #$issueNum (referenced en PR #$($pr.number))..."
          
          if ($DryRun) {
            Write-Host "  [DRY-RUN] Cerraría issue #$issueNum"
            $closed++
            continue
          }
          
          # Cerrar issue
          gh api repos/$Repo/issues/$issueNum \
            -X PATCH \
            -H "Accept: application/vnd.github+json" \
            -f state=closed \
            -f state_reason=completed | Out-Null
          
          Write-Host "  ✓ Issue #$issueNum cerrada"
          $closed++
        }
      }
    }
    
    return $closed
  } catch {
    Write-Host "Error en auto-close: $_"
    return 0
  }
}

# Agregar etiquetas a issues
function Add-LabelsToIssue {
  param([string]$Repo, [int]$IssueNumber, [array]$Labels)
  
  Write-Host "  Agregando etiquetas a issue #$IssueNumber..."
  
  if ($DryRun) {
    Write-Host "  [DRY-RUN] Agregaría etiquetas: $($Labels -join ', ')"
    return $true
  }
  
  try {
    $labelJson = $Labels | ConvertTo-Json
    
    gh api repos/$Repo/issues/$IssueNumber/labels \
      -X POST \
      -H "Accept: application/vnd.github+json" `
      --input - << $labelJson | Out-Null
    
    Write-Host "  ✓ Etiquetas agregadas"
    return $true
  } catch {
    Write-Host "  ⚠ Error agregando etiquetas: $_"
    return $false
  }
}

# Generar reporte de actividad
function Get-ActivityReport {
  param([string]$Repo, [int]$AssignedCount, [int]$ReviewsRequested, [int]$IssuesClosed)
  
  $report = @"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reporte de Gestión de Issues
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Actividad Realizada:

  🎯 Issues asignados a Copilot: $AssignedCount
  👁️  Reviews solicitados: $ReviewsRequested
  ✓ Issues auto-cerradas: $IssuesClosed

📌 Próximos Pasos:

  1. Revisar issues asignados a Copilot
  2. Verificar reviews de Copilot en PRs
  3. Validar closes automáticos

🔗 Repositorio: https://github.com/$Repo
   Issues: https://github.com/$Repo/issues
   PRs: https://github.com/$Repo/pulls

"@

  return $report
}

# ===================
# Main Execution
# ===================

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "GitHub MCP Issue Manager"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host ""
Write-Host "Repositorio: $Repo"
Write-Host "Acción: $Action"
Write-Host "Estado: $State"

if ($DryRun) {
  Write-Host "🔍 Modo DRY-RUN"
}
Write-Host ""

$assigned = 0
$reviewsRequested = 0
$closed = 0

switch ($Action) {
  "assign" {
    Write-Host "Asignando Copilot a issues sin asignar..."
    Write-Host ""
    
    $issues = Get-UnassignedIssues -Repo $Repo
    
    if ($issues.Count -eq 0) {
      Write-Host "✓ No hay issues sin asignar"
    } else {
      Write-Host "Encontrados $($issues.Count) issues:"
      Write-Host ""
      
      foreach ($issue in $issues) {
        Write-Host "  #$($issue.number) — $($issue.title)"
        
        # Asignar
        if (Assign-CopilotToIssue -Repo $Repo -IssueNumber $issue.number) {
          $assigned++
        }
      }
    }
    
    Write-Host ""
    Write-Host "✓ Asignación completada: $assigned issues"
  }
  
  "review" {
    Write-Host "Solicitando reviews de Copilot en PRs..."
    Write-Host ""
    
    $prs = Get-OpenPullRequests -Repo $Repo
    
    if ($prs.Count -eq 0) {
      Write-Host "✓ No hay PRs abiertas"
    } else {
      Write-Host "Encontradas $($prs.Count) PRs:"
      Write-Host ""
      
      foreach ($pr in $prs) {
        Write-Host "  #$($pr.number) — $($pr.title) (por @$($pr.author.login))"
        
        # Solicitar review
        if (Request-CopilotReview -Repo $Repo -PRNumber $pr.number) {
          $reviewsRequested++
        }
      }
    }
    
    Write-Host ""
    Write-Host "✓ Reviews solicitados: $reviewsRequested PRs"
  }
  
  "close" {
    Write-Host "Buscando issues para auto-cerrar..."
    Write-Host ""
    
    $closed = Auto-CloseResolvedIssues -Repo $Repo
    
    Write-Host ""
    Write-Host "✓ Issues auto-cerradas: $closed"
  }
}

Write-Host ""

# Mostrar reporte final
$report = Get-ActivityReport -Repo $Repo `
  -AssignedCount $assigned `
  -ReviewsRequested $reviewsRequested `
  -IssuesClosed $closed

Write-Host $report

Write-Host "✓ Gestión de issues completada"
