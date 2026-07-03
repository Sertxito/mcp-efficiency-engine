param(
    [ValidateSet('demo1', 'demo2', 'demo3', 'demo4', 'all')]
    [string]$Demo,
    [string]$ConfigPath = ".\projects\TSS2026\analysis_mcpee\demo-session.config.json",
    [switch]$StopOnError,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-AbsolutePath {
    param(
        [string]$Path,
        [string]$BasePath
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$configAbsPath = Resolve-AbsolutePath -Path $ConfigPath -BasePath $repoRoot

if (-not (Test-Path $configAbsPath)) {
    $fallbackConfig = Resolve-AbsolutePath -Path ".\projects\TSS2026\analysis_mcpee\demo-session.config.example.json" -BasePath $repoRoot
    if (Test-Path $fallbackConfig) {
        Write-Host ("Config no encontrado, usando ejemplo: {0}" -f $fallbackConfig) -ForegroundColor Yellow
        $configAbsPath = $fallbackConfig
    }
    else {
        throw "Config file not found: $configAbsPath"
    }
}

$config = Get-Content $configAbsPath -Raw | ConvertFrom-Json -Depth 20
if ($null -eq $config.steps -or @($config.steps).Count -eq 0) {
    throw "Config has no steps: $configAbsPath"
}

$pattern = switch ($Demo) {
    'demo1' { '^Demo 1' }
    'demo2' { '^Demo 2' }
    'demo3' { '^Demo 3' }
    'demo4' { '^Demo 4|^Cierre' }
    default { '.*' }
}

$selectedSteps = @($config.steps | Where-Object { [string]$_.name -match $pattern })
if ($selectedSteps.Count -eq 0) {
    throw "No steps match block '$Demo' in config: $configAbsPath"
}

$tmpRoot = Join-Path $repoRoot "projects\TSS2026\analysis_mcpee\tmp"
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
$tmpConfigPath = Join-Path $tmpRoot ("demo-block-{0}-{1}.json" -f $Demo, (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))

$sessionNameBase = if ([string]::IsNullOrWhiteSpace([string]$config.session_name)) {
    'demo-session'
}
else {
    [string]$config.session_name
}

$blockConfig = [ordered]@{
    session_name = "{0}-{1}" -f $sessionNameBase, $Demo
    output_root = [string]$config.output_root
    stop_on_error = [bool]($StopOnError -or ($config.stop_on_error -eq $true))
    steps = @($selectedSteps)
}

$blockConfig | ConvertTo-Json -Depth 20 | Set-Content -Path $tmpConfigPath -Encoding UTF8

try {
    & (Join-Path $PSScriptRoot 'run-demo-session.ps1') -ConfigPath $tmpConfigPath -StopOnError:$StopOnError -DryRun:$DryRun
    exit $LASTEXITCODE
}
finally {
    if (Test-Path $tmpConfigPath) {
        Remove-Item -Path $tmpConfigPath -Force -ErrorAction SilentlyContinue
    }
}
