param(
  [switch]$PortableMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot
$toolingManifestPath = Join-Path $repoRoot 'tooling/tooling.manifest.json'
$setupValidationReportPath = Join-Path $repoRoot 'repo-intake/generated/reports/setup-validation.json'

function Get-ToolingManifest {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path $Path)) {
    throw "Missing tooling manifest: $Path"
  }

  return Get-Content -Raw -Path $Path | ConvertFrom-Json -Depth 20
}

function Test-RequiredInMode {
  param(
    [Parameter(Mandatory = $true)][object]$Tool,
    [Parameter(Mandatory = $true)][string]$Mode
  )

  if (-not ($Tool.PSObject.Properties.Name -contains 'required_in')) {
    return $true
  }

  foreach ($entry in @($Tool.required_in)) {
    if ([string]$entry -eq $Mode) {
      return $true
    }
  }

  return $false
}

function Write-SetupValidationReport {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][hashtable]$Report
  )

  $reportDir = Split-Path -Parent $Path
  if (-not (Test-Path $reportDir)) {
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
  }

  $Report | ConvertTo-Json -Depth 20 | Set-Content -Path $Path -Encoding utf8
}

if ($PortableMode) {
  Write-Host "Validating portable core..."
}
else {
  Write-Host "Validating full v7 always-on..."
}

$requiredCore = @(
  "requirements.txt",
  ".vscode/mcp.json",
  "AGENTS.md",
  "FINAL_USAGE_GUIDE.md",
  "ARCHITECTURE.md",
  ".github/copilot-instructions.md",
  ".github/instructions/always-on-optimization.instructions.md",
  "scripts/setup/setup-prerequisites.ps1",
  "scripts/setup/validate-context.ps1"
)

$requiredEnterprise = @(
  ".vscode/mcp.json",
  ".github/skills/token-saver/SKILL.md",
  ".github/skills/ahorro-tokens/SKILL.md",
  ".github/skills/caveman-mode/SKILL.md",
  ".github/skills/caveman/SKILL.md",
  ".github/skills/caveman-help/SKILL.md",
  ".github/skills/caveman-review/SKILL.md",
  ".github/skills/caveman-commit/SKILL.md",
  ".github/skills/caveman-stats/SKILL.md",
  ".github/skills/caveman-compress/SKILL.md",
  ".github/skills/cavecrew/SKILL.md",
  ".github/prompts/caveman.prompt.md",
  ".github/prompts/caveman-help.prompt.md",
  ".github/prompts/caveman-review.prompt.md",
  ".github/prompts/caveman-commit.prompt.md",
  ".github/prompts/caveman-stats.prompt.md",
  ".github/prompts/caveman-compress.prompt.md",
  ".github/prompts/cavecrew.prompt.md",
  "optimization/ALWAYS_ON_OPTIMIZATION.md",
  "docs/00-Ahorro_Tokens.md",
  "optimization/token-saver.md",
  "optimization/caveman-mode.md",
  "optimization/optimization-routing.md",
  "docs/02-always-on-optimization-guide.md",
  "repo-registry/repos.schema.json",
  "scripts/intake/validate-repo-registry.ps1",
  "scripts/intake/validate-repo-registry.py",
  "scripts/intake/run-repo-intake.cmd",
  "observability/logs.schema.json",
  "scripts/intake/resolve-routing.py",
  "scripts/intake/run-routing-evals.py",
  "observability/evals/routing-eval-cases.json",
  "scripts/discovery/discover-boost-repos.py",
  "scripts/discovery/discover-boost-repos.cmd",
  "specs/architecture.spec.md",
  "specs/azure-rag.spec.md",
  "specs/coding-standards.spec.md",
  "specs/database.spec.md",
  "specs/migration.spec.md",
  "specs/observability.spec.md",
  "specs/optimization.spec.md",
  "specs/repo-intake.spec.md",
  "specs/rag.spec.md",
  "specs/routing.spec.md",
  "specs/security.spec.md"
)

$required = @($requiredCore)
if (-not $PortableMode) {
  $required += $requiredEnterprise
}

