param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Has-CodegraphIndex([string]$path) {
    return (Test-Path (Join-Path $path '.codegraph'))
}

function Resolve-TargetPath {
    param([string]$RepoRoot)

    $envPath = [Environment]::GetEnvironmentVariable('CODEGRAPH_PROJECT_PATH')
    if (-not [string]::IsNullOrWhiteSpace($envPath)) {
        $resolvedEnvPath = $null
        try {
            $resolvedEnvPath = (Resolve-Path $envPath).Path
        }
        catch {
            $resolvedEnvPath = $null
        }

        if ($resolvedEnvPath -and (Has-CodegraphIndex $resolvedEnvPath)) {
            return $resolvedEnvPath
        }
    }

    $projectCandidates = @()
    $projectsRoot = Join-Path $RepoRoot 'projects'
    if (Test-Path $projectsRoot) {
        foreach ($projectDir in Get-ChildItem -Path $projectsRoot -Directory -ErrorAction SilentlyContinue) {
            if (Has-CodegraphIndex $projectDir.FullName) {
                $projectCandidates += $projectDir.FullName
            }
        }
    }

    if ($projectCandidates.Count -eq 1) {
        return $projectCandidates[0]
    }

    if (Has-CodegraphIndex $RepoRoot) {
        return $RepoRoot
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

& codegraph serve --mcp --path $targetPath
exit $LASTEXITCODE
