param(
    [switch]$InstallMissing,
    [switch]$DeepGitNexus,
    [switch]$SkipRepomixRefresh,
    [switch]$SkipCbmAutoIndex
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PythonCommand {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        return @('py', '-3.14')
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        return @('python')
    }
    throw 'Python no esta disponible (py/python).'
}

function Require-Command {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [switch]$Optional
    )

    if (Get-Command $Name -ErrorAction SilentlyContinue) {
        Write-Host "[ok] comando disponible: $Name"
        return $true
    }

    if ($Optional) {
        Write-Host "[info] comando opcional ausente: $Name" -ForegroundColor DarkYellow
        return $false
    }

    throw "Comando requerido no disponible: $Name"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

Write-Host '=== OPTIMIZE ENGINES ===' -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"

if ($InstallMissing) {
    Write-Host '[step] Instalando prerequisitos MCP faltantes...'
    & pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\setup-prerequisites.ps1
    if ($LASTEXITCODE -ne 0) {
        throw "setup-prerequisites fallo con exit code $LASTEXITCODE"
    }
}

Write-Host '[step] Validando contexto base...'
& pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup\validate-context.ps1
if ($LASTEXITCODE -ne 0) {
    throw "validate-context fallo con exit code $LASTEXITCODE"
}

Require-Command -Name 'codegraph' | Out-Null
Require-Command -Name 'gitnexus' | Out-Null
Require-Command -Name 'token-saver-mcp' | Out-Null
Require-Command -Name 'codebase-memory-mcp' | Out-Null
$hasRepomix = Require-Command -Name 'repomix' -Optional

Write-Host '[step] Afinando .vscode/mcp.json para arranque local rapido...'
$mcpPath = Join-Path $repoRoot '.vscode/mcp.json'
$mcp = Get-Content -Raw -Path $mcpPath | ConvertFrom-Json -Depth 20

$mcp.servers.gitnexus.command = 'gitnexus'
$mcp.servers.gitnexus.args = @('mcp')

$gitnexusServer = $mcp.servers.gitnexus
$gitnexusEnv = [ordered]@{}
if (($gitnexusServer.PSObject.Properties.Name -contains 'env') -and $gitnexusServer.env) {
    if ($gitnexusServer.env -is [System.Collections.IDictionary]) {
        foreach ($k in $gitnexusServer.env.Keys) {
            $gitnexusEnv[[string]$k] = [string]$gitnexusServer.env[$k]
        }
    }
    else {
        foreach ($p in $gitnexusServer.env.PSObject.Properties) {
            $gitnexusEnv[[string]$p.Name] = [string]$p.Value
        }
    }
}

# VECTOR index no esta disponible en Windows para LadybugDB; subimos el limite de exact-scan semantico.
$gitnexusEnv['GITNEXUS_SEMANTIC_EXACT_SCAN_LIMIT'] = '50000'
$gitnexusEnv['GITNEXUS_EMBEDDING_THREADS'] = '4'

if ($gitnexusServer.PSObject.Properties.Name -contains 'env') {
    $gitnexusServer.env = $gitnexusEnv
}
else {
    $gitnexusServer | Add-Member -NotePropertyName env -NotePropertyValue $gitnexusEnv -Force
}

if ($hasRepomix) {
    $mcp.servers.repomix.command = 'repomix'
    $mcp.servers.repomix.args = @('--mcp')
}

$mcp | ConvertTo-Json -Depth 20 | Set-Content -Path $mcpPath -Encoding UTF8

Write-Host '[step] Sincronizando CodeGraph...'
& codegraph sync
if ($LASTEXITCODE -ne 0) {
    throw "codegraph sync fallo con exit code $LASTEXITCODE"
}
& codegraph status

Write-Host '[step] Validando/optimizando indice GitNexus...'
$doctor = gitnexus doctor | Out-String
if ($doctor -match 'VECTOR index:\s+unavailable') {
    Write-Host '[info] GitNexus sin VECTOR index en esta plataforma; se usa exact-scan con limite aumentado en MCP.' -ForegroundColor DarkYellow
}
$gStatus = gitnexus status | Out-String
if ($gStatus -match 'Repository not indexed') {
    gitnexus analyze . --skills
}
elseif ($DeepGitNexus) {
    gitnexus analyze . --skills --embeddings
}
else {
    Write-Host '[ok] GitNexus index presente; usa -DeepGitNexus para optimizacion completa con embeddings.'
}

Write-Host '[step] Validando runtime de Graphify...'
$py = Get-PythonCommand
$pyCmd = $py[0]
$pyArgs = @()
if ($py.Length -gt 1) {
    $pyArgs = $py[1..($py.Length - 1)]
}

& $pyCmd @pyArgs -c "import graphify.serve, mcp; print('GRAPHIFY_OK')"
if ($LASTEXITCODE -ne 0) {
    throw 'Graphify runtime no disponible.'
}

if (-not $SkipCbmAutoIndex) {
    Write-Host '[step] Habilitando auto-index en codebase-memory-mcp...'
    & codebase-memory-mcp config set auto_index true
    if ($LASTEXITCODE -ne 0) {
        throw "codebase-memory-mcp config set auto_index fallo con exit code $LASTEXITCODE"
    }
    & codebase-memory-mcp config set auto_index_limit 50000
    if ($LASTEXITCODE -ne 0) {
        throw "codebase-memory-mcp config set auto_index_limit fallo con exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path '.\context\graphify-out\graph.json')) {
    Write-Host '[step] Generando graph.json de Graphify...'
    & $pyCmd @pyArgs -m graphify extract scripts --no-cluster --out context
    if ($LASTEXITCODE -ne 0) {
        throw "graphify extract fallo con exit code $LASTEXITCODE"
    }
}

if (-not $SkipRepomixRefresh) {
    if ($hasRepomix) {
        Write-Host '[step] Refrescando snapshot Repomix...'
        & pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\context\build-repomix.ps1
        if ($LASTEXITCODE -ne 0) {
            throw "build-repomix fallo con exit code $LASTEXITCODE"
        }
    }
    else {
        Write-Host '[info] Repomix no instalado; se omite refresh de snapshot.' -ForegroundColor DarkYellow
    }
}

Write-Host '[step] Ejecutando smoke de routing...'
& $pyCmd @pyArgs .\scripts\intake\run-routing-evals.py
if ($LASTEXITCODE -ne 0) {
    throw "run-routing-evals fallo con exit code $LASTEXITCODE"
}

Write-Host ''
Write-Host 'Motores optimizados y validados.' -ForegroundColor Green
Write-Host 'Recomendado: reiniciar VS Code/Copilot Chat para recargar MCP con los comandos locales.'