$errors=@()
$validationMode = if ($PortableMode) { 'portable' } else { 'enterprise' }
$setupValidationReport = @{
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
  mode = $validationMode
  manifest_path = 'tooling/tooling.manifest.json'
  requirements_file = 'requirements.txt'
  python_requirements_ok = $false
  python_modules = @()
  external_clis = @()
  errors = @()
  warnings = @()
  overall_status = 'failed'
}
foreach($i in $required){ if(!(Test-Path $i)){ $errors += "Missing $i" } }

try {
  $toolingManifest = Get-ToolingManifest -Path $toolingManifestPath
}
catch {
  $errors += $_.Exception.Message
  $toolingManifest = $null
}

if (Test-Path 'requirements.txt') {
  $requirementsRaw = Get-Content -Raw -Path 'requirements.txt'
  if ($requirementsRaw -match 'graphifyy\[mcp\]') {
    $setupValidationReport.python_requirements_ok = $true
  }
  else {
    $errors += 'requirements.txt must include graphifyy[mcp] for the Graphify MCP runtime.'
  }
}

if ($toolingManifest -and ($toolingManifest.PSObject.Properties.Name -contains 'external_clis')) {
  foreach ($tool in @($toolingManifest.external_clis)) {
    if (-not (Test-RequiredInMode -Tool $tool -Mode $validationMode)) {
      continue
    }

    $commandName = [string]$tool.command
    $installed = [bool](Get-Command $commandName -ErrorAction SilentlyContinue)
    $toolPackage = ''
    $installKind = ''
    if (($tool.PSObject.Properties.Name -contains 'install') -and $tool.install) {
      if ($tool.install.PSObject.Properties.Name -contains 'package') {
        $toolPackage = [string]$tool.install.package
      }
      if ($tool.install.PSObject.Properties.Name -contains 'kind') {
        $installKind = [string]$tool.install.kind
      }
    }

    $setupValidationReport.external_clis += @{
      name = [string]$tool.name
      command = $commandName
      install_kind = $installKind
      package = $toolPackage
      installed = $installed
    }

    if (-not $installed) {
      $errors += "Missing command $commandName"
    }
  }
}

try {
  $mcpRaw = Get-Content -Raw -Path '.vscode/mcp.json' | ConvertFrom-Json -Depth 20
  if ($mcpRaw.servers.gitnexus.command -ne 'gitnexus') {
    $errors += 'MCP gitnexus command should be local `gitnexus` (avoid npx startup latency).'
  }
  $scanLimit = 0
  $gitnexusHasEnv = ($mcpRaw.servers.gitnexus.PSObject.Properties.Name -contains 'env')
  if ($gitnexusHasEnv -and $mcpRaw.servers.gitnexus.env) {
    $gitnexusEnv = $mcpRaw.servers.gitnexus.env
    $hasScanProp = ($gitnexusEnv.PSObject.Properties.Name -contains 'GITNEXUS_SEMANTIC_EXACT_SCAN_LIMIT')
    if ($hasScanProp) {
      [void][int]::TryParse([string]$gitnexusEnv.GITNEXUS_SEMANTIC_EXACT_SCAN_LIMIT, [ref]$scanLimit)
    }
  }
  if ($scanLimit -lt 20000) {
    $errors += 'MCP gitnexus env.GITNEXUS_SEMANTIC_EXACT_SCAN_LIMIT should be >= 20000 for better semantic fallback on Windows.'
  }
  if ($mcpRaw.servers.repomix.command -ne 'repomix') {
    $errors += 'MCP repomix command should be local `repomix` (avoid npx startup latency).'
  }
}
catch {
  $errors += "Unable to parse .vscode/mcp.json: $($_.Exception.Message)"
}

$specFiles = @(
  "specs/architecture.spec.md",
  "specs/azure-rag.spec.md",
  "specs/coding-standards.spec.md",
  "specs/database.spec.md",
  "specs/migration.spec.md",
  "specs/observability.spec.md",
  "specs/optimization.spec.md",
  "specs/repo-intake.spec.md",
  "specs/rag.spec.md",
  "specs/routing.spec.md",
  "specs/security.spec.md"
)

