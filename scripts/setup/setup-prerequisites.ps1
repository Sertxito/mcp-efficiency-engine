param(
    [switch]$SkipCodebaseMemory,
    [switch]$SkipTokenSaver,
    [switch]$SkipCodegraph,
    [switch]$SkipGitnexus,
    [switch]$SkipGraphify
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

function Test-Command {
    param([Parameter(Mandatory = $true)][string]$Name)

    return [bool](Get-Command -Name $Name -ErrorAction SilentlyContinue)
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

function Test-PythonImport {
    param(
        [Parameter(Mandatory = $true)][string]$PythonCommand,
        [string[]]$PythonArgs = @(),
        [Parameter(Mandatory = $true)][string]$Module
    )

    & $PythonCommand @PythonArgs -c "import $Module" *> $null
    return ($LASTEXITCODE -eq 0)
}

function Resolve-PythonCommand {
    if (Test-Command 'py') {
        return @('py', '-3.14')
    }
    if (Test-Command 'python') {
        return @('python')
    }
    throw 'Python 3.14 is required for graphify MCP. Install Python first: https://www.python.org/downloads/'
}

Write-Host '== MCP platform prerequisites setup =='

if (-not $SkipCodebaseMemory) {
    if (Test-Command 'codebase-memory-mcp') {
        Write-Host '[ok] codebase-memory-mcp already installed'
    }
    else {
        Write-Host '[install] codebase-memory-mcp via official Windows setup script'
        Invoke-RestMethod https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/scripts/setup-windows.ps1 | Invoke-Expression
    }
}

if (-not $SkipTokenSaver) {
    Install-NpmGlobalPackage -Package 'token-saver-mcp' -ExpectedCommand 'token-saver-mcp'
}

if (-not $SkipCodegraph) {
    Install-NpmGlobalPackage -Package '@colbymchenry/codegraph' -ExpectedCommand 'codegraph'
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
    Install-NpmGlobalPackage -Package 'gitnexus@latest' -ExpectedCommand 'gitnexus'
    Write-Host '[setup] gitnexus setup'
    gitnexus setup
}

if (-not $SkipGraphify) {
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

    Write-Host '[install] python -m pip install "graphifyy[mcp]"'
    & $pyCmd @pyArgs -m pip install "graphifyy[mcp]"

    if (-not (Test-PythonImport -PythonCommand $pyCmd -PythonArgs $pyArgs -Module 'graphify.serve')) {
        throw 'graphify.serve import failed after installation.'
    }

    if (-not (Test-PythonImport -PythonCommand $pyCmd -PythonArgs $pyArgs -Module 'mcp')) {
        throw 'mcp module import failed after graphify installation.'
    }

    if (-not (Test-Path 'context/graphify-out/graph.json')) {
        Write-Host '[setup] graphify extract scripts --no-cluster --out context'
        & $pyCmd @pyArgs -m graphify extract scripts --no-cluster --out context
    }
    else {
        Write-Host '[ok] context/graphify-out/graph.json already exists'
    }
}

Write-Host ''
Write-Host 'Setup complete. Recommended next checks:'
Write-Host '  1) .\scripts\setup\validate-context.ps1'
Write-Host '  2) .\scripts\intake\run-repo-intake.cmd'
Write-Host '  3) /mcp (in your agent) to verify servers are active'
