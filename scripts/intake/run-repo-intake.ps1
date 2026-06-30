Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

$registryPath = Join-Path $repoRoot 'repo-registry\repos.yml'
if (-not (Test-Path $registryPath)) {
	Write-Error "Missing repo registry: $registryPath. Run .\\scripts\\intake\\init-template-registry.cmd first."
	exit 1
}

$registryRaw = Get-Content -Raw -Path $registryPath
$registry = $registryRaw | ConvertFrom-Json -Depth 20
$registryMode = 'enterprise'
if (($registry.PSObject.Properties.Name -contains 'registry_mode') -and [string]::IsNullOrWhiteSpace([string]$registry.registry_mode) -eq $false) {
	$registryMode = [string]$registry.registry_mode
}

$repos = @()
if (($registry.PSObject.Properties.Name -contains 'repos') -and $null -ne $registry.repos) {
	$repos = @($registry.repos)
}

if ($registryMode -eq 'template') {
	Write-Host "Validating repo registry (template mode)..."
	pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\intake\validate-repo-registry.ps1
}
else {
	Write-Host "Validating repo registry (strict mode)..."
	pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\intake\validate-repo-registry.ps1 -Strict
}
if ($LASTEXITCODE -ne 0) {
	Write-Error "Repo registry validation failed. Aborting intake generation."
	exit $LASTEXITCODE
}

Write-Host "Running repo intake generation..."
python .\scripts\intake\repo-intake.py

if ($registryMode -eq 'template' -and $repos.Count -eq 0) {
	Write-Host "Template registry is empty. Intake reports were generated with 0 repositories."
	Write-Host "Edit repo-registry\\repos.yml and rerun .\\scripts\\intake\\run-repo-intake.cmd when you add repos."
}

Write-Host "Repo intake completed."
