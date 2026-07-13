param(
    [switch]$SkipCodebaseMemory,
    [switch]$SkipTokenSaver,
    [switch]$SkipCodegraph,
    [switch]$SkipGitnexus,
    [switch]$SkipGraphify,
    [switch]$SkipRepomix,
    [switch]$PortableMode,
    [switch]$VerboseTrace
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot
$toolingManifestPath = Join-Path $repoRoot 'tooling/tooling.manifest.json'

function Test-Command {
    param([Parameter(Mandatory = $true)][string]$Name)

    return [bool](Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Write-TraceStep {
    param(
        [Parameter(Mandatory = $true)][string]$Message
    )

    if ($VerboseTrace) {
        $stamp = (Get-Date).ToString('HH:mm:ss')
        Write-Host ("[trace {0}] {1}" -f $stamp, $Message) -ForegroundColor DarkGray
    }
}

function Install-NpmGlobalPackage {
    param(
        [Parameter(Mandatory = $true)][string]$Package,
        [Parameter(Mandatory = $true)][string]$ExpectedCommand
    )

    if (Test-Command $ExpectedCommand) {
        Write-Host "[ok] $ExpectedCommand already installed"
        return
    }

    if (-not (Test-Command 'npm')) {
        throw "npm is required to install $Package. Install Node.js first: https://nodejs.org/"
    }

    Write-Host "[install] npm install -g $Package"
    npm install -g $Package
}

function Get-ToolingManifest {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Missing tooling manifest: $Path"
    }

    return Get-Content -Raw -Path $Path | ConvertFrom-Json -Depth 20
}

function Install-ToolFromManifest {
    param([Parameter(Mandatory = $true)][object]$Tool)

    $commandName = [string]$Tool.command
    if (Test-Command $commandName) {
        Write-Host "[ok] $commandName already installed"
        return
    }

    $install = $Tool.install
    $installKind = [string]$install.kind

    switch ($installKind) {
        'npm-global' {
            Install-NpmGlobalPackage -Package ([string]$install.package) -ExpectedCommand $commandName
        }
        'powershell-script' {
            $scriptUrl = [string]$install.script_url
            if (-not $scriptUrl) {
                throw "Missing script_url for manifest tool $($Tool.name)"
            }

            Write-Host "[install] $commandName via official Windows setup script"
            Invoke-RestMethod $scriptUrl | Invoke-Expression
        }
        default {
            throw "Unsupported install kind '$installKind' for manifest tool $($Tool.name)"
        }
    }
}

function Test-PythonImport {
    param(
        [Parameter(Mandatory = $true)][string]$PythonCommand,
        [string[]]$PythonArgs = @(),
        [Parameter(Mandatory = $true)][string]$Module
    )

    & $PythonCommand @PythonArgs -c "import $Module" *> $null
    return ($LASTEXITCODE -eq 0)
}

function Install-PythonRequirements {
    param(
        [Parameter(Mandatory = $true)][string]$PythonCommand,
        [string[]]$PythonArgs = @(),
        [Parameter(Mandatory = $true)][string]$RequirementsPath
    )

    if (-not (Test-Path $RequirementsPath)) {
        throw "Missing Python requirements file: $RequirementsPath"
    }

    Write-Host "[install] $PythonCommand $($PythonArgs -join ' ') -m pip install -r $RequirementsPath"
    & $PythonCommand @PythonArgs -m pip install -r $RequirementsPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install Python requirements from $RequirementsPath"
    }
}

function Resolve-PythonCommand {
    if (Test-Command 'py') {
        return @('py', '-3')
    }
    if (Test-Command 'python') {
        return @('python')
    }
    throw 'Python 3 is required for MCP scripts. Install Python first: https://www.python.org/downloads/'
}

function Ensure-PythonModuleInstalled {
    param(
        [Parameter(Mandatory = $true)][string]$PythonCommand,
        [string[]]$PythonArgs = @(),
        [Parameter(Mandatory = $true)][string]$Module,
        [Parameter(Mandatory = $true)][string]$Package
    )

    if (Test-PythonImport -PythonCommand $PythonCommand -PythonArgs $PythonArgs -Module $Module) {
        Write-Host "[ok] Python module '$Module' already available"
        return
    }

    Write-Host "[install] $PythonCommand $($PythonArgs -join ' ') -m pip install $Package"
    & $PythonCommand @PythonArgs -m pip install $Package
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install Python package '$Package'"
    }

    if (-not (Test-PythonImport -PythonCommand $PythonCommand -PythonArgs $PythonArgs -Module $Module)) {
        throw "Python module '$Module' is still unavailable after installing '$Package'"
    }
}

