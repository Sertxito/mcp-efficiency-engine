param(
    [switch]$SkipRegistryValidation,
    [switch]$SkipRoutingEvals,
    [switch]$SkipCodegraphStatus,
    [switch]$SkipGitSnapshot,
    [switch]$SkipGraphRefresh,
    [switch]$SkipIntakeRefresh,
    [switch]$SkipSiblingDiscoveryRefresh,
    [switch]$SkipRepomixRefresh,
    [switch]$SkipProjectNotesRefresh,
    [switch]$SkipLearningRefresh,
    [switch]$SkipIterationValueRefresh,
    [switch]$SkipCopilotUsageIngest,
    [switch]$SkipChatTokenUsageReport
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PythonCommand {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        return @('py', '-3')
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        return @('python')
    }
    throw 'Python is required (py or python not found in PATH).'
}

function New-StepResult {
    param(
        [string]$Name,
        [bool]$Required,
        [bool]$Success,
        [double]$DurationSec,
        [string]$Message
    )

    return [ordered]@{
        name = $Name
        required = $Required
        success = $Success
        duration_sec = [math]::Round($DurationSec, 2)
        message = $Message
    }
}

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action,
        [bool]$Required = $true
    )

    $start = Get-Date
    $success = $false
    $message = 'ok'

    try {
        & $Action
        $success = $true
        Write-Host "[ok] $Name" -ForegroundColor Green
    }
    catch {
        $message = $_.Exception.Message
        if ($Required) {
            $script:HasFailures = $true
            Write-Host "[fail] $Name -> $message" -ForegroundColor Red
        }
        else {
            Write-Host "[info] $Name -> $message" -ForegroundColor DarkYellow
        }
    }

    $duration = ((Get-Date) - $start).TotalSeconds
    $script:Steps += (New-StepResult -Name $Name -Required $Required -Success $success -DurationSec $duration -Message $message)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

$script:Steps = @()
$script:HasFailures = $false
$startedAt = Get-Date

Write-Host '=== BYE SHUTDOWN ===' -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"
Write-Host "Time: $startedAt"

if (-not $SkipRegistryValidation) {
    Invoke-Step -Name 'Validate repo registry (strict)' -Action {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\intake\validate-repo-registry.ps1 -Strict
        if ($LASTEXITCODE -ne 0) {
            throw "validate-repo-registry failed with exit code $LASTEXITCODE"
        }
    } -Required $true
}
else {
    Write-Host '[skip] Validate repo registry (strict)'
}

if (-not $SkipRoutingEvals) {
    Invoke-Step -Name 'Run routing evals' -Action {
        $py = Get-PythonCommand
        $cmd = $py[0]
        $pyParts = @()
        if ($py.Length -gt 1) {
            $pyParts = $py[1..($py.Length - 1)]
        }

        & $cmd @pyParts .\scripts\intake\run-routing-evals.py
        if ($LASTEXITCODE -ne 0) {
            throw "run-routing-evals failed with exit code $LASTEXITCODE"
        }
    } -Required $true
}
else {
    Write-Host '[skip] Run routing evals'
}

