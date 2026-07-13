param(
  [switch]$Force,
  [string]$Owner,
  [string]$RepoNamePrefix,
  [string]$InitialRepoName,
  [string]$InitialRepoDomain,
  [string]$InitialRepoLocation,
  [switch]$SkipInitialRepo,
  [string]$TargetPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

$templatePath = Join-Path $repoRoot 'repo-registry\repos.template.json'
$targetPath = if ([string]::IsNullOrWhiteSpace($TargetPath)) {
  Join-Path $repoRoot 'repo-registry\repos.yml'
}
else {
  if ([System.IO.Path]::IsPathRooted($TargetPath)) {
    $TargetPath
  }
  else {
    Join-Path $repoRoot $TargetPath
  }
}

function Read-RequiredValue {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [string]$DefaultValue = "",
    [string]$ProvidedValue = ""
  )

  if (-not [string]::IsNullOrWhiteSpace($ProvidedValue)) {
    return $ProvidedValue.Trim()
  }

  while ($true) {
    $value = if ([string]::IsNullOrWhiteSpace($DefaultValue)) {
      Read-Host $Prompt
    }
    else {
      $inputValue = Read-Host "$Prompt [$DefaultValue]"
      if ([string]::IsNullOrWhiteSpace($inputValue)) { $DefaultValue } else { $inputValue.Trim() }
    }

    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }

    Write-Host 'A value is required.'
  }
}

function Read-ChoiceValue {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [Parameter(Mandatory = $true)][string[]]$AllowedValues,
    [Parameter(Mandatory = $true)][string]$DefaultValue,
    [string]$ProvidedValue = ""
  )

  $allowedLabels = $AllowedValues -join '/'
  if (-not [string]::IsNullOrWhiteSpace($ProvidedValue)) {
    $normalizedProvided = $ProvidedValue.Trim().ToLowerInvariant()
    foreach ($candidate in $AllowedValues) {
      if ($candidate.ToLowerInvariant() -eq $normalizedProvided) {
        return $candidate
      }
    }

    throw "Invalid value '$ProvidedValue' for $Prompt. Allowed values: $allowedLabels"
  }

  while ($true) {
    $value = Read-Host "$Prompt [$DefaultValue] ($allowedLabels)"
    if ([string]::IsNullOrWhiteSpace($value)) {
      return $DefaultValue
    }

    $normalized = $value.Trim().ToLowerInvariant()
    foreach ($candidate in $AllowedValues) {
      if ($candidate.ToLowerInvariant() -eq $normalized) {
        return $candidate
      }
    }

    Write-Host "Allowed values: $allowedLabels"
  }
}

function Read-YesNoValue {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [bool]$DefaultValue = $true,
    [Nullable[bool]]$ProvidedValue = $null
  )

  if ($null -ne $ProvidedValue) {
    return [bool]$ProvidedValue
  }

  $defaultLabel = if ($DefaultValue) { 'Y' } else { 'N' }
  while ($true) {
    $value = Read-Host "$Prompt [$defaultLabel]"
    if ([string]::IsNullOrWhiteSpace($value)) {
      return $DefaultValue
    }

    switch ($value.Trim().ToLowerInvariant()) {
      'y' { return $true }
      'yes' { return $true }
      'n' { return $false }
      'no' { return $false }
      default { Write-Host 'Answer Y or N.' }
    }
  }
}

function Get-DefaultEnginesForDomain {
  param([Parameter(Mandatory = $true)][string]$Domain)

  if ($Domain -eq 'dev') {
    $Domain = 'backend'
  }

  switch ($Domain) {
    'backend' {
      return [pscustomobject]@{
        knowledge = 'codegraph'
        execution = 'none'
        snapshot = 'repomix'
      }
    }
    'frontend' {
      return [pscustomobject]@{
        knowledge = 'codegraph'
        execution = 'none'
        snapshot = 'repomix'
      }
    }
    'community-content' {
      return [pscustomobject]@{
        knowledge = 'graphify'
        execution = 'none'
        snapshot = 'repomix'
      }
    }
    'legacy' {
      return [pscustomobject]@{
        knowledge = 'gitnexus'
        execution = 'gitnexus'
        snapshot = 'repomix'
      }
    }
    'dba' {
      return [pscustomobject]@{
        knowledge = 'graphify'
        execution = 'none'
        snapshot = 'repomix'
      }
    }
    'iot' {
      return [pscustomobject]@{
        knowledge = 'graphify'
        execution = 'gitnexus'
        snapshot = 'repomix'
      }
    }
    'azure-rag' {
      return [pscustomobject]@{
        knowledge = 'azure-rag-builder'
        execution = 'none'
        snapshot = 'repomix'
      }
    }
    'rag' {
      return [pscustomobject]@{
        knowledge = 'graphify'
        execution = 'none'
        snapshot = 'repomix'
      }
    }
    'ux-ui' {
      return [pscustomobject]@{
        knowledge = 'graphify'
        execution = 'none'
        snapshot = 'repomix'
      }
    }
    default {
      return [pscustomobject]@{
        knowledge = 'codegraph'
        execution = 'none'
        snapshot = 'repomix'
      }
    }
  }
}