$specContracts = @{
  "specs/architecture.spec.md"      = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/azure-rag.spec.md"         = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/coding-standards.spec.md"  = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/database.spec.md"          = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/migration.spec.md"         = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/observability.spec.md"     = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/optimization.spec.md"      = @("## Routing Robustness Contract (Production)", "## Token Efficiency Contract (Ahorro de Tokens)", "## Enforcement")
  "specs/repo-intake.spec.md"       = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/rag.spec.md"               = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/routing.spec.md"           = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/security.spec.md"          = @("## Objetivo", "## Reglas", "## Validacion minima")
}

if (-not $PortableMode) {
  foreach ($spec in $specFiles) {
    if (-not (Test-Path $spec)) {
      continue
    }

    $raw = Get-Content -Raw -Path $spec
    $lineCount = (Get-Content -Path $spec | Measure-Object -Line).Lines

    if ($lineCount -lt 8) {
      $errors += "Spec too short (possible placeholder): $spec"
      continue
    }

    if ($raw -match "Reglas base del dominio") {
      $errors += "Spec still contains placeholder text: $spec"
    }

    foreach ($requiredHeading in $specContracts[$spec]) {
      if ($raw -notmatch [regex]::Escape($requiredHeading)) {
        $errors += "Spec missing required section '$requiredHeading': $spec"
      }
    }

    if ($spec -eq "specs/optimization.spec.md" -and $raw -notmatch [regex]::Escape("scripts\\intake\\run-routing-evals.py")) {
      $errors += "Spec enforcement command drift detected: $spec"
    }

    if ($raw -match [regex]::Escape("scripts\\learning\\run-routing-evals.py")) {
      $errors += "Deprecated routing-evals path referenced in spec: $spec"
    }
  }
}

if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
  $errors += "Missing command codegraph"
}
elseif (-not (Test-Path ".codegraph")) {
  $errors += "Missing .codegraph index. Run: codegraph init -i"
}

if (-not (Get-Command repomix -ErrorAction SilentlyContinue)) {
  $errors += "Missing command repomix. Run: npm install -g repomix@latest"
}

if (Get-Command codebase-memory-mcp -ErrorAction SilentlyContinue) {
  try {
    $cbmCfg = codebase-memory-mcp config list | Out-String
    if ($cbmCfg -notmatch 'auto_index\s*=\s*true') {
      $errors += 'codebase-memory-mcp auto_index must be true. Run: codebase-memory-mcp config set auto_index true'
    }
  }
  catch {
    $errors += "Unable to read codebase-memory-mcp config: $($_.Exception.Message)"
  }
}

if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
  $errors += "Missing Python launcher (py/python) required for graphify MCP"
}
else {
  $pythonCmd = "python"
  $pythonArgs = @("-c", "import graphify.serve, mcp; print('ok')")
  if (Get-Command py -ErrorAction SilentlyContinue) {
    $pythonCmd = "py"
    $pythonArgs = @("-3.14", "-c", "import graphify.serve, mcp; print('ok')")
  }

  & $pythonCmd @pythonArgs *> $null
  $setupValidationReport.python_modules += @{
    launcher = $pythonCmd
    args = $pythonArgs
    import_ok = ($LASTEXITCODE -eq 0)
  }
  if ($LASTEXITCODE -ne 0) {
    $errors += 'Graphify MCP runtime missing. Run: py -3.14 -m pip install -r requirements.txt'
  }
}

if (-not (Test-Path "context/graphify-out/graph.json")) {
  $errors += "Missing context/graphify-out/graph.json. Run: py -3.14 -m graphify extract scripts --no-cluster --out context"
}

$setupValidationReport.errors = @($errors)
$setupValidationReport.warnings = @()
$setupValidationReport.overall_status = if ($errors.Count -eq 0) { 'ok' } else { 'failed' }
Write-SetupValidationReport -Path $setupValidationReportPath -Report $setupValidationReport

if($errors.Count -eq 0){
  if ($PortableMode) {
    Write-Host "Portable validation OK. Python requirements and local MCP runtime look consistent."
    Write-Host "Report: $setupValidationReportPath"
  }
  else {
    Write-Host "Validation OK. Always-on optimization documented."
    Write-Host "Running strict repo registry validation..."
    pwsh -NoProfile -File .\scripts\intake\validate-repo-registry.ps1 -Strict
  }
}
else {
  $errors | ForEach-Object { Write-Host $_ }
  Write-Host "Report: $setupValidationReportPath"
  exit 1
}
