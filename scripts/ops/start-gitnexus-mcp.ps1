param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Is-GitRepo([string]$path) {
    return (Test-Path (Join-Path $path '.git'))
}

function Has-GitNexusIndex([string]$path) {
    return (Test-Path (Join-Path $path '.gitnexus'))
}

function Resolve-TargetPath {
    param([string]$RepoRoot)

    $envPath = [Environment]::GetEnvironmentVariable('GITNEXUS_PROJECT_PATH')
    if (-not [string]::IsNullOrWhiteSpace($envPath)) {
        $resolvedEnvPath = $null
        try {
            $resolvedEnvPath = (Resolve-Path $envPath).Path
        }
        catch {
            $resolvedEnvPath = $null
        }

        if ($resolvedEnvPath -and (Is-GitRepo $resolvedEnvPath)) {
            return $resolvedEnvPath
        }
    }

    $projectCandidates = @()
    $indexedProjectCandidates = @()
    $projectsRoot = Join-Path $RepoRoot 'projects'

    if (Test-Path $projectsRoot) {
        foreach ($projectDir in Get-ChildItem -Path $projectsRoot -Directory -ErrorAction SilentlyContinue) {
            if (Is-GitRepo $projectDir.FullName) {
                $projectCandidates += $projectDir.FullName
                if (Has-GitNexusIndex $projectDir.FullName) {
                    $indexedProjectCandidates += $projectDir.FullName
                }
            }
        }
    }

    if ($indexedProjectCandidates.Count -eq 1) {
        return $indexedProjectCandidates[0]
    }

    if ((Has-GitNexusIndex $RepoRoot) -and (Is-GitRepo $RepoRoot)) {
        return $RepoRoot
    }

    if ($indexedProjectCandidates.Count -gt 1) {
        return $indexedProjectCandidates[0]
    }

    if ($projectCandidates.Count -eq 1) {
        return $projectCandidates[0]
    }

    if ($projectCandidates.Count -gt 1) {
        return $projectCandidates[0]
    }

    return $RepoRoot
}

$repoRoot = Resolve-RepoRoot
$targetPath = Resolve-TargetPath -RepoRoot $repoRoot

if ($DryRun) {
    Write-Output $targetPath
    exit 0
}

Set-Location $targetPath
& gitnexus mcp
exit $LASTEXITCODE
