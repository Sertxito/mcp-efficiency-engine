param(
    [switch]$SetupIfNeeded,
    [switch]$SkipIntake,
    [switch]$SkipRoutingEvals,
    [switch]$SkipProjectNotesRefresh,
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

    $repoName = [string]$Repo.name
    $slug = $repoName.ToLower() -replace '[^a-z0-9_-]+', '-'
    $repoPath = Resolve-RepoPath -Root $RepoRoot -RelativePath ([string]$Repo.location)
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
    if ($script:SetupAttempted) {
        if (-not $script:SetupSucceeded) {
            throw 'setup-prerequisites was already attempted and failed earlier in this run'
        }
        return $true
    }

    $script:SetupAttempted = $true
    Write-Host '[info] Missing prerequisite detected. Running setup-prerequisites automatically...' -ForegroundColor DarkYellow
    & pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\setup-prerequisites.ps1
    if ($LASTEXITCODE -ne 0) {
        $script:SetupSucceeded = $false
        throw "setup-prerequisites failed with exit code $LASTEXITCODE"
    }

    $script:SetupSucceeded = $true
    return $true
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

$script:Steps = @()
$script:HasFailures = $false
$script:SetupAttempted = $false
$script:SetupSucceeded = $false
$script:StructureCacheReport = [ordered]@{
    refreshed = $false
    refresh_reason = 'none'
    before = @()
    after = @()
    changed_repos = @()
}
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
        [void](Ensure-SetupPrerequisites)
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
        & .\scripts\intake\run-repo-intake.cmd
        if ($LASTEXITCODE -ne 0) {
            throw "run-repo-intake failed while recovering missing artifacts with exit code $LASTEXITCODE"
        }
    }

    foreach ($item in $requiredPaths) {
        if (-not (Test-Path $item)) {
            throw "Missing required artifact: $item"
        }
    }

    if (-not (Get-Command codebase-memory-mcp -ErrorAction SilentlyContinue)) {
        [void](Ensure-SetupPrerequisites)
    }

    if (-not (Get-Command codebase-memory-mcp -ErrorAction SilentlyContinue)) {
        throw 'codebase-memory-mcp command not found (memory layer unavailable)'
    }
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
        & .\scripts\intake\run-repo-intake.cmd
        if ($LASTEXITCODE -ne 0) {
            throw "run-repo-intake failed during structure cache refresh with exit code $LASTEXITCODE"
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
            $location = Resolve-RepoPath -Root $repoRoot -RelativePath ([string]$repo.location)
            if (-not (Test-Path $location)) {
                throw "Sibling repo path not found: $($repo.name) -> $location"
            }

            $slug = ([string]$repo.name).ToLower() -replace '[^a-z0-9_-]+', '-'
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
            if ([string]$structureData.repo -ne [string]$repo.name) {
                throw "Structure cache repo mismatch for $($repo.name): found '$($structureData.repo)'"
            }
            if (-not [bool]$structureData.exists -and -not [bool]$repo.optional) {
                throw "Structure cache indicates missing path for required repo '$($repo.name)'"
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

        & $cmd @pyParts .\scripts\intake\agent-pipeline-preflight.py
        if ($LASTEXITCODE -ne 0) {
            throw "agent-pipeline-preflight failed with exit code $LASTEXITCODE"
        }
    } -Required $true
}
else {
    Write-Host '[skip] Validate agent pipeline preflight'
}

if (-not $SkipMcpStartupChecks) {
    Invoke-Step -Name 'Validate MCP servers start/listen capability' -Action {
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

        & codegraph sync
        if ($LASTEXITCODE -ne 0) {
            throw "codegraph sync failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh codegraph index sync'
}

if (-not $SkipIntake) {
    Invoke-Step -Name 'Run repo intake' -Action {
        & .\scripts\intake\run-repo-intake.cmd
        if ($LASTEXITCODE -ne 0) {
            throw "run-repo-intake failed with exit code $LASTEXITCODE"
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

        & $cmd @pyParts .\scripts\intake\run-routing-evals.py
        if ($LASTEXITCODE -ne 0) {
            throw "run-routing-evals failed with exit code $LASTEXITCODE"
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

        & $cmd @pyParts .\scripts\discovery\refresh-project-notes.py
        if ($LASTEXITCODE -ne 0) {
            throw "refresh-project-notes failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Refresh project notes from observability'
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

        & codegraph status
        if ($LASTEXITCODE -ne 0) {
            throw "codegraph status failed with exit code $LASTEXITCODE"
        }
    } -Required $false
}
else {
    Write-Host '[skip] Check codegraph status'
}

$endedAt = Get-Date
$report = [ordered]@{
    session = 'hi'
    started_at = $startedAt.ToString('o')
    ended_at = $endedAt.ToString('o')
    duration_sec = [math]::Round((($endedAt - $startedAt).TotalSeconds), 2)
    repo = $repoRoot
    success = (-not $script:HasFailures)
    structure_cache = $script:StructureCacheReport
    steps = $script:Steps
}

$reportDir = Join-Path $repoRoot 'observability/logs/session'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $reportDir "hi-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "Report: $reportPath"

if ($script:HasFailures) {
    Write-Host 'HI startup finished with errors.' -ForegroundColor Red
    exit 1
}

Write-Host 'HI startup completed successfully.' -ForegroundColor Green
exit 0
