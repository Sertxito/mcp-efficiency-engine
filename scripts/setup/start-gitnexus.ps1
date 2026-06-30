param(
    [switch]$ForceReindex,
    [switch]$NoServe,
    [switch]$NoOpenBrowser,
    [string]$BindHost = '127.0.0.1',
    [int]$Port = 4747,
    [int]$WaitSeconds = 12
)

$ErrorActionPreference = 'Stop'

function Test-GitNexusEndpoint {
    param(
        [string]$Url
    )

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
    }
    catch {
        return $false
    }
}

if (-not (Get-Command gitnexus -ErrorAction SilentlyContinue)) {
    throw 'gitnexus no esta instalado o no esta en PATH. Ejecuta scripts/setup/setup-prerequisites.ps1 primero.'
}

$status = gitnexus status | Out-String
$needsIndex = $ForceReindex -or ($status -match 'Repository not indexed')

if ($needsIndex) {
    Write-Host '[gitnexus] Indexando repositorio actual...'
    gitnexus analyze .
}
else {
    Write-Host '[gitnexus] Repositorio ya indexado.'
}

$url = "http://$BindHost`:$Port"

if (-not $NoServe) {
    if (Test-GitNexusEndpoint -Url $url) {
        Write-Host "[gitnexus] Backend ya activo en $url"
    }
    else {
        Write-Host "[gitnexus] Iniciando backend en $url ..."
        Start-Process -FilePath 'cmd.exe' -ArgumentList "/c gitnexus serve --host $BindHost --port $Port" -WindowStyle Minimized | Out-Null

        $started = $false
        for ($i = 0; $i -lt $WaitSeconds; $i++) {
            Start-Sleep -Seconds 1
            if (Test-GitNexusEndpoint -Url $url) {
                $started = $true
                break
            }
        }

        if (-not $started) {
            Write-Host "[gitnexus] Aviso: no hubo respuesta HTTP en $url tras $WaitSeconds s." -ForegroundColor DarkYellow
        }
    }
}

if (-not $NoOpenBrowser) {
    Write-Host "[gitnexus] Abriendo UI: $url"
    Start-Process $url
}

Write-Host '[gitnexus] Listo.'