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
    [switch]$SkipChatTokenUsageReport,
    [switch]$SkipRetentionCleanup,
    [ValidateRange(1, 3650)]
    [int]$RetentionDays = 15
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

function Get-StepStatus {
    param(
        [string]$Name
    )

    $step = $script:Steps | Where-Object { $_.name -eq $Name } | Select-Object -Last 1
    if ($null -eq $step) {
        return 'skipped'
    }

    if ([bool]$step.success) {
        return 'ok'
    }

    return 'failed'
}

function Test-CommandAvailable {
    param(
        [string]$Name
    )

    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-SetupPrerequisites {
    if ($script:SetupAttempted) {
        if (-not $script:SetupSucceeded) {
            throw 'setup-prerequisites was already attempted and failed earlier in this run'
        }
        return $true
    }

    $script:SetupAttempted = $true
    Write-Host '[info] Missing prerequisite detected. Running setup-prerequisites automatically...' -ForegroundColor DarkYellow
    & pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\setup-prerequisites.ps1 -PortableMode
    if ($LASTEXITCODE -ne 0) {
        $script:SetupSucceeded = $false
        throw "setup-prerequisites failed with exit code $LASTEXITCODE"
    }

    $script:SetupSucceeded = $true
    return $true
}

function Invoke-ObservabilityRetentionCleanup {
    param(
        [string]$RepoRoot,
        [int]$DaysToKeep
    )

    $sessionDir = Join-Path $RepoRoot 'observability/logs/session'
    if (-not (Test-Path $sessionDir)) {
        return [ordered]@{
            applied = $true
            days = $DaysToKeep
            session_dir = $sessionDir
            deleted_files = 0
            deleted_bytes = 0
            cutoff_utc = (Get-Date).ToUniversalTime().AddDays(-$DaysToKeep).ToString('o')
            note = 'session directory does not exist'
        }
    }

    $cutoffUtc = (Get-Date).ToUniversalTime().AddDays(-$DaysToKeep)
    $candidates = @(Get-ChildItem -Path $sessionDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -lt $cutoffUtc })

    $deletedFiles = 0
    $deletedBytes = 0L
    foreach ($file in $candidates) {
        try {
            $deletedBytes += [int64]$file.Length
            Remove-Item -Path $file.FullName -Force -ErrorAction Stop
            $deletedFiles += 1
        }
        catch {
            Write-Host ("[info] Retention skip delete: {0} -> {1}" -f $file.FullName, $_.Exception.Message) -ForegroundColor DarkYellow
        }
    }

    return [ordered]@{
        applied = $true
        days = $DaysToKeep
        session_dir = $sessionDir
        deleted_files = $deletedFiles
        deleted_bytes = $deletedBytes
        cutoff_utc = $cutoffUtc.ToString('o')
        note = ''
    }
}

function New-StepLogPath {
    param(
        [string]$StepName
    )

    $logDir = Join-Path $repoRoot 'observability/logs/session'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $safeName = ($StepName.ToLowerInvariant() -replace '[^a-z0-9]+', '-') -replace '(^-|-$)', ''
    return Join-Path $logDir ("{0}-{1}.log" -f $safeName, $stamp)
}

function Invoke-LoggedAction {
    param(
        [string]$StepName,
        [scriptblock]$Action,
        [string[]]$InfoLines = @()
    )

    $logPath = New-StepLogPath -StepName $StepName
    & $Action *> $logPath
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "$StepName failed with exit code $exitCode. Log: $logPath"
    }

    foreach ($infoLine in $InfoLines) {
        Write-Host ("[info] {0}" -f $infoLine)
    }
    Write-Host ("[info] Log: {0}" -f $logPath)

    return $logPath
}

