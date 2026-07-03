param(
    [string]$ConfigPath = ".\projects\TSS2026\analysis_mcpee\demo-session.config.json",
    [switch]$StopOnError,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$demo1Exit = 0
$demo2Exit = 0
$demo3Exit = 0
$demo4Exit = 0

& (Join-Path $PSScriptRoot 'demo1.ps1') -ConfigPath $ConfigPath -StopOnError:$StopOnError -DryRun:$DryRun
$demo1Exit = $LASTEXITCODE

& (Join-Path $PSScriptRoot 'demo2.ps1') -ConfigPath $ConfigPath -StopOnError:$StopOnError -DryRun:$DryRun
$demo2Exit = $LASTEXITCODE

& (Join-Path $PSScriptRoot 'demo3.ps1') -ConfigPath $ConfigPath -StopOnError:$StopOnError -DryRun:$DryRun
$demo3Exit = $LASTEXITCODE

& (Join-Path $PSScriptRoot 'demo4.ps1') -ConfigPath $ConfigPath -StopOnError:$StopOnError -DryRun:$DryRun
$demo4Exit = $LASTEXITCODE

& (Join-Path $PSScriptRoot 'compare-demo-results.ps1') -ShowConsole

if ($demo1Exit -ne 0 -or $demo2Exit -ne 0 -or $demo3Exit -ne 0 -or $demo4Exit -ne 0) {
    Write-Host ''
    Write-Host '=== FIN SESION DEMOS: TERMINADO CON INCIDENCIAS ===' -ForegroundColor Red
    Write-Host ("Codigos: demo1={0}, demo2={1}, demo3={2}, demo4={3}" -f $demo1Exit, $demo2Exit, $demo3Exit, $demo4Exit)
    exit 1
}

Write-Host ''
Write-Host '=== FIN SESION DEMOS: TERMINADO OK ===' -ForegroundColor Green
Write-Host 'Las 4 demos finalizaron correctamente y la comparativa fue generada.'
exit 0