if (-not $SkipGraphRefresh) {
    Invoke-Step -Name 'Refresh codegraph index sync' -Action {
        if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
            throw 'codegraph command not found'
        }

        & codegraph sync
        if ($LASTEXITCODE -ne 0) {
            throw "codegraph sync failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh codegraph index sync'
}

if (-not $SkipIntakeRefresh) {
    Invoke-Step -Name 'Refresh repo intake artifacts' -Action {
        & .\scripts\intake\run-repo-intake.cmd
        if ($LASTEXITCODE -ne 0) {
            throw "run-repo-intake failed with exit code $LASTEXITCODE"
        }
    } -Required $true
}
else {
    Write-Host '[skip] Refresh repo intake artifacts'
}

if (-not $SkipSiblingDiscoveryRefresh) {
    Invoke-Step -Name 'Refresh sibling repos discovery proposal' -Action {
        $py = Get-PythonCommand
        $cmd = $py[0]
        $pyParts = @()
        if ($py.Length -gt 1) {
            $pyParts = $py[1..($py.Length - 1)]
        }

        & $cmd @pyParts .\scripts\discovery\discover-boost-repos.py --root C:/repo
        if ($LASTEXITCODE -ne 0) {
            throw "discover-boost-repos failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh sibling repos discovery proposal'
}

if (-not $SkipRepomixRefresh) {
    Invoke-Step -Name 'Refresh repomix context export' -Action {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\context\build-repomix.ps1
        if ($LASTEXITCODE -ne 0) {
            throw "build-repomix failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh repomix context export'
}

if (-not $SkipProjectNotesRefresh) {
    Invoke-Step -Name 'Refresh project notes from observability' -Action {
        $py = Get-PythonCommand
        $cmd = $py[0]
        $pyParts = @()
        if ($py.Length -gt 1) {
            $pyParts = $py[1..($py.Length - 1)]
        }

        & $cmd @pyParts .\scripts\discovery\refresh-project-notes.py
        if ($LASTEXITCODE -ne 0) {
            throw "refresh-project-notes failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh project notes from observability'
}

if (-not $SkipLearningRefresh) {
    Invoke-Step -Name 'Refresh learning loop report' -Action {
        $py = Get-PythonCommand
        $cmd = $py[0]
        $pyParts = @()
        if ($py.Length -gt 1) {
            $pyParts = $py[1..($py.Length - 1)]
        }

        & $cmd @pyParts .\scripts\learning\learning-loop-report.py
        if ($LASTEXITCODE -ne 0) {
            throw "learning-loop-report failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh learning loop report'
}

if (-not $SkipCopilotUsageIngest) {
    Invoke-Step -Name 'Ingest Copilot session token usage (best effort)' -Action {
        $py = Get-PythonCommand
        $cmd = $py[0]
        $pyParts = @()
        if ($py.Length -gt 1) {
            $pyParts = $py[1..($py.Length - 1)]
        }

        & $cmd @pyParts .\scripts\learning\ingest-copilot-session-usage.py
        if ($LASTEXITCODE -ne 0) {
            throw "ingest-copilot-session-usage failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Ingest Copilot session token usage (best effort)'
}

if (-not $SkipChatTokenUsageReport) {
    Invoke-Step -Name 'Refresh chat token usage report' -Action {
        $py = Get-PythonCommand
        $cmd = $py[0]
        $pyParts = @()
        if ($py.Length -gt 1) {
            $pyParts = $py[1..($py.Length - 1)]
        }

        $plan = $env:COPILOT_PLAN
        if ([string]::IsNullOrWhiteSpace($plan)) {
            $plan = 'business'
        }

        $seats = $env:COPILOT_SEATS
        if ([string]::IsNullOrWhiteSpace($seats)) {
            $seats = '1'
        }

        Write-Host "[info] chat-token-usage-report plan=$plan seats=$seats"
        & $cmd @pyParts .\scripts\learning\chat-token-usage-report.py --plan $plan --seats $seats
        if ($LASTEXITCODE -ne 0) {
            throw "chat-token-usage-report failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh chat token usage report'
}

if (-not $SkipIterationValueRefresh) {
    Invoke-Step -Name 'Refresh iteration value report' -Action {
        $py = Get-PythonCommand
        $cmd = $py[0]
        $pyParts = @()
        if ($py.Length -gt 1) {
            $pyParts = $py[1..($py.Length - 1)]
        }

        & $cmd @pyParts .\scripts\learning\iteration-value-report.py
        if ($LASTEXITCODE -ne 0) {
            throw "iteration-value-report failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh iteration value report'
}

if (-not $SkipCodegraphStatus) {
    Invoke-Step -Name 'Check codegraph status' -Action {
        if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
            throw 'codegraph command not found'
        }

        & codegraph status
        if ($LASTEXITCODE -ne 0) {
            throw "codegraph status failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Check codegraph status'
}

if (-not $SkipGitSnapshot) {
    Invoke-Step -Name 'Collect git snapshot' -Action {
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            throw 'git command not found'
        }

        $branch = (git rev-parse --abbrev-ref HEAD).Trim()
        $statusLines = @(git status --porcelain)
        $changed = $statusLines.Count
        $staged = @($statusLines | Where-Object { $_.Length -ge 1 -and $_.Substring(0, 1) -ne ' ' }).Count
        $unstaged = @($statusLines | Where-Object { $_.Length -ge 2 -and $_.Substring(1, 1) -ne ' ' }).Count

        $sample = @($statusLines | Select-Object -First 5) -join '; '
        Write-Host "[info] Branch: $branch"
        Write-Host "[info] Staged: $staged, Unstaged: $unstaged"
        if ($sample) {
            Write-Host "[info] Sample changes: $sample"
        }

        if ($changed -gt 0) {
            Write-Host "[info] Uncommitted changes detected: $changed"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Collect git snapshot'
}

$endedAt = Get-Date
$report = [ordered]@{
    session = 'bye'
    started_at = $startedAt.ToString('o')
    ended_at = $endedAt.ToString('o')
    duration_sec = [math]::Round((($endedAt - $startedAt).TotalSeconds), 2)
    repo = $repoRoot
    success = (-not $script:HasFailures)
    steps = $script:Steps
}

$reportDir = Join-Path $repoRoot 'observability/logs/session'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $reportDir "bye-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "Report: $reportPath"

if ($script:HasFailures) {
    Write-Host 'BYE shutdown checks finished with errors.' -ForegroundColor Red
    exit 1
}

Write-Host 'BYE shutdown checks completed successfully.' -ForegroundColor Green
exit 0