function Get-ByeSummary {
    param(
        [string]$RepoRoot,
        [datetime]$StartedAt,
        [datetime]$EndedAt
    )

    $okCount = @($script:Steps | Where-Object { $_.success }).Count
    $failedCount = @($script:Steps | Where-Object { -not $_.success -and $_.required }).Count
    $optionalFailedCount = @($script:Steps | Where-Object { -not $_.success -and -not $_.required }).Count
    $skipped = @()

    if ($SkipRegistryValidation) { $skipped += 'Validate repo registry (strict)' }
    if ($SkipRoutingEvals) { $skipped += 'Run routing evals' }
    if ($SkipGraphRefresh) { $skipped += 'Refresh codegraph index sync' }
    if ($SkipIntakeRefresh) { $skipped += 'Refresh repo intake artifacts' }
    if ($SkipSiblingDiscoveryRefresh) { $skipped += 'Refresh sibling repos discovery proposal' }
    if ($SkipRepomixRefresh) { $skipped += 'Refresh repomix context export' }
    if ($SkipProjectNotesRefresh) { $skipped += 'Refresh project notes from observability' }
    if ($SkipLearningRefresh) { $skipped += 'Refresh learning loop report' }
    if ($SkipIterationValueRefresh) { $skipped += 'Refresh iteration value report' }
    if ($SkipRetentionCleanup) { $skipped += 'Apply observability retention cleanup' }
    if ($SkipCodegraphStatus) { $skipped += 'Check codegraph status' }
    if ($SkipGitSnapshot) { $skipped += 'Collect git snapshot' }

    $engineSummary = [ordered]@{
        codegraph = [ordered]@{
            command_available = Test-CommandAvailable -Name 'codegraph'
            index_present = Test-Path (Join-Path $RepoRoot '.codegraph')
            sync = Get-StepStatus -Name 'Refresh codegraph index sync'
            status = Get-StepStatus -Name 'Check codegraph status'
        }
        git = [ordered]@{
            command_available = Test-CommandAvailable -Name 'git'
            snapshot = Get-StepStatus -Name 'Collect git snapshot'
        }
        repomix = [ordered]@{
            refresh = Get-StepStatus -Name 'Refresh repomix context export'
        }
    }

    $artifactSummary = [ordered]@{
        repo_registry = Get-StepStatus -Name 'Validate repo registry (strict)'
        repo_intake = Get-StepStatus -Name 'Refresh repo intake artifacts'
        routing_evals = Get-StepStatus -Name 'Run routing evals'
        sibling_discovery = Get-StepStatus -Name 'Refresh sibling repos discovery proposal'
        project_notes = Get-StepStatus -Name 'Refresh project notes from observability'
        learning_loop = Get-StepStatus -Name 'Refresh learning loop report'
        iteration_value = Get-StepStatus -Name 'Refresh iteration value report'
        repomix_output = Test-Path (Join-Path $RepoRoot 'context/repomix/repomix-output.xml')
        retention_cleanup = [ordered]@{
            status = Get-StepStatus -Name 'Apply observability retention cleanup'
            days = $RetentionDays
            deleted_files = [int]$script:RetentionCleanupReport.deleted_files
            deleted_bytes = [int64]$script:RetentionCleanupReport.deleted_bytes
        }
    }

    return [ordered]@{
        result = if ($script:HasFailures) { 'failed' } else { 'ok' }
        started_at = $StartedAt.ToString('o')
        ended_at = $EndedAt.ToString('o')
        duration_sec = [math]::Round((($EndedAt - $StartedAt).TotalSeconds), 2)
        steps = [ordered]@{
            total = @($script:Steps).Count
            ok = $okCount
            failed_required = $failedCount
            failed_optional = $optionalFailedCount
            skipped = $skipped.Count
        }
        engines = $engineSummary
        artifacts = $artifactSummary
        skipped_steps = $skipped
    }
}

