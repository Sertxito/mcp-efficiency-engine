Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "Validating repo registry (strict mode)..."
pwsh -NoProfile -File .\scripts\validate-repo-registry.ps1 -Strict
if ($LASTEXITCODE -ne 0) {
	Write-Error "Repo registry validation failed. Aborting intake generation."
	exit $LASTEXITCODE
}

Write-Host "Running repo intake generation..."
python .\scripts\repo-intake.py

Write-Host "Repo intake completed."
