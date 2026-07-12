param(
    [switch]$AllHosts,
    [switch]$CurrentProcess,
    [string]$SessionId = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sessionIdResolved = if ([string]::IsNullOrWhiteSpace($SessionId)) {
    if (-not [string]::IsNullOrWhiteSpace($env:MCP_SESSION_ID)) { $env:MCP_SESSION_ID }
    elseif (-not [string]::IsNullOrWhiteSpace($env:VSCODE_TARGET_SESSION_LOG) -and $env:VSCODE_TARGET_SESSION_LOG -match '([0-9a-fA-F-]{36})') { $Matches[1] }
    else { 'terminal-session' }
}
else {
    $SessionId
}

$hookBlock = @"
# >>> MCPEE_TERMINAL_TELEMETRY_START >>>
`$global:MCPEE_TELEMETRY_REPO_ROOT = '$repoRoot'
`$global:MCPEE_TELEMETRY_SESSION_ID = '$sessionIdResolved'
`$global:MCPEE_TELEMETRY_LAST_HISTORY_ID = -1
`$global:MCPEE_TELEMETRY_LAST_STAMP = ''

function global:Get-McpeeTelemetryPythonCommand {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        return @('py', '-3')
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        return @('python')
    }
    if (Get-Command python3 -ErrorAction SilentlyContinue) {
        return @('python3')
    }
    return @()
}

function global:Invoke-McpeeTerminalTelemetry {
    try {
        `$last = Get-History -Count 1 -ErrorAction SilentlyContinue
        if (`$null -eq `$last) { return }

        `$historyId = [int]`$last.Id
        if (`$historyId -le [int]`$global:MCPEE_TELEMETRY_LAST_HISTORY_ID) { return }

        `$commandText = [string]`$last.CommandLine
        if ([string]::IsNullOrWhiteSpace(`$commandText)) { return }

        `$commandTrim = `$commandText.Trim()
        if (`$commandTrim -match 'Invoke-McpeeTerminalTelemetry|emit-terminal-command-telemetry\.py') { 
            `$global:MCPEE_TELEMETRY_LAST_HISTORY_ID = `$historyId
            return 
        }

        `$stamp = ('{0}:{1}' -f `$historyId, `$commandTrim)
        if (`$stamp -eq `$global:MCPEE_TELEMETRY_LAST_STAMP) {
            `$global:MCPEE_TELEMETRY_LAST_HISTORY_ID = `$historyId
            return
        }

        `$py = Get-McpeeTelemetryPythonCommand
        if (`$py.Count -eq 0) {
            `$global:MCPEE_TELEMETRY_LAST_HISTORY_ID = `$historyId
            `$global:MCPEE_TELEMETRY_LAST_STAMP = `$stamp
            return
        }

        `$scriptPath = Join-Path `$global:MCPEE_TELEMETRY_REPO_ROOT 'scripts/ops/emit-terminal-command-telemetry.py'
        if (-not (Test-Path `$scriptPath)) {
            `$global:MCPEE_TELEMETRY_LAST_HISTORY_ID = `$historyId
            `$global:MCPEE_TELEMETRY_LAST_STAMP = `$stamp
            return
        }

        `$success = if (`$?) { 'true' } else { 'false' }
        `$nativeExit = if (`$null -eq `$LASTEXITCODE) { 0 } else { [int]`$LASTEXITCODE }

        `$pyArgs = @()
        if (`$py.Count -gt 1) {
            `$pyArgs = `$py[1..(`$py.Count-1)]
        }

        & `$py[0] @(`$pyArgs) `$scriptPath --session-id `$global:MCPEE_TELEMETRY_SESSION_ID --cwd `$PWD.Path --command `$commandTrim --success `$success --exit-code `$nativeExit *> `$null

        `$global:MCPEE_TELEMETRY_LAST_HISTORY_ID = `$historyId
        `$global:MCPEE_TELEMETRY_LAST_STAMP = `$stamp
    }
    catch {
        # Hook de telemetria best-effort: nunca romper la consola.
    }
}

if (-not (Test-Path Function:\global:MCPEE_ORIGINAL_PROMPT)) {
    `$originalPromptBody = if (Test-Path Function:\global:prompt) { (Get-Command prompt -CommandType Function).ScriptBlock.ToString() } else { '"PS " + `$executionContext.SessionState.Path.CurrentLocation + "> "' }
    Set-Item -Path Function:\global:MCPEE_ORIGINAL_PROMPT -Value ([ScriptBlock]::Create(`$originalPromptBody)) -Force
}

function global:prompt {
    Invoke-McpeeTerminalTelemetry
    & global:MCPEE_ORIGINAL_PROMPT
}
# <<< MCPEE_TERMINAL_TELEMETRY_END <<<
"@

function Install-InProfile {
    param([string]$ProfilePath)

    $dir = Split-Path $ProfilePath -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    if (-not (Test-Path $ProfilePath)) {
        New-Item -ItemType File -Path $ProfilePath -Force | Out-Null
    }

    $content = Get-Content -Path $ProfilePath -Raw -ErrorAction SilentlyContinue
    if ($null -eq $content) { $content = '' }

    if ($content -match 'MCPEE_TERMINAL_TELEMETRY_START') {
        $updated = [regex]::Replace(
            $content,
            '(?s)# >>> MCPEE_TERMINAL_TELEMETRY_START >>>.*?# <<< MCPEE_TERMINAL_TELEMETRY_END <<<',
            $hookBlock
        )
        Set-Content -Path $ProfilePath -Value $updated -Encoding UTF8
    }
    else {
        if (-not [string]::IsNullOrWhiteSpace($content) -and -not $content.EndsWith("`n")) {
            $content += "`r`n"
        }
        $content += "`r`n$hookBlock`r`n"
        Set-Content -Path $ProfilePath -Value $content -Encoding UTF8
    }

    Write-Host "[ok] Hook instalado/actualizado en: $ProfilePath"
}

if ($CurrentProcess) {
    Invoke-Expression $hookBlock
    Write-Host '[ok] Hook cargado en la sesion actual.'
}

Install-InProfile -ProfilePath $PROFILE.CurrentUserCurrentHost
if ($AllHosts) {
    Install-InProfile -ProfilePath $PROFILE.CurrentUserAllHosts
}

Write-Host '[ok] Telemetria global de terminal activada (best-effort).'
Write-Host '[hint] Para desinstalar usa: mcpee observe-off'