if (-not (Test-Path $templatePath)) {
  throw "Missing template registry: $templatePath"
}

if ((Test-Path $targetPath) -and -not $Force) {
  $currentRaw = Get-Content -Raw -Path $targetPath
  $currentRegistry = $null
  try {
    $currentRegistry = $currentRaw | ConvertFrom-Json -Depth 20
  }
  catch {
    $currentRegistry = $null
  }

  if ($currentRegistry -and ($currentRegistry.PSObject.Properties.Name -contains 'registry_mode') -and $currentRegistry.registry_mode -eq 'template') {
    Write-Host "Template registry already initialized at $targetPath"
    exit 0
  }

  throw "Registry already exists at $targetPath. Use -Force to overwrite it with the template."
}

$templateRegistry = Get-Content -Raw -Path $templatePath | ConvertFrom-Json -Depth 20

$defaultOwner = if ([string]::IsNullOrWhiteSpace($Owner)) { 'your-team' } else { $Owner }
$defaultPrefix = if ([string]::IsNullOrWhiteSpace($RepoNamePrefix)) { 'your-prefix_' } else { $RepoNamePrefix }

$resolvedOwner = Read-RequiredValue -Prompt 'Registry owner' -DefaultValue $defaultOwner -ProvidedValue $Owner
$resolvedPrefix = Read-RequiredValue -Prompt 'Repository name prefix' -DefaultValue $defaultPrefix -ProvidedValue $RepoNamePrefix

$templateRegistry.governance.owner = $resolvedOwner
$templateRegistry.governance.repo_name_prefix = $resolvedPrefix

$hasInitialRepoData = @($InitialRepoName, $InitialRepoDomain, $InitialRepoLocation) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$addInitialRepo = $false
if ($SkipInitialRepo) {
  $addInitialRepo = $false
}
elseif ($hasInitialRepoData.Count -gt 0) {
  $addInitialRepo = $true
}
else {
  $addInitialRepo = Read-YesNoValue -Prompt 'Add an initial repo entry now?' -DefaultValue $true
}

$templateRegistry.repos = @()
if ($addInitialRepo) {
  $defaultRepoName = if ([string]::IsNullOrWhiteSpace($InitialRepoName)) { "$resolvedPrefix$((Split-Path $repoRoot -Leaf).ToLowerInvariant())" } else { $InitialRepoName }
  $defaultRepoDomain = if ([string]::IsNullOrWhiteSpace($InitialRepoDomain)) { 'backend' } else { $InitialRepoDomain }
  $defaultRepoLocation = if ([string]::IsNullOrWhiteSpace($InitialRepoLocation)) { '.' } else { $InitialRepoLocation }

  if ($defaultRepoDomain -eq 'dev') {
    $defaultRepoDomain = 'backend'
  }

  $resolvedRepoName = Read-RequiredValue -Prompt 'Initial repo name' -DefaultValue $defaultRepoName -ProvidedValue $InitialRepoName
  $resolvedRepoDomain = Read-ChoiceValue -Prompt 'Initial repo domain' -AllowedValues @('dev', 'backend', 'frontend', 'community-content', 'legacy', 'dba', 'iot', 'ux-ui', 'azure-rag', 'rag') -DefaultValue $defaultRepoDomain -ProvidedValue $InitialRepoDomain
  if ($resolvedRepoDomain -eq 'dev') {
    Write-Host "[info] Domain 'dev' is a legacy alias. Normalizing to 'backend'."
    $resolvedRepoDomain = 'backend'
  }
  $resolvedRepoLocation = Read-RequiredValue -Prompt 'Initial repo location' -DefaultValue $defaultRepoLocation -ProvidedValue $InitialRepoLocation
  $resolvedEngines = Get-DefaultEnginesForDomain -Domain $resolvedRepoDomain

  $templateRegistry.repos = @(
    [pscustomobject]@{
      name = $resolvedRepoName
      domain = $resolvedRepoDomain
      location = $resolvedRepoLocation
      type = 'local'
      optional = $false
      dependencies = @()
      engines = $resolvedEngines
    }
  )
}

$targetDir = Split-Path -Parent $targetPath
if (-not (Test-Path $targetDir)) {
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$templateRegistry | ConvertTo-Json -Depth 20 | Set-Content -Path $targetPath -Encoding utf8
Write-Host "Template registry initialized at $targetPath"
Write-Host "Summary:"
Write-Host "  owner: $resolvedOwner"
Write-Host "  prefix: $resolvedPrefix"
Write-Host "  repos: $($templateRegistry.repos.Count)"
if ($templateRegistry.repos.Count -gt 0) {
  $firstRepo = $templateRegistry.repos[0]
  Write-Host "  first repo: $($firstRepo.name) [$($firstRepo.domain)] -> $($firstRepo.location)"
  Write-Host "  engines: knowledge=$($firstRepo.engines.knowledge), execution=$($firstRepo.engines.execution), snapshot=$($firstRepo.engines.snapshot)"
}
Write-Host "Next recommended step: .\\scripts\\intake\\run-repo-intake.cmd"