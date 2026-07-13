param(
    [switch]$SetupIfNeeded,
    [switch]$SkipIntake,
    [switch]$SkipRoutingEvals,
    [switch]$SkipProjectNotesRefresh,
    [switch]$SkipCopilotUsageIngest,
    [switch]$SkipChatTokenUsageReport,
    [switch]$SkipCodegraphStatus,
    [switch]$SkipMcpStartupChecks,
    [switch]$SkipSiblingReposChecks,
    [switch]$SkipGraphRefresh,
    [switch]$SkipAgentPipelinePreflight
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

function Get-TokenSaverConfigPath {
    param(
        [string]$RepoRoot
    )

    return Join-Path $RepoRoot '.token-saver.json'
}

function Get-TokenSaverMode {
    param(
        [string]$RepoRoot
    )

    $configPath = Get-TokenSaverConfigPath -RepoRoot $RepoRoot
    if (-not (Test-Path $configPath)) {
        return 'off'
    }

    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json -Depth 10
        $mode = [string]$config.mode
        if ([string]::IsNullOrWhiteSpace($mode)) {
            return 'off'
        }

        return $mode
    }
    catch {
        return 'off'
    }
}

function Ensure-TokenSaverActivated {
    param(
        [string]$RepoRoot,
        [string]$DefaultMode = 'monitor'
    )

    $configPath = Get-TokenSaverConfigPath -RepoRoot $RepoRoot
    $config = [ordered]@{}

    if (Test-Path $configPath) {
        try {
            $existing = Get-Content $configPath -Raw | ConvertFrom-Json -Depth 20
            foreach ($property in $existing.PSObject.Properties) {
                $config[$property.Name] = $property.Value
            }
        }
        catch {
            # Si el JSON está corrupto, se regenera con configuración mínima segura.
            $config = [ordered]@{}
        }
    }

    $currentMode = ''
    if ($config.Contains('mode')) {
        $currentMode = [string]$config.mode
    }

    if ([string]::IsNullOrWhiteSpace($currentMode) -or $currentMode -eq 'off') {
        $config.mode = $DefaultMode
    }

    if (-not $config.Contains('suppressLogs')) {
        $config.suppressLogs = $true
    }

    if (-not $config.Contains('suppressRepetitiveHistory')) {
        $config.suppressRepetitiveHistory = $true
    }

    $config | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8
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

function Get-HiSummary {
    param(
        [string]$RepoRoot,
        [datetime]$StartedAt,
        [datetime]$EndedAt
    )

    $okCount = @($script:Steps | Where-Object { $_.success }).Count
    $failedCount = @($script:Steps | Where-Object { -not $_.success -and $_.required }).Count
    $optionalFailedCount = @($script:Steps | Where-Object { -not $_.success -and -not $_.required }).Count
    $skipped = @()

    if ($SkipSiblingReposChecks) { $skipped += 'Validate sibling repos operability' }
    if ($SkipAgentPipelinePreflight) { $skipped += 'Validate agent pipeline preflight' }
    if ($SkipMcpStartupChecks) { $skipped += 'Validate MCP servers start/listen capability' }
    if ($SkipGraphRefresh) { $skipped += 'Refresh codegraph index sync' }
    if ($SkipIntake) { $skipped += 'Run repo intake' }
    if ($SkipRoutingEvals) { $skipped += 'Run routing evals' }
    if ($SkipProjectNotesRefresh) { $skipped += 'Refresh project notes from observability' }
    if ($SkipCopilotUsageIngest) { $skipped += 'Ingest Copilot session token usage (best effort)' }
    if ($SkipChatTokenUsageReport) { $skipped += 'Refresh chat token usage report' }
    if ($SkipCodegraphStatus) { $skipped += 'Check codegraph status' }

    $engineSummary = [ordered]@{
        memory = [ordered]@{
            command_available = Test-CommandAvailable -Name 'codebase-memory-mcp'
            startup_check = Get-StepStatus -Name 'Validate MCP servers start/listen capability'
        }
        token_saver = [ordered]@{
            command_available = Test-CommandAvailable -Name 'token-saver-mcp'
            mode = Get-TokenSaverMode -RepoRoot $RepoRoot
            startup_check = Get-StepStatus -Name 'Validate MCP servers start/listen capability'
        }
        codegraph = [ordered]@{
            command_available = Test-CommandAvailable -Name 'codegraph'
            index_present = Test-Path (Join-Path $RepoRoot '.codegraph')
            sync = Get-StepStatus -Name 'Refresh codegraph index sync'
            status = Get-StepStatus -Name 'Check codegraph status'
        }
        gitnexus = [ordered]@{
            command_available = Test-CommandAvailable -Name 'npx'
            index_present = Test-Path (Join-Path $RepoRoot '.gitnexus')
            startup_check = Get-StepStatus -Name 'Validate MCP servers start/listen capability'
        }
        repomix = [ordered]@{
            command_available = Test-CommandAvailable -Name 'npx'
            startup_check = Get-StepStatus -Name 'Validate MCP servers start/listen capability'
        }
        graphify = [ordered]@{
            graph_present = Test-Path (Join-Path $RepoRoot 'context/graphify-out/graph.json')
            manifest_present = Test-Path (Join-Path $RepoRoot 'context/graphify-out/manifest.json')
            startup_check = Get-StepStatus -Name 'Validate MCP servers start/listen capability'
        }
    }

    $artifactSummary = [ordered]@{
        repo_registry_report = Test-Path (Join-Path $RepoRoot 'repo-intake/generated/reports/repo-registry-validation.json')
        repo_intake = Get-StepStatus -Name 'Run repo intake'
        routing_evals = Get-StepStatus -Name 'Run routing evals'
        project_notes = Get-StepStatus -Name 'Refresh project notes from observability'
        copilot_usage_ingest = Get-StepStatus -Name 'Ingest Copilot session token usage (best effort)'
        chat_token_usage_report = Get-StepStatus -Name 'Refresh chat token usage report'
        sibling_repos = Get-StepStatus -Name 'Validate sibling repos operability'
        structure_cache = [ordered]@{
            refreshed = [bool]$script:StructureCacheReport.refreshed
            refresh_reason = [string]$script:StructureCacheReport.refresh_reason
            changed_repos = @($script:StructureCacheReport.changed_repos).Count
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

function Write-HiSummary {
    param(
        [object]$Summary,
        [string]$ReportPath
    )

    Write-Host ''
    Write-Host '=== HI SUMMARY ===' -ForegroundColor Cyan
    Write-Host ("Result: {0} | Duration: {1}s" -f $Summary.result.ToUpperInvariant(), $Summary.duration_sec)
    Write-Host ("Steps: total={0}, ok={1}, failed_required={2}, failed_optional={3}, skipped={4}" -f $Summary.steps.total, $Summary.steps.ok, $Summary.steps.failed_required, $Summary.steps.failed_optional, $Summary.steps.skipped)
    Write-Host 'Engines:'
    Write-Host ("- memory: command={0}, startup={1}" -f $Summary.engines.memory.command_available, $Summary.engines.memory.startup_check)
    Write-Host ("- token-saver: command={0}, mode={1}, startup={2}" -f $Summary.engines.token_saver.command_available, $Summary.engines.token_saver.mode, $Summary.engines.token_saver.startup_check)
    Write-Host ("- codegraph: command={0}, index={1}, sync={2}, status={3}" -f $Summary.engines.codegraph.command_available, $Summary.engines.codegraph.index_present, $Summary.engines.codegraph.sync, $Summary.engines.codegraph.status)
    Write-Host ("- gitnexus: command={0}, index={1}, startup={2}" -f $Summary.engines.gitnexus.command_available, $Summary.engines.gitnexus.index_present, $Summary.engines.gitnexus.startup_check)
    Write-Host ("- repomix: command={0}, startup={1}" -f $Summary.engines.repomix.command_available, $Summary.engines.repomix.startup_check)
    Write-Host ("- graphify: graph={0}, manifest={1}, startup={2}" -f $Summary.engines.graphify.graph_present, $Summary.engines.graphify.manifest_present, $Summary.engines.graphify.startup_check)
    Write-Host 'Artifacts:'
    Write-Host ("- repo-registry-report: {0}" -f $Summary.artifacts.repo_registry_report)
    Write-Host ("- repo-intake: {0}" -f $Summary.artifacts.repo_intake)
    Write-Host ("- routing-evals: {0}" -f $Summary.artifacts.routing_evals)
    Write-Host ("- project-notes: {0}" -f $Summary.artifacts.project_notes)
    Write-Host ("- copilot-usage-ingest: {0}" -f $Summary.artifacts.copilot_usage_ingest)
    Write-Host ("- chat-token-usage-report: {0}" -f $Summary.artifacts.chat_token_usage_report)
    Write-Host ("- sibling-repos: {0}" -f $Summary.artifacts.sibling_repos)
    Write-Host ("- structure-cache: refreshed={0}, reason={1}, changed_repos={2}" -f $Summary.artifacts.structure_cache.refreshed, $Summary.artifacts.structure_cache.refresh_reason, $Summary.artifacts.structure_cache.changed_repos)
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

function Resolve-RepoPath {
    param(
        [string]$Root,
        [string]$RelativePath
    )

    if ([System.IO.Path]::IsPathRooted($RelativePath)) {
        return (Resolve-Path $RelativePath).Path
    }
    return [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
}

function Get-RepoField {
    param(
        [object]$Repo,
        [string]$Name,
        [string]$Default = ''
    )

    if ($null -eq $Repo) {
        return $Default
    }

    $prop = $Repo.PSObject.Properties[$Name]
    if ($null -eq $prop -or $null -eq $prop.Value) {
        return $Default
    }

    return [string]$prop.Value
}

function Resolve-RegistryRepoPath {
    param(
        [string]$Root,
        [object]$Repo
    )

    $repoType = (Get-RepoField -Repo $Repo -Name 'type' -Default 'local').ToLowerInvariant()
    if ($repoType -eq 'github') {
        $cacheLocation = Get-RepoField -Repo $Repo -Name 'cache_location'
        if (-not [string]::IsNullOrWhiteSpace($cacheLocation)) {
            return Resolve-RepoPath -Root $Root -RelativePath $cacheLocation
        }

        $repoName = Get-RepoField -Repo $Repo -Name 'name' -Default 'unknown'
        $slug = $repoName.ToLowerInvariant() -replace '[^a-z0-9_-]+', '-'
        return [System.IO.Path]::GetFullPath((Join-Path $Root (".cache/github-repos/{0}" -f $slug)))
    }

    $location = Get-RepoField -Repo $Repo -Name 'location'
    if ([string]::IsNullOrWhiteSpace($location)) {
        throw "Registry repo is missing location: $(Get-RepoField -Repo $Repo -Name 'name' -Default '<unknown>')"
    }

    return Resolve-RepoPath -Root $Root -RelativePath $location
}

function Get-PathLastWriteUtc {
    param(
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return [datetime]::MinValue
    }

    $item = Get-Item $Path -ErrorAction Stop
    if (-not $item.PSIsContainer) {
        return $item.LastWriteTimeUtc
    }

    $max = $item.LastWriteTimeUtc
    $children = Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        if ($child.LastWriteTimeUtc -gt $max) {
            $max = $child.LastWriteTimeUtc
        }
    }

    return $max
}

function Get-StructureSnapshot {
    param(
        [string]$RepoRoot,
        [object]$Repo
    )

    $repoName = Get-RepoField -Repo $Repo -Name 'name'
    $slug = $repoName.ToLower() -replace '[^a-z0-9_-]+', '-'
    $repoPath = Resolve-RegistryRepoPath -Root $RepoRoot -Repo $Repo
    $structurePath = Join-Path $RepoRoot ("repo-intake/generated/{0}/context-manifests/structure-min.json" -f $slug)

    $repoLatest = [datetime]::MinValue
    if (Test-Path $repoPath) {
        $pathsToCheck = @(
            $repoPath,
            (Join-Path $repoPath 'AGENTS.md'),
            (Join-Path $repoPath 'README.md'),
            (Join-Path $repoPath 'ARCHITECTURE.md'),
            (Join-Path $repoPath '.github/skills'),
            (Join-Path $repoPath '.github/prompts'),
            (Join-Path $repoPath 'scripts'),
            (Join-Path $repoPath 'specs')
        )

        foreach ($path in $pathsToCheck) {
            $lastWrite = Get-PathLastWriteUtc -Path $path
            if ($lastWrite -gt $repoLatest) {
                $repoLatest = $lastWrite
            }
        }
    }

    $exists = Test-Path $structurePath
    $structureMtime = [datetime]::MinValue
    $cacheFingerprint = ''
    $structureRepoExists = $false

    if ($exists) {
        $structureMtime = (Get-Item $structurePath).LastWriteTimeUtc
        $structureData = Get-Content $structurePath -Raw | ConvertFrom-Json -Depth 20
        $cacheFingerprint = [string]$structureData.cache_fingerprint
        $structureRepoExists = [bool]$structureData.exists
    }

    $status = 'fresh'
    if (-not $exists) {
        $status = 'missing'
    }
    elseif ((Test-Path $repoPath) -and $repoLatest -gt $structureMtime) {
        $status = 'stale'
    }

    return [ordered]@{
        repo = $repoName
        slug = $slug
        version = '0'
        repo_path = $repoPath
        structure_path = $structurePath
        structure_exists = $exists
        structure_reports_repo_exists = $structureRepoExists
        cache_fingerprint = $cacheFingerprint
        repo_latest_change_utc = if ($repoLatest -eq [datetime]::MinValue) { '' } else { $repoLatest.ToString('o') }
        structure_mtime_utc = if ($structureMtime -eq [datetime]::MinValue) { '' } else { $structureMtime.ToString('o') }
        status = $status
    }
}

function Test-LongRunningCommand {
    param(
        [string]$Name,
        [string]$Command,
        [int]$WarmupSec = 4,
        [int]$TimeoutSec = 25
    )

    $outFile = Join-Path $env:TEMP ("hi-mcp-{0}-{1}.out" -f $Name, ([guid]::NewGuid().ToString('N')))
    $errFile = Join-Path $env:TEMP ("hi-mcp-{0}-{1}.err" -f $Name, ([guid]::NewGuid().ToString('N')))

    $proc = Start-Process -FilePath 'pwsh' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $Command) -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    $start = Get-Date
    $deadline = $start.AddSeconds($TimeoutSec)
    $isReady = $false

    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) {
            if ($proc.ExitCode -eq 0) {
                $isReady = $true
                break
            }

            $errText = ''
            if (Test-Path $errFile) {
                $errText = (Get-Content $errFile -Raw)
            }
            throw "$Name failed to start. ExitCode=$($proc.ExitCode). $errText"
        }

        if (((Get-Date) - $start).TotalSeconds -ge $WarmupSec) {
            $isReady = $true
            break
        }

        Start-Sleep -Milliseconds 250
    }

    if (-not $isReady) {
        throw "$Name did not become ready within ${TimeoutSec}s"
    }

    if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force
    }

    Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
}

function Ensure-CodegraphInitialized {
    param(
        [string]$RepoRootPath
    )

    $indexPath = Join-Path $RepoRootPath '.codegraph'
    if (Test-Path $indexPath) {
        return $false
    }

    Write-Host '[info] CodeGraph not initialized. Running codegraph init automatically...' -ForegroundColor DarkYellow
    & codegraph init
    if ($LASTEXITCODE -ne 0) {
        throw "codegraph init failed with exit code $LASTEXITCODE"
    }

    return $true
}

function Ensure-SetupPrerequisites {
    param(
        [string]$Reason = 'missing prerequisite'
    )

    if ($script:SetupAttempted) {
        if (-not $script:SetupSucceeded) {
            throw 'setup-prerequisites was already attempted and failed earlier in this run'
        }
        return $true
    }

    $script:SetupAttempted = $true
    Write-Host ("[info] Missing prerequisite detected ({0}). Running setup-prerequisites automatically..." -f $Reason) -ForegroundColor DarkYellow
    try {
        $script:StepLogs['setup-prerequisites-auto'] = Invoke-LoggedAction -StepName 'setup-prerequisites-auto' -InfoLines @("Auto-recovery reason: $Reason") -Action {
            & pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\setup-prerequisites.ps1 -VerboseTrace
        }
    }
    catch {
        $script:SetupSucceeded = $false
        throw $_.Exception.Message
    }

    $script:SetupSucceeded = $true
    return $true
}

function Ensure-GitNexusIndexed {
    param(
        [string]$RepoRootPath
    )

    $indexArtifact = Join-Path (Join-Path $RepoRootPath '.gitnexus') 'lbug'
    if (Test-Path $indexArtifact) {
        return $false
    }

    if ($script:GitNexusAnalyzeAttempted) {
        return $script:GitNexusAnalyzeSucceeded
    }

    $script:GitNexusAnalyzeAttempted = $true
    Write-Host '[info] GitNexus has no index. Running gitnexus analyze automatically...' -ForegroundColor DarkYellow
    & npx -y gitnexus@latest analyze
    if ($LASTEXITCODE -ne 0) {
        $script:GitNexusAnalyzeSucceeded = $false
        Write-Host "[info] gitnexus analyze failed with exit code $LASTEXITCODE" -ForegroundColor DarkYellow
        return $false
    }

    if (-not (Test-Path $indexArtifact)) {
        $script:GitNexusAnalyzeSucceeded = $false
        Write-Host '[info] gitnexus analyze finished but local index artifact was not detected' -ForegroundColor DarkYellow
        return $false
    }

    $script:GitNexusAnalyzeSucceeded = $true
    return $true
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

$script:Steps = @()
$script:HasFailures = $false
$script:SetupAttempted = $false
$script:SetupSucceeded = $false
$script:GitNexusAnalyzeAttempted = $false
$script:GitNexusAnalyzeSucceeded = $false
$script:StructureCacheReport = [ordered]@{
    refreshed = $false
    refresh_reason = 'none'
    before = @()
    after = @()
    changed_repos = @()
}
$script:StepLogs = [ordered]@{}
$startedAt = Get-Date

Write-Host '=== HI STARTUP ===' -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"
Write-Host "Time: $startedAt"

$validateContextAction = {
    & pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\validate-context.ps1
    if ($LASTEXITCODE -ne 0) {
        throw "validate-context failed with exit code $LASTEXITCODE"
    }
}

Invoke-Step -Name 'Validate context' -Action $validateContextAction -Required $true

if ($script:HasFailures) {
    $script:HasFailures = $false
    Invoke-Step -Name 'Setup prerequisites' -Action {
        [void](Ensure-SetupPrerequisites -Reason 'validate-context failed')
    } -Required $true

    Invoke-Step -Name 'Validate context (retry)' -Action $validateContextAction -Required $true
}

Invoke-Step -Name 'Validate memory/cache artifacts' -Action {
    $requiredPaths = @(
        'repo-intake/generated',
        'context/graphify-out/graph.json',
        'context/graphify-out/manifest.json',
        'repo-intake/generated/reports/repo-registry-validation.json'
    )

    $missingArtifacts = @()
    foreach ($item in $requiredPaths) {
        if (-not (Test-Path $item)) {
            $missingArtifacts += $item
        }
    }

    if ($missingArtifacts.Count -gt 0 -and -not $SkipIntake) {
        Write-Host '[info] Missing generated artifacts detected. Running repo intake automatically...' -ForegroundColor DarkYellow
        $script:StepLogs['recover-missing-artifacts'] = Invoke-LoggedAction -StepName 'recover-missing-artifacts' -Action {
            & .\scripts\intake\run-repo-intake.cmd
        }
    }

    foreach ($item in $requiredPaths) {
        if (-not (Test-Path $item)) {
            throw "Missing required artifact: $item"
        }
    }

    if (-not (Get-Command codebase-memory-mcp -ErrorAction SilentlyContinue)) {
        [void](Ensure-SetupPrerequisites -Reason 'codebase-memory-mcp command not found')
    }

    if (-not (Get-Command codebase-memory-mcp -ErrorAction SilentlyContinue)) {
        throw 'codebase-memory-mcp command not found (memory layer unavailable)'
    }
} -Required $true

Invoke-Step -Name 'Activate token-saver mode' -Action {
    if (-not (Test-CommandAvailable -Name 'token-saver-mcp')) {
        [void](Ensure-SetupPrerequisites -Reason 'token-saver-mcp command not found')
    }

    if (-not (Test-CommandAvailable -Name 'token-saver-mcp')) {
        throw 'token-saver-mcp command not found'
    }

    Ensure-TokenSaverActivated -RepoRoot $repoRoot -DefaultMode 'monitor'
    $mode = Get-TokenSaverMode -RepoRoot $repoRoot
    if ($mode -eq 'off') {
        throw 'Token Saver remains in off mode after activation step'
    }

    Write-Host ("Token Saver mode: {0}" -f $mode)
} -Required $true

Invoke-Step -Name 'Check structure cache freshness' -Action {
    $registryPath = Join-Path $repoRoot 'repo-registry/repos.yml'
    $registry = Get-Content $registryPath -Raw | ConvertFrom-Json -Depth 20
    $before = @()

    foreach ($repo in $registry.repos) {
        $before += (Get-StructureSnapshot -RepoRoot $repoRoot -Repo $repo)
    }

    $missing = @($before | Where-Object { $_.status -eq 'missing' }).Count
    $stale = @($before | Where-Object { $_.status -eq 'stale' }).Count
    $needsRefresh = ($missing -gt 0 -or $stale -gt 0)

    $script:StructureCacheReport.before = $before
    $script:StructureCacheReport.refresh_reason = if ($needsRefresh) {
        "missing=$missing, stale=$stale"
    }
    else {
        'none'
    }

    if ($needsRefresh -and -not $SkipIntake) {
        $script:StepLogs['structure-cache-refresh'] = Invoke-LoggedAction -StepName 'structure-cache-refresh' -Action {
            & .\scripts\intake\run-repo-intake.cmd
        }
        $script:StructureCacheReport.refreshed = $true
    }

    $after = @()
    foreach ($repo in $registry.repos) {
        $after += (Get-StructureSnapshot -RepoRoot $repoRoot -Repo $repo)
    }
    $script:StructureCacheReport.after = $after

    $changedRepos = @()
    foreach ($beforeEntry in $before) {
        $afterEntry = $after | Where-Object { $_.repo -eq $beforeEntry.repo } | Select-Object -First 1
        if ($null -eq $afterEntry) {
            continue
        }

        if ($beforeEntry.cache_fingerprint -ne $afterEntry.cache_fingerprint -or $beforeEntry.status -ne $afterEntry.status) {
            $changedRepos += [ordered]@{
                repo = $beforeEntry.repo
                before_status = $beforeEntry.status
                after_status = $afterEntry.status
                before_fingerprint = $beforeEntry.cache_fingerprint
                after_fingerprint = $afterEntry.cache_fingerprint
            }
        }
    }
    $script:StructureCacheReport.changed_repos = $changedRepos

    Write-Host ("Structure cache status: missing={0}, stale={1}, refreshed={2}" -f $missing, $stale, $script:StructureCacheReport.refreshed)
} -Required $true

if (-not $SkipSiblingReposChecks) {
    Invoke-Step -Name 'Validate sibling repos operability' -Action {
        $registryPath = Join-Path $repoRoot 'repo-registry/repos.yml'
        $registry = Get-Content $registryPath -Raw | ConvertFrom-Json -Depth 20

        foreach ($repo in $registry.repos) {
            $repoName = Get-RepoField -Repo $repo -Name 'name'
            $location = Resolve-RegistryRepoPath -Root $repoRoot -Repo $repo
            if (-not (Test-Path $location)) {
                throw "Sibling repo path not found: $repoName -> $location"
            }

            $slug = $repoName.ToLower() -replace '[^a-z0-9_-]+', '-'
            $manifest = Join-Path $repoRoot ("repo-intake/generated/{0}/context-manifests/manifest.json" -f $slug)
            $structure = Join-Path $repoRoot ("repo-intake/generated/{0}/context-manifests/structure-min.json" -f $slug)
            $capability = Join-Path $repoRoot ("repo-intake/generated/{0}/capabilities/capability.json" -f $slug)

            if (-not (Test-Path $manifest)) {
                throw "Missing sibling manifest: $manifest"
            }
            if (-not (Test-Path $structure)) {
                throw "Missing sibling structure cache: $structure"
            }
            if (-not (Test-Path $capability)) {
                throw "Missing sibling capability: $capability"
            }

            $structureData = Get-Content $structure -Raw | ConvertFrom-Json -Depth 20
            if ([string]$structureData.repo -ne $repoName) {
                throw "Structure cache repo mismatch for ${repoName}: found '$($structureData.repo)'"
            }
            $isOptional = (Get-RepoField -Repo $repo -Name 'optional' -Default 'false') -eq 'true'
            if (-not [bool]$structureData.exists -and -not $isOptional) {
                throw "Structure cache indicates missing path for required repo '$repoName'"
            }
        }
    } -Required $true
}
else {
    Write-Host '[skip] Validate sibling repos operability'
}

if (-not $SkipAgentPipelinePreflight) {
    Invoke-Step -Name 'Validate agent pipeline preflight' -Action {
        $py = Get-PythonCommand
        $cmd = $py[0]
        $pyParts = @()
        if ($py.Length -gt 1) {
            $pyParts = $py[1..($py.Length - 1)]
        }

        $script:StepLogs['agent-pipeline-preflight'] = Invoke-LoggedAction -StepName 'agent-pipeline-preflight' -Action {
            & $cmd @pyParts .\scripts\intake\agent-pipeline-preflight.py
        }
    } -Required $true
}
else {
    Write-Host '[skip] Validate agent pipeline preflight'
}

if (-not $SkipMcpStartupChecks) {
    Invoke-Step -Name 'Validate MCP servers start/listen capability' -Action {
        $requiredCommands = @(
            'token-saver-mcp',
            'codebase-memory-mcp',
            'codegraph',
            'npx'
        )

        $missingCommands = @($requiredCommands | Where-Object { -not (Test-CommandAvailable -Name $_) })
        if ($missingCommands.Count -gt 0) {
            Write-Host ("[info] Missing MCP prerequisites detected ({0}). Running setup-prerequisites automatically..." -f ($missingCommands -join ', ')) -ForegroundColor DarkYellow
            [void](Ensure-SetupPrerequisites)
        }

        $py = Get-PythonCommand
        $pyCmd = $py[0]
        $pyParts = @()
        if ($py.Length -gt 1) {
            $pyParts = $py[1..($py.Length - 1)]
        }

        $graphifyCmd = "$pyCmd"
        if ($pyParts.Count -gt 0) {
            $graphifyCmd += " " + ($pyParts -join ' ')
        }
        $graphifyCmd += ' -m graphify.serve --transport stdio context/graphify-out/graph.json'

        [void](Ensure-GitNexusIndexed -RepoRootPath $repoRoot)

        $checks = @(
            @{ name = 'token-saver-mcp'; command = 'token-saver-mcp' },
            @{ name = 'codebase-memory-mcp'; command = 'codebase-memory-mcp' },
            @{ name = 'codegraph'; command = 'codegraph serve --mcp' },
            @{ name = 'gitnexus'; command = 'npx -y gitnexus@latest mcp' },
            @{ name = 'repomix'; command = 'npx -y repomix@latest --mcp' },
            @{ name = 'graphify'; command = $graphifyCmd }
        )

        foreach ($check in $checks) {
            Test-LongRunningCommand -Name $check.name -Command $check.command
        }
    } -Required $true
}
else {
    Write-Host '[skip] Validate MCP servers start/listen capability'
}

if (-not $SkipGraphRefresh) {
    Invoke-Step -Name 'Refresh codegraph index sync' -Action {
        if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
            [void](Ensure-SetupPrerequisites)
        }

        if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
            throw 'codegraph command not found'
        }

        [void](Ensure-CodegraphInitialized -RepoRootPath $repoRoot)

        $script:StepLogs['codegraph-sync'] = Invoke-LoggedAction -StepName 'codegraph-sync' -Action {
            & codegraph sync
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh codegraph index sync'
}

if (-not $SkipIntake) {
    Invoke-Step -Name 'Run repo intake' -Action {
        $script:StepLogs['repo-intake'] = Invoke-LoggedAction -StepName 'repo-intake' -Action {
            & .\scripts\intake\run-repo-intake.cmd
        }
    } -Required $true
}
else {
    Write-Host '[skip] Run repo intake'
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

if (-not $SkipCodegraphStatus) {
    Invoke-Step -Name 'Check codegraph status' -Action {
        if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
            [void](Ensure-SetupPrerequisites)
        }

        if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
            throw 'codegraph command not found'
        }

        [void](Ensure-CodegraphInitialized -RepoRootPath $repoRoot)

        $script:StepLogs['codegraph-status'] = Invoke-LoggedAction -StepName 'codegraph-status' -Action {
            & codegraph status
        }
    } -Required $false
}
else {
    Write-Host '[skip] Check codegraph status'
}

$endedAt = Get-Date
$summary = Get-HiSummary -RepoRoot $repoRoot -StartedAt $startedAt -EndedAt $endedAt
$report = [ordered]@{
    session = 'hi'
    started_at = $startedAt.ToString('o')
    ended_at = $endedAt.ToString('o')
    duration_sec = [math]::Round((($endedAt - $startedAt).TotalSeconds), 2)
    repo = $repoRoot
    success = (-not $script:HasFailures)
    summary = $summary
    step_logs = $script:StepLogs
    structure_cache = $script:StructureCacheReport
    steps = $script:Steps
}

$reportDir = Join-Path $repoRoot 'observability/logs/session'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $reportDir "hi-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8

Write-HiSummary -Summary $summary -ReportPath $reportPath

if ($script:HasFailures) {
    Write-Host 'HI startup finished with errors.' -ForegroundColor Red
    exit 1
}

Write-Host 'HI startup completed successfully.' -ForegroundColor Green
exit 0
