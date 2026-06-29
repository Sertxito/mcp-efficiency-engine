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
  "scripts/validate-repo-registry.ps1",
  "scripts/validate-repo-registry.py",
  "scripts/run-repo-intake.cmd",
  "observability/logs.schema.json",
  "scripts/resolve-routing.py",
  "scripts/run-routing-evals.py",
  "observability/evals/routing-eval-cases.json",
  "scripts/discover-boost-repos.py",
  "scripts/discover-boost-repos.cmd"
)
$errors=@()
foreach($i in $required){ if(!(Test-Path $i)){ $errors += "Missing $i" } }

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
  pwsh -NoProfile -File .\scripts\validate-repo-registry.ps1 -Strict
}
else {
  $errors | ForEach-Object { Write-Host $_ }
}
