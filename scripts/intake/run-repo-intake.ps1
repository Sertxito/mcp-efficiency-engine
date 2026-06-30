Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

Write-Host "Validating repo registry (strict mode)..."
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\intake\validate-repo-registry.ps1 -Strict
if ($LASTEXITCODE -ne 0) {
	Write-Error "Repo registry validation failed. Aborting intake generation."
	exit $LASTEXITCODE
}

Write-Host "Running repo intake generation..."
python .\scripts\intake\repo-intake.py

Write-Host "Repo intake completed."