function Write-ByeSummary {
    param(
        [object]$Summary,
        [string]$ReportPath
    )

    Write-Host ''
    Write-Host '=== BYE SUMMARY ===' -ForegroundColor Cyan
    Write-Host ("Result: {0} | Duration: {1}s" -f $Summary.result.ToUpperInvariant(), $Summary.duration_sec)
    Write-Host ("Steps: total={0}, ok={1}, failed_required={2}, failed_optional={3}, skipped={4}" -f $Summary.steps.total, $Summary.steps.ok, $Summary.steps.failed_required, $Summary.steps.failed_optional, $Summary.steps.skipped)
    Write-Host 'Engines:'
    Write-Host ("- codegraph: command={0}, index={1}, sync={2}, status={3}" -f $Summary.engines.codegraph.command_available, $Summary.engines.codegraph.index_present, $Summary.engines.codegraph.sync, $Summary.engines.codegraph.status)
    Write-Host ("- git: command={0}, snapshot={1}" -f $Summary.engines.git.command_available, $Summary.engines.git.snapshot)
    Write-Host ("- repomix: refresh={0}" -f $Summary.engines.repomix.refresh)
    Write-Host 'Artifacts:'
    Write-Host ("- repo-registry: {0}" -f $Summary.artifacts.repo_registry)
    Write-Host ("- repo-intake: {0}" -f $Summary.artifacts.repo_intake)
    Write-Host ("- routing-evals: {0}" -f $Summary.artifacts.routing_evals)
    Write-Host ("- sibling-discovery: {0}" -f $Summary.artifacts.sibling_discovery)
    Write-Host ("- project-notes: {0}" -f $Summary.artifacts.project_notes)
    Write-Host ("- learning-loop: {0}" -f $Summary.artifacts.learning_loop)
    Write-Host ("- iteration-value: {0}" -f $Summary.artifacts.iteration_value)
    Write-Host ("- repomix-output: {0}" -f $Summary.artifacts.repomix_output)
    Write-Host ("- retention-cleanup: status={0}, days={1}, deleted_files={2}, deleted_bytes={3}" -f $Summary.artifacts.retention_cleanup.status, $Summary.artifacts.retention_cleanup.days, $Summary.artifacts.retention_cleanup.deleted_files, $Summary.artifacts.retention_cleanup.deleted_bytes)
    if (@($Summary.skipped_steps).Count -gt 0) {
        Write-Host ("Skipped: {0}" -f (($Summary.skipped_steps) -join ', '))
    }
    Write-Host ("Report: {0}" -f $ReportPath)
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

function Resolve-CopilotSessionLogPath {
    $fromEnv = [string]$env:VSCODE_TARGET_SESSION_LOG
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
        if (Test-Path $fromEnv) {
            return (Resolve-Path $fromEnv).Path
        }
    }

    $workspaceStorage = Join-Path $env:APPDATA 'Code\User\workspaceStorage'
    if (-not (Test-Path $workspaceStorage)) {
        return ''
    }

    $candidates = Get-ChildItem -Path $workspaceStorage -Recurse -File -Filter 'main.jsonl' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'GitHub\.copilot-chat[\\/]debug-logs[\\/][0-9a-fA-F-]{36}[\\/]main\.jsonl$' } |
        Sort-Object LastWriteTime -Descending

    if ($null -eq $candidates -or $candidates.Count -eq 0) {
        return ''
    }

    return $candidates[0].FullName
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

$script:Steps = @()
$script:HasFailures = $false
$script:SetupAttempted = $false
$script:SetupSucceeded = $false
$script:StepLogs = [ordered]@{}
$script:RetentionCleanupReport = [ordered]@{
    applied = $false
    days = $RetentionDays
    session_dir = (Join-Path $repoRoot 'observability/logs/session')
    deleted_files = 0
    deleted_bytes = 0
    cutoff_utc = ''
    note = ''
}
$startedAt = Get-Date

Write-Host '=== BYE SHUTDOWN ===' -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"
Write-Host "Time: $startedAt"

