param(
    [switch]$Force,
    [switch]$SkipLangSmith,
    [switch]$SkipLearningReports,
    [switch]$SkipAutoDocs
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

function Invoke-PythonScript {
    param(
        [string]$ScriptPath,
        [string[]]$Args = @(),
        [switch]$IgnoreErrors
    )

    $python = Get-PythonCommand
    & $python[0] $python[1] $ScriptPath @Args
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $IgnoreErrors) {
        throw "Command failed ($exitCode): $ScriptPath"
    }
    return $exitCode
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
    Write-Host '[mcpee] post-commit-refresh skipped: git repo not detected.'
    exit 0
}

Set-Location $repoRoot

$changedFiles = (& git diff-tree --no-commit-id --name-only -r HEAD 2>$null)
if ($LASTEXITCODE -ne 0) {
    Write-Host '[mcpee] post-commit-refresh skipped: unable to inspect last commit.'
    exit 0
}

$projectChanges = @($changedFiles | Where-Object { $_ -match '^projects/' })
if (-not $Force -and $projectChanges.Count -eq 0) {
    Write-Host '[mcpee] post-commit-refresh skipped: no changes under projects/ in last commit.'
    exit 0
}

$started = Get-Date
$status = 'ok'
$errors = @()
$steps = @()

try {
    if (-not $SkipAutoDocs) {
        Write-Host '[mcpee] AutoDocs: compiling incremental projection...'
        Invoke-PythonScript -ScriptPath '.\scripts\wiki\compiler_main.py'
        $steps += 'autodocs'
    }

    if (-not $SkipLearningReports) {
        Write-Host '[mcpee] Observability: refreshing learning reports...'
        Invoke-PythonScript -ScriptPath '.\scripts\learning\learning-loop-report.py'
        Invoke-PythonScript -ScriptPath '.\scripts\learning\iteration-value-report.py'
        $steps += 'learning-reports'
    }

    if (-not $SkipLangSmith) {
        Write-Host '[mcpee] LangSmith: publishing KPI snapshots...'
        Invoke-PythonScript -ScriptPath '.\scripts\ops\publish-langsmith-kpis.py' -IgnoreErrors
        $steps += 'langsmith-kpis'
    }
}
catch {
    $status = 'failed'
    $errors += $_.Exception.Message
    Write-Warning ("[mcpee] post-commit-refresh failed: {0}" -f $_.Exception.Message)
}

$finished = Get-Date
$duration = [math]::Round((($finished - $started).TotalSeconds), 2)

$summary = [ordered]@{
    timestamp = $finished.ToString('o')
    operation = 'post-commit-refresh'
    status = $status
    duration_sec = $duration
    changed_projects_files = $projectChanges.Count
    steps = $steps
    errors = $errors
}

$sessionDir = Join-Path $repoRoot 'observability/logs/session'
New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $sessionDir ("post-commit-refresh-$stamp.json")
$summary | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8

Write-Host ("[mcpee] post-commit-refresh {0}. report: {1}" -f $status, $reportPath)

# Never block commit history after it was created.
exit 0
