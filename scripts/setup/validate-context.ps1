Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

Write-Host "Validating full v7 always-on..."
$required = @(
  ".vscode/mcp.json",
  "AGENTS.md",
  "FINAL_USAGE_GUIDE.md",
  "ARCHITECTURE.md",
  ".github/copilot-instructions.md",
  ".github/instructions/always-on-optimization.instructions.md",
  ".github/skills/token-saver/SKILL.md",
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
  "optimization/token-saver.md",
  "optimization/caveman-mode.md",
  "optimization/optimization-routing.md",
  "docs/always-on-optimization-guide.md",
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
$errors=@()
foreach($i in $required){ if(!(Test-Path $i)){ $errors += "Missing $i" } }

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
  "specs/optimization.spec.md"      = @("## Routing Robustness Contract (Production)", "## Enforcement")
  "specs/repo-intake.spec.md"       = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/rag.spec.md"               = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/routing.spec.md"           = @("## Objetivo", "## Reglas", "## Validacion minima")
  "specs/security.spec.md"          = @("## Objetivo", "## Reglas", "## Validacion minima")
}

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

if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
  $errors += "Missing command codegraph"
}
elseif (-not (Test-Path ".codegraph")) {
  $errors += "Missing .codegraph index. Run: codegraph init -i"
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
  if ($LASTEXITCODE -ne 0) {
    $errors += 'Graphify MCP runtime missing. Run: py -3.14 -m pip install graphifyy and mcp'
  }
}

if (-not (Test-Path "context/graphify-out/graph.json")) {
  $errors += "Missing context/graphify-out/graph.json. Run: py -3.14 -m graphify extract scripts --no-cluster --out context"
}

if($errors.Count -eq 0){
  Write-Host "Validation OK. Always-on optimization documented."
  Write-Host "Running strict repo registry validation..."
  pwsh -NoProfile -File .\scripts\intake\validate-repo-registry.ps1 -Strict
}
else {
  $errors | ForEach-Object { Write-Host $_ }
}