if (-not $SkipRegistryValidation) {
    Invoke-Step -Name 'Validate repo registry (strict)' -Action {
        $script:StepLogs['repo-registry-validation'] = Invoke-LoggedAction -StepName 'repo-registry-validation' -Action {
            & pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\intake\validate-repo-registry.ps1 -Strict
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

        $script:StepLogs['routing-evals'] = Invoke-LoggedAction -StepName 'routing-evals' -Action {
            & $cmd @pyParts .\scripts\intake\run-routing-evals.py
        }
    } -Required $true
}
else {
    Write-Host '[skip] Run routing evals'
}

if (-not $SkipGraphRefresh) {
    Invoke-Step -Name 'Refresh codegraph index sync' -Action {
        if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
            [void](Ensure-SetupPrerequisites)
        }

        if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
            throw 'codegraph command not found'
        }

        $script:StepLogs['codegraph-sync'] = Invoke-LoggedAction -StepName 'codegraph-sync' -Action {
            & codegraph sync
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh codegraph index sync'
}

if (-not $SkipIntakeRefresh) {
    Invoke-Step -Name 'Refresh repo intake artifacts' -Action {
        $script:StepLogs['repo-intake-refresh'] = Invoke-LoggedAction -StepName 'repo-intake-refresh' -Action {
            & .\scripts\intake\run-repo-intake.cmd
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

        $script:StepLogs['sibling-discovery-refresh'] = Invoke-LoggedAction -StepName 'sibling-discovery-refresh' -Action {
            & $cmd @pyParts .\scripts\discovery\discover-boost-repos.py --root C:/repo
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh sibling repos discovery proposal'
}

if (-not $SkipRepomixRefresh) {
    Invoke-Step -Name 'Refresh repomix context export' -Action {
        $repomixLogPath = Invoke-LoggedAction -StepName 'repomix-refresh' -Action {
            & pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\context\build-repomix.ps1
        }

        $repomixOutputPath = Join-Path $repoRoot 'context/repomix/repomix-output.xml'
        Write-Host ("[info] Repomix output: {0}" -f $repomixOutputPath)
        Write-Host ("[info] Repomix log: {0}" -f $repomixLogPath)
        $script:StepLogs['repomix-refresh'] = $repomixLogPath
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

        $script:StepLogs['project-notes-refresh'] = Invoke-LoggedAction -StepName 'project-notes-refresh' -Action {
            & $cmd @pyParts .\scripts\discovery\refresh-project-notes.py
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

        $script:StepLogs['learning-loop-refresh'] = Invoke-LoggedAction -StepName 'learning-loop-refresh' -Action {
            & $cmd @pyParts .\scripts\learning\learning-loop-report.py
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

        $sessionLogPath = Resolve-CopilotSessionLogPath
        if ([string]::IsNullOrWhiteSpace($sessionLogPath)) {
            Write-Host '[info] No Copilot session log found. Skipping ingest step without error.'
            return
        }

        Write-Host ("[info] Using Copilot session log: {0}" -f $sessionLogPath)

        & $cmd @pyParts .\scripts\learning\ingest-copilot-session-usage.py --session-log $sessionLogPath
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

        $script:StepLogs['iteration-value-refresh'] = Invoke-LoggedAction -StepName 'iteration-value-refresh' -Action {
            & $cmd @pyParts .\scripts\learning\iteration-value-report.py
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh iteration value report'
}

if (-not $SkipRetentionCleanup) {
    Invoke-Step -Name 'Apply observability retention cleanup' -Action {
        $script:RetentionCleanupReport = Invoke-ObservabilityRetentionCleanup -RepoRoot $repoRoot -DaysToKeep $RetentionDays
        Write-Host ("[info] Retention policy: keep_last_days={0}, deleted_files={1}, deleted_bytes={2}" -f $script:RetentionCleanupReport.days, $script:RetentionCleanupReport.deleted_files, $script:RetentionCleanupReport.deleted_bytes)
    } -Required $false
}
else {
    Write-Host '[skip] Apply observability retention cleanup'
}

if (-not $SkipCodegraphStatus) {
    Invoke-Step -Name 'Check codegraph status' -Action {
        if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
            [void](Ensure-SetupPrerequisites)
        }

        if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
            throw 'codegraph command not found'
        }

        $script:StepLogs['codegraph-status'] = Invoke-LoggedAction -StepName 'codegraph-status' -Action {
            & codegraph status
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
$summary = Get-ByeSummary -RepoRoot $repoRoot -StartedAt $startedAt -EndedAt $endedAt
$report = [ordered]@{
    session = 'bye'
    started_at = $startedAt.ToString('o')
    ended_at = $endedAt.ToString('o')
    duration_sec = [math]::Round((($endedAt - $startedAt).TotalSeconds), 2)
    repo = 'workspace-root'
    success = (-not $script:HasFailures)
    summary = $summary
    step_logs = $script:StepLogs
    steps = $script:Steps
}

$reportDir = Join-Path $repoRoot 'observability/logs/session'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $reportDir "bye-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8

Write-ByeSummary -Summary $summary -ReportPath $reportPath

if ($script:HasFailures) {
    Write-Host 'BYE shutdown checks finished with errors.' -ForegroundColor Red
    exit 1
}

Write-Host 'BYE shutdown checks completed successfully.' -ForegroundColor Green
exit 0