function Sync-GraphifyArtifactsFromScripts {
    $scriptsGraphPath = 'scripts/graphify-out/graph.json'
    $contextGraphDir = 'context/graphify-out'
    $contextGraphPath = Join-Path $contextGraphDir 'graph.json'

    if (-not (Test-Path $scriptsGraphPath)) {
        return $false
    }

    New-Item -ItemType Directory -Path $contextGraphDir -Force | Out-Null
    Copy-Item -Path $scriptsGraphPath -Destination $contextGraphPath -Force

    $scriptsManifestPath = 'scripts/graphify-out/manifest.json'
    $contextManifestPath = Join-Path $contextGraphDir 'manifest.json'
    if (Test-Path $scriptsManifestPath) {
        Copy-Item -Path $scriptsManifestPath -Destination $contextManifestPath -Force
    }

    return $true
}

Write-Host '== MCP platform prerequisites setup =='
Write-TraceStep -Message ("repoRoot={0}" -f $repoRoot)

$toolingManifest = Get-ToolingManifest -Path $toolingManifestPath
$externalCliEntries = @($toolingManifest.external_clis)
$toolByCommand = @{}
foreach ($tool in $externalCliEntries) {
    $toolByCommand[[string]$tool.command] = $tool
}

if (-not $SkipCodebaseMemory) {
    Write-TraceStep -Message 'Installing codebase-memory-mcp from tooling manifest'
    Install-ToolFromManifest -Tool $toolByCommand['codebase-memory-mcp']
}

if (-not $SkipTokenSaver) {
    Write-TraceStep -Message 'Installing token-saver-mcp from tooling manifest'
    Install-ToolFromManifest -Tool $toolByCommand['token-saver-mcp']
}

if (-not $SkipCodegraph) {
    Write-TraceStep -Message 'Installing/verifying codegraph'
    Install-ToolFromManifest -Tool $toolByCommand['codegraph']
    Write-Host '[setup] codegraph install'
    codegraph install
    if (-not (Test-Path '.codegraph')) {
        Write-Host '[setup] codegraph init -i'
        codegraph init -i
    }
    else {
        Write-Host '[ok] .codegraph index already exists'
    }
}

if (-not $SkipGitnexus) {
    Write-TraceStep -Message 'Installing/verifying gitnexus'
    Install-ToolFromManifest -Tool $toolByCommand['gitnexus']
    Write-Host '[setup] gitnexus setup'
    gitnexus setup
}

if (-not $SkipRepomix) {
    Write-TraceStep -Message 'Installing/verifying repomix'
    Install-ToolFromManifest -Tool $toolByCommand['repomix']
}

$py = Resolve-PythonCommand
$pyCmd = $py[0]
$pyArgs = @()
if ($py.Length -gt 1) {
    $pyArgs = $py[1..($py.Length - 1)]
}

if ($py.Length -gt 1) {
    Write-Host "[setup] Using Python launcher: $($py -join ' ')"
}
else {
    Write-Host "[setup] Using Python launcher: $pyCmd"
}

# Core observability dependency used by KPI publishing and telemetry export.
Write-TraceStep -Message 'Ensuring Python module langsmith'
Ensure-PythonModuleInstalled -PythonCommand $pyCmd -PythonArgs $pyArgs -Module 'langsmith' -Package 'langsmith'

if (-not $SkipGraphify) {
    Write-TraceStep -Message 'Installing Python requirements for graphify runtime'
    Install-PythonRequirements -PythonCommand $pyCmd -PythonArgs $pyArgs -RequirementsPath 'requirements.txt'

    if (-not (Test-PythonImport -PythonCommand $pyCmd -PythonArgs $pyArgs -Module 'graphify.serve')) {
        throw 'graphify.serve import failed after installation.'
    }

    if (-not (Test-PythonImport -PythonCommand $pyCmd -PythonArgs $pyArgs -Module 'mcp')) {
        throw 'mcp module import failed after graphify installation.'
    }

    if (-not (Test-Path 'context/graphify-out/graph.json')) {
        Write-Host '[setup] graphify update scripts --no-cluster'
        Write-TraceStep -Message ("Running: {0} {1} -m graphify update scripts --no-cluster" -f $pyCmd, ($pyArgs -join ' '))
        & $pyCmd @pyArgs -m graphify update scripts --no-cluster
        if ($LASTEXITCODE -ne 0) {
            throw "graphify update failed with exit code $LASTEXITCODE"
        }

        if (Sync-GraphifyArtifactsFromScripts) {
            Write-Host '[ok] graphify output synced from scripts/graphify-out to context/graphify-out'
        }
    }
    else {
        Write-Host '[ok] context/graphify-out/graph.json already exists'
        Write-TraceStep -Message 'Skipping graphify update because context graph already exists'
    }
}

Write-Host ''
Write-Host 'Setup complete. Recommended next checks:'
if ($PortableMode) {
    Write-Host '  1) .\scripts\setup\validate-context.ps1 -PortableMode'
}
else {
    Write-Host '  1) .\scripts\setup\validate-context.ps1'
}
Write-Host '  2) .\scripts\intake\run-repo-intake.cmd'
Write-Host '  3) /mcp (in your agent) to verify servers are active'
