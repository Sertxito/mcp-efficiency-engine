#!/usr/bin/env pwsh
#Requires -Version 7

param(
    [string]$Owner = "Sertxito",
    [string]$Repo = "",
    [string]$ReadmeFile = ""
)

if (-not $Repo -or -not $ReadmeFile) {
    Write-Host "Uso: $($MyInvocation.MyCommand.Name) -Repo boost_RAG-Azure -ReadmeFile templates/README_boost_RAG_Azure.md"
    exit 1
}

$TempDir = "temp_apply_$Repo"
$FullRepo = "$Owner/$Repo"

Write-Host "Processing: $FullRepo" -ForegroundColor Green

# Clean up old temp dir
if (Test-Path $TempDir) { 
    Remove-Item -Recurse -Force $TempDir 
}

# Clone repo
Write-Host "  Cloning..." -ForegroundColor DarkGray
gh repo clone $FullRepo $TempDir -- --depth 1

if (-not (Test-Path $TempDir)) {
    Write-Host "  ERROR: Clone failed" -ForegroundColor Red
    exit 1
}

Push-Location $TempDir

# Copy files
Write-Host "  Applying files..." -ForegroundColor DarkGray

# README
Copy-Item "../$ReadmeFile" README.md -Force
Write-Host "    ✓ README.md"

# LICENSE
Copy-Item ../templates/LICENSE_MIT_TEMPLATE.txt LICENSE -Force
Write-Host "    ✓ LICENSE"

# CODEOWNERS
New-Item -ItemType Directory .github -Force | Out-Null
Copy-Item ../templates/CODEOWNERS_TEMPLATE.txt .github/CODEOWNERS -Force
Write-Host "    ✓ CODEOWNERS"

# CI workflow
New-Item -ItemType Directory .github/workflows -Force | Out-Null
Copy-Item ../templates/ci.yml.template .github/workflows/ci.yml -Force
Write-Host "    ✓ ci.yml"

# Git commit
Write-Host "  Committing..." -ForegroundColor DarkGray
git config user.name "GitHub Automation"
git config user.email "automation@github.com"
git add README.md LICENSE .github/CODEOWNERS .github/workflows/ci.yml
git commit -m "chore: standardize templates (README, LICENSE, CODEOWNERS, CI)" 

if ($LASTEXITCODE -ne 0) {
    Write-Host "    [no changes]" -ForegroundColor DarkGray
} else {
    Write-Host "    ✓ Committed" -ForegroundColor Green
}

# Git push
Write-Host "  Pushing..." -ForegroundColor DarkGray
git push origin main 2>$null

if ($LASTEXITCODE -eq 0) {
    Write-Host "    ✓ Pushed successfully" -ForegroundColor Green
} else {
    Write-Host "    ! Push had warnings (might be ok)" -ForegroundColor Yellow
}

Pop-Location

# Clean up
Remove-Item -Recurse -Force $TempDir

Write-Host "✅ Done: $Repo" -ForegroundColor Green
