param(
    [string]$ConfigPath = ".\autodocs\analysis_mcpee\demo-session.config.json",
    [switch]$StopOnError,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'run-demo-block.ps1') -Demo demo4 -ConfigPath $ConfigPath -StopOnError:$StopOnError -DryRun:$DryRun
exit $LASTEXITCODE
