param(
  [switch]$ForceTemplateRegistry,
  [switch]$SkipCodebaseMemory,
  [switch]$SkipTokenSaver,
  [switch]$SkipCodegraph,
  [switch]$SkipGitnexus,
  [switch]$SkipGraphify,
  [switch]$SkipRepomix,
  [string]$Owner,
  [string]$RepoNamePrefix,
  [string]$InitialRepoName,
  [string]$InitialRepoDomain,
  [string]$InitialRepoLocation,
  [switch]$SkipInitialRepo
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

$registryPath = Join-Path $repoRoot 'repo-registry\repos.yml'
$summaryReportPath = Join-Path $repoRoot 'repo-intake\generated\reports\SUMMARY.json'
$initRegistryArgs = @('.\scripts\intake\init-template-registry.ps1')
if (-not [string]::IsNullOrWhiteSpace($Owner)) { $initRegistryArgs += @('-Owner', $Owner) }
if (-not [string]::IsNullOrWhiteSpace($RepoNamePrefix)) { $initRegistryArgs += @('-RepoNamePrefix', $RepoNamePrefix) }
if (-not [string]::IsNullOrWhiteSpace($InitialRepoName)) { $initRegistryArgs += @('-InitialRepoName', $InitialRepoName) }
if (-not [string]::IsNullOrWhiteSpace($InitialRepoDomain)) { $initRegistryArgs += @('-InitialRepoDomain', $InitialRepoDomain) }
if (-not [string]::IsNullOrWhiteSpace($InitialRepoLocation)) { $initRegistryArgs += @('-InitialRepoLocation', $InitialRepoLocation) }
if ($SkipInitialRepo) { $initRegistryArgs += '-SkipInitialRepo' }

Write-Host '== Portable bootstrap ==' 

pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\setup-prerequisites.ps1 `
  -PortableMode `
  -SkipCodebaseMemory:$SkipCodebaseMemory `
  -SkipTokenSaver:$SkipTokenSaver `
  -SkipCodegraph:$SkipCodegraph `
  -SkipGitnexus:$SkipGitnexus `
  -SkipGraphify:$SkipGraphify `
  -SkipRepomix:$SkipRepomix
if ($LASTEXITCODE -ne 0) {
  throw 'Portable setup prerequisites failed.'
}

pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\validate-context.ps1 -PortableMode
if ($LASTEXITCODE -ne 0) {
  throw 'Portable context validation failed.'
}

if (-not (Test-Path $registryPath)) {
  Write-Host 'No repo registry found. Initializing portable template registry...'
  pwsh -NoProfile -ExecutionPolicy Bypass -File @initRegistryArgs
  if ($LASTEXITCODE -ne 0) {
    throw 'Template registry initialization failed.'
  }
}
elseif ($ForceTemplateRegistry) {
  Write-Host 'Forcing template registry initialization...'
  pwsh -NoProfile -ExecutionPolicy Bypass -File @($initRegistryArgs + '-Force')
  if ($LASTEXITCODE -ne 0) {
    throw 'Forced template registry initialization failed.'
  }
}
else {
  Write-Host 'Registry already exists. Reusing current repo-registry\repos.yml.'
}

pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\intake\run-repo-intake.ps1
if ($LASTEXITCODE -ne 0) {
  throw 'Repo intake failed during portable bootstrap.'
}

Write-Host ''
Write-Host 'Portable bootstrap completed.'
if (Test-Path $registryPath) {
  $registry = Get-Content -Raw -Path $registryPath | ConvertFrom-Json -Depth 20
  $registryMode = if (($registry.PSObject.Properties.Name -contains 'registry_mode') -and -not [string]::IsNullOrWhiteSpace([string]$registry.registry_mode)) { [string]$registry.registry_mode } else { 'enterprise' }
  $repoCount = if (($registry.PSObject.Properties.Name -contains 'repos') -and $null -ne $registry.repos) { @($registry.repos).Count } else { 0 }
  Write-Host "Registry summary: mode=$registryMode, repos=$repoCount"
}
if (Test-Path $summaryReportPath) {
  $summary = Get-Content -Raw -Path $summaryReportPath | ConvertFrom-Json -Depth 20
  Write-Host "Intake summary: generated for $($summary.repos_count) repos"
}
Write-Host 'Artifacts:'
Write-Host '  - repo-intake/generated/reports/setup-validation.json'
Write-Host '  - repo-intake/generated/reports/repo-registry-validation.json'
Write-Host '  - repo-intake/generated/reports/SUMMARY.json'