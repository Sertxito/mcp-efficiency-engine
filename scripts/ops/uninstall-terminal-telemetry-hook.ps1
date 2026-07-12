param(
    [switch]$AllHosts,
    [switch]$CurrentProcess
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Remove-FromProfile {
    param([string]$ProfilePath)

    if (-not (Test-Path $ProfilePath)) {
        return
    }

    $content = Get-Content -Path $ProfilePath -Raw -ErrorAction SilentlyContinue
    if ($null -eq $content) {
        return
    }

    if ($content -match 'MCPEE_TERMINAL_TELEMETRY_START') {
        $updated = [regex]::Replace(
            $content,
            '(?s)\r?\n?# >>> MCPEE_TERMINAL_TELEMETRY_START >>>.*?# <<< MCPEE_TERMINAL_TELEMETRY_END <<<\r?\n?',
            "`r`n"
        )
        Set-Content -Path $ProfilePath -Value $updated -Encoding UTF8
        Write-Host "[ok] Hook eliminado de: $ProfilePath"
    }
}

if ($CurrentProcess) {
    Remove-Item Function:\global:prompt -ErrorAction SilentlyContinue
    if (Test-Path Function:\global:MCPEE_ORIGINAL_PROMPT) {
        Set-Item -Path Function:\global:prompt -Value ((Get-Command MCPEE_ORIGINAL_PROMPT -CommandType Function).ScriptBlock) -Force
        Remove-Item Function:\global:MCPEE_ORIGINAL_PROMPT -ErrorAction SilentlyContinue
    }

    Remove-Item Function:\global:Invoke-McpeeTerminalTelemetry -ErrorAction SilentlyContinue
    Remove-Item Function:\global:Get-McpeeTelemetryPythonCommand -ErrorAction SilentlyContinue
    Remove-Variable MCPEE_TELEMETRY_REPO_ROOT -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable MCPEE_TELEMETRY_SESSION_ID -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable MCPEE_TELEMETRY_LAST_HISTORY_ID -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable MCPEE_TELEMETRY_LAST_STAMP -Scope Global -ErrorAction SilentlyContinue
    Write-Host '[ok] Hook desactivado en la sesion actual.'
}

Remove-FromProfile -ProfilePath $PROFILE.CurrentUserCurrentHost
if ($AllHosts) {
    Remove-FromProfile -ProfilePath $PROFILE.CurrentUserAllHosts
}

Write-Host '[ok] Telemetria global de terminal desactivada.'
