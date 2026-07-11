param(
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
    throw 'Not inside a git repository.'
}

Set-Location $repoRoot
$hooksDir = Join-Path $repoRoot '.githooks'
$postCommitHook = Join-Path $hooksDir 'post-commit'

if (-not (Test-Path $postCommitHook)) {
    throw "Missing hook template: $postCommitHook"
}

$currentHooksPath = (& git config --local --get core.hooksPath 2>$null)
if (-not $Force -and $currentHooksPath -and $currentHooksPath -ne '.githooks') {
    Write-Warning "core.hooksPath is already set to '$currentHooksPath'. Skipping update. Use -Force to override."
    exit 0
}

& git config --local core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to configure core.hooksPath.'
}

Write-Host '[mcpee] Git hooks configured: core.hooksPath=.githooks'
Write-Host '[mcpee] Hook active: post-commit -> scripts/ops/post-commit-refresh.ps1'
