param(
    [string]$ConfigPath = ".\projects\TSS2026\analysis_mcpee\demo-session.config.json",
    [switch]$StopOnError,
    [switch]$DryRun,
    [switch]$ShowConsoleSummary = $true
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

function New-RunFolder {
    param(
        [string]$OutputRoot,
        [string]$SessionName
    )

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $safeSession = ($SessionName.ToLowerInvariant() -replace '[^a-z0-9_-]+', '-') -replace '(^-|-$)', ''
    $runFolder = Join-Path $OutputRoot ("{0}-{1}" -f $stamp, $safeSession)
    New-Item -ItemType Directory -Path $runFolder -Force | Out-Null
    return $runFolder
}

function Convert-ToNullableDouble {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    $normalized = $Value.Trim().Replace(',', '.')
    $parsed = 0.0
    if ([double]::TryParse($normalized, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
        return [double]$parsed
    }

    return $null
}

function Get-PatternSum {
    param(
        [string]$Text,
        [string]$Pattern
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }

    $matches = [regex]::Matches($Text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($matches.Count -eq 0) {
        return $null
    }

    $sum = 0.0
    $found = $false
    foreach ($m in $matches) {
        if ($m.Groups.Count -lt 2) {
            continue
        }
        $n = Convert-ToNullableDouble -Value $m.Groups[1].Value
        if ($null -ne $n) {
            $sum += $n
            $found = $true
        }
    }

    if (-not $found) {
        return $null
    }

    return [math]::Round($sum, 6)
}

function Get-TokenMetricsFromText {
    param([string]$Text)

    $prompt = Get-PatternSum -Text $Text -Pattern '(?:prompt_tokens|input_tokens)\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)'
    $context = Get-PatternSum -Text $Text -Pattern '(?:context_tokens)\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)'
    $response = Get-PatternSum -Text $Text -Pattern '(?:completion_tokens|output_tokens|response_tokens)\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)'
    $total = Get-PatternSum -Text $Text -Pattern '(?:total_tokens|tokens_total)\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)'
    $cost = Get-PatternSum -Text $Text -Pattern '(?:total_cost_usd|cost_estimated_usd|cost_usd|total_cost)\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)'

    $source = 'logs'
    $probeStatusMatch = [regex]::Match(($Text ?? ''), '(?:probe_status)\s*[:=]\s*([^\r\n]+)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($probeStatusMatch.Success -and $probeStatusMatch.Groups.Count -gt 1) {
        $source = ('probe-' + $probeStatusMatch.Groups[1].Value.Trim())
    }

    # Compatibility with RAG CLI output format: "Tokens: 1234"
    if ($null -eq $total) {
        $tokensAlt = Get-PatternSum -Text $Text -Pattern '(?:Tokens)\s*:\s*([0-9]+(?:[\.,][0-9]+)?)'
        if ($null -ne $tokensAlt) {
            $total = $tokensAlt
        }
    }
    if ($null -eq $prompt -and $null -eq $context -and $null -eq $response -and $null -eq $total -and $null -eq $cost) {
        $source = 'logs-no-token-pattern'
        $total = 0
        $cost = 0
    }

    return [ordered]@{
        tokens_prompt = $prompt
        tokens_context = $context
        tokens_response = $response
        tokens_total = $total
        cost_estimated_usd = $cost
        source = $source
    }
}

function Get-SumOrZero {
    param([array]$Values)

    if ($null -eq $Values -or $Values.Count -eq 0) {
        return 0
    }

    $sum = (@($Values) | Measure-Object -Sum).Sum
    if ($null -eq $sum) {
        return 0
    }

    return [double]$sum
}

function Invoke-Step {
    param(
        [int]$Index,
        [int]$Total,
        [pscustomobject]$Step,
        [string]$RunFolder,
        [switch]$DryRun
    )

    $stepName = [string]$Step.name
    $question = [string]$Step.question
    $flow = @($Step.flow)
    $workingDir = [string]$Step.working_dir
    $command = [string]$Step.command
    $timeoutSec = if ($null -ne $Step.timeout_sec) { [int]$Step.timeout_sec } else { 1800 }
    $required = if ($null -ne $Step.required) { [bool]$Step.required } else { $true }

    $safeStep = ($stepName.ToLowerInvariant() -replace '[^a-z0-9_-]+', '-') -replace '(^-|-$)', ''
    $stdoutPath = Join-Path $RunFolder ("{0:D2}-{1}.stdout.log" -f $Index, $safeStep)
    $stderrPath = Join-Path $RunFolder ("{0:D2}-{1}.stderr.log" -f $Index, $safeStep)
    $combinedPath = Join-Path $RunFolder ("{0:D2}-{1}.log" -f $Index, $safeStep)

    Write-Host ("[{0}/{1}] {2}" -f $Index, $Total, $stepName) -ForegroundColor Cyan
    if (-not [string]::IsNullOrWhiteSpace($question)) {
        Write-Host ("  question: {0}" -f $question)
    }
    if ($flow.Count -gt 0) {
        Write-Host ("  flow: {0}" -f (($flow | ForEach-Object { [string]$_ }) -join ' -> '))
    }
    Write-Host ("  dir: {0}" -f $workingDir)
    Write-Host ("  cmd: {0}" -f $command)

    if ($DryRun) {
        return [ordered]@{
            name = $stepName
            required = $required
            status = 'dry-run'
            exit_code = 0
            started_at = (Get-Date).ToString('o')
            ended_at = (Get-Date).ToString('o')
            duration_sec = 0
            question = $question
            flow = @($flow)
            working_dir = $workingDir
            command = $command
            stdout_log = $stdoutPath
            stderr_log = $stderrPath
            combined_log = $combinedPath
            timeout_sec = $timeoutSec
            expected_patterns = @($Step.expected_patterns)
            missing_patterns = @()
            token_metrics = [ordered]@{
                tokens_prompt = $null
                tokens_context = $null
                tokens_response = $null
                tokens_total = $null
                cost_estimated_usd = $null
                source = 'dry-run'
            }
        }
    }

    if (-not (Test-Path $workingDir)) {
        return [ordered]@{
            name = $stepName
            required = $required
            status = 'failed'
            exit_code = -1
            started_at = (Get-Date).ToString('o')
            ended_at = (Get-Date).ToString('o')
            duration_sec = 0
            question = $question
            flow = @($flow)
            working_dir = $workingDir
            command = $command
            stdout_log = $stdoutPath
            stderr_log = $stderrPath
            combined_log = $combinedPath
            timeout_sec = $timeoutSec
            expected_patterns = @($Step.expected_patterns)
            missing_patterns = @("working_dir_not_found")
            message = "Working directory does not exist"
            token_metrics = [ordered]@{
                tokens_prompt = $null
                tokens_context = $null
                tokens_response = $null
                tokens_total = $null
                cost_estimated_usd = $null
                source = 'working-dir-missing'
            }
        }
    }

    $started = Get-Date
    $proc = Start-Process -FilePath 'pwsh' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) -WorkingDirectory $workingDir -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru

    $timedOut = $false
    try {
        $null = $proc.WaitForExit($timeoutSec * 1000)
        if (-not $proc.HasExited) {
            $timedOut = $true
            Stop-Process -Id $proc.Id -Force
        }
    }
    catch {
        if (-not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force
        }
        throw
    }

    $ended = Get-Date
    $durationSec = [math]::Round((($ended - $started).TotalSeconds), 2)

    $stdoutText = if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Raw } else { '' }
    $stderrText = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }

    Set-Content -Path $combinedPath -Value ($stdoutText + [Environment]::NewLine + $stderrText) -Encoding UTF8
    $tokenMetrics = Get-TokenMetricsFromText -Text ($stdoutText + [Environment]::NewLine + $stderrText)

    $exitCode = if ($timedOut) { -2 } else { $proc.ExitCode }
    $status = if ($timedOut) { 'timeout' } elseif ($exitCode -eq 0) { 'ok' } else { 'failed' }

    $expectedPatterns = @($Step.expected_patterns)
    $missingPatterns = @()
    if ($expectedPatterns.Count -gt 0) {
        foreach ($pattern in $expectedPatterns) {
            $found = Select-String -Path $combinedPath -Pattern [string]$pattern -SimpleMatch -Quiet
            if (-not $found) {
                $missingPatterns += [string]$pattern
            }
        }

        if ($missingPatterns.Count -gt 0 -and $status -eq 'ok') {
            $status = 'failed'
        }
    }

    Write-Host ("  status: {0} (exit={1}, {2}s)" -f $status, $exitCode, $durationSec) -ForegroundColor $(if ($status -eq 'ok') { 'Green' } else { 'Red' })

    return [ordered]@{
        name = $stepName
        required = $required
        status = $status
        exit_code = $exitCode
        started_at = $started.ToString('o')
        ended_at = $ended.ToString('o')
        duration_sec = $durationSec
        question = $question
        flow = @($flow)
        working_dir = $workingDir
        command = $command
        stdout_log = $stdoutPath
        stderr_log = $stderrPath
        combined_log = $combinedPath
        timeout_sec = $timeoutSec
        expected_patterns = $expectedPatterns
        missing_patterns = $missingPatterns
        timed_out = $timedOut
        token_metrics = $tokenMetrics
    }
}

function Write-MarkdownReport {
    param(
        [string]$Path,
        [pscustomobject]$Config,
        [array]$Results,
        [datetime]$Started,
        [datetime]$Ended
    )

    $okCount = @($Results | Where-Object { $_.status -eq 'ok' }).Count
    $failedCount = @($Results | Where-Object { $_.status -eq 'failed' -or $_.status -eq 'timeout' }).Count
    $durationSec = [math]::Round((($Ended - $Started).TotalSeconds), 2)

    $lines = @()
    $lines += "# Demo Session Report"
    $lines += ""
    $lines += ("Session: {0}" -f $Config.session_name)
    $lines += ("Started: {0}" -f $Started.ToString('o'))
    $lines += ("Ended: {0}" -f $Ended.ToString('o'))
    $lines += ("Duration (sec): {0}" -f $durationSec)
    $lines += ("Steps OK: {0}" -f $okCount)
    $lines += ("Steps Failed/Timeout: {0}" -f $failedCount)
    $lines += ""
    $lines += "## Step Summary"
    $lines += ""
    $lines += "| # | Step | Status | Exit | Seconds | Required |"
    $lines += "|---|---|---|---:|---:|---|"

    $index = 1
    foreach ($result in $Results) {
        $lines += ("| {0} | {1} | {2} | {3} | {4} | {5} |" -f $index, $result.name, $result.status, $result.exit_code, $result.duration_sec, $result.required)
        $index++
    }

    $lines += ""
    $lines += "## Guion Hablado (listo para demo en directo)"
    $lines += ""

    foreach ($result in $Results) {
        $lines += ("### {0}" -f $result.name)
        if (-not [string]::IsNullOrWhiteSpace([string]$result.question)) {
            $lines += ("- Pregunta: {0}" -f $result.question)
        }
        if (@($result.flow).Count -gt 0) {
            $lines += ("- Flujo: {0}" -f ((@($result.flow) | ForEach-Object { [string]$_ }) -join ' -> '))
        }
        $lines += ("- Voy a hacer: {0}" -f $result.name)
        $lines += ("- Vamos a lanzarlo: {0}" -f $result.command)
        $lines += ("- Se ejecuta en: {0}" -f $result.working_dir)

        if ($result.status -eq 'ok') {
            $lines += "- Ha hecho: ejecucion correcta sin errores operativos."
            $lines += "- Obtenemos este resultado: OK, bloque validado para continuar la historia."
        }
        elseif ($result.status -eq 'timeout') {
            $lines += "- Ha hecho: se alcanzo el tiempo maximo definido para este bloque."
            $lines += "- Obtenemos este resultado: TIMEOUT controlado; usamos logs para explicar causa y mitigacion."
        }
        elseif ($result.status -eq 'dry-run') {
            $lines += "- Ha hecho: simulacion sin ejecucion real de comandos."
            $lines += "- Obtenemos este resultado: checklist validado para correr la demo real."
        }
        else {
            $lines += "- Ha hecho: ejecucion con error controlado."
            $lines += "- Obtenemos este resultado: FAIL con evidencia para comentar el aprendizaje y el plan de accion."
        }

        $lines += ("- Estado tecnico: {0} (exit={1}, {2}s)" -f $result.status, $result.exit_code, $result.duration_sec)

        if ($result.missing_patterns.Count -gt 0) {
            $lines += ("- Patrones esperados no encontrados: {0}" -f (($result.missing_patterns) -join ', '))
        }

        $lines += ("- Log combinado: {0}" -f $result.combined_log)
        $lines += ""
    }

    Set-Content -Path $Path -Value $lines -Encoding UTF8
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$configAbsPath = Resolve-AbsolutePath -Path $ConfigPath -BasePath $repoRoot

if (-not (Test-Path $configAbsPath)) {
    throw "Config file not found: $configAbsPath"
}

$config = Get-Content $configAbsPath -Raw | ConvertFrom-Json -Depth 20
if ($null -eq $config.steps -or @($config.steps).Count -eq 0) {
    throw "Config has no steps: $configAbsPath"
}

$outputRootRaw = if ([string]::IsNullOrWhiteSpace([string]$config.output_root)) {
    '.\projects\TSS2026\analysis_mcpee\demo_runs'
} else {
    [string]$config.output_root
}

$outputRoot = Resolve-AbsolutePath -Path $outputRootRaw -BasePath $repoRoot
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$sessionName = if ([string]::IsNullOrWhiteSpace([string]$config.session_name)) {
    'demo-session'
} else {
    [string]$config.session_name
}

$runFolder = New-RunFolder -OutputRoot $outputRoot -SessionName $sessionName
Write-Host ("Run folder: {0}" -f $runFolder) -ForegroundColor Yellow

$results = @()
$startedAt = Get-Date
$total = @($config.steps).Count

$index = 1
foreach ($step in $config.steps) {
    $questionValue = ''
    if ($step.PSObject.Properties.Name -contains 'question' -and $null -ne $step.question) {
        $questionValue = [string]$step.question
    }

    $flowValue = @()
    if ($step.PSObject.Properties.Name -contains 'flow' -and $null -ne $step.flow) {
        $flowValue = @($step.flow)
    }

    $stepObj = [pscustomobject]@{
        name = [string]$step.name
        question = $questionValue
        flow = $flowValue
        working_dir = Resolve-AbsolutePath -Path ([string]$step.working_dir) -BasePath $repoRoot
        command = [string]$step.command
        timeout_sec = if ($null -ne $step.timeout_sec) { [int]$step.timeout_sec } else { 1800 }
        required = if ($null -ne $step.required) { [bool]$step.required } else { $true }
        expected_patterns = @($step.expected_patterns)
    }

    $result = Invoke-Step -Index $index -Total $total -Step $stepObj -RunFolder $runFolder -DryRun:$DryRun
    $results += [pscustomobject]$result

    $shouldStop = $false
    if ($result.status -ne 'ok' -and $result.required) {
        if ($StopOnError -or ($config.stop_on_error -eq $true)) {
            $shouldStop = $true
        }
    }

    if ($shouldStop) {
        Write-Host "Stopping due to required step failure." -ForegroundColor Red
        break
    }

    $index++
}

$endedAt = Get-Date

$summaryObj = [ordered]@{
    session_name = $sessionName
    config_path = $configAbsPath
    run_folder = $runFolder
    started_at = $startedAt.ToString('o')
    ended_at = $endedAt.ToString('o')
    duration_sec = [math]::Round((($endedAt - $startedAt).TotalSeconds), 2)
    stop_on_error = [bool]($StopOnError -or ($config.stop_on_error -eq $true))
    dry_run = [bool]$DryRun
    steps_total = $total
    steps_executed = @($results).Count
    steps_ok = @($results | Where-Object { $_.status -eq 'ok' }).Count
    steps_failed = @($results | Where-Object { $_.status -eq 'failed' }).Count
    steps_timeout = @($results | Where-Object { $_.status -eq 'timeout' }).Count
    steps_required_failed = @($results | Where-Object { $_.status -eq 'failed' -and $_.required -eq $true }).Count
    steps_required_timeout = @($results | Where-Object { $_.status -eq 'timeout' -and $_.required -eq $true }).Count
    token_metrics = [ordered]@{
        tokens_prompt = [math]::Round((Get-SumOrZero -Values @($results | Where-Object { $null -ne $_.token_metrics -and $null -ne $_.token_metrics.tokens_prompt } | ForEach-Object { [double]$_.token_metrics.tokens_prompt })), 6)
        tokens_context = [math]::Round((Get-SumOrZero -Values @($results | Where-Object { $null -ne $_.token_metrics -and $null -ne $_.token_metrics.tokens_context } | ForEach-Object { [double]$_.token_metrics.tokens_context })), 6)
        tokens_response = [math]::Round((Get-SumOrZero -Values @($results | Where-Object { $null -ne $_.token_metrics -and $null -ne $_.token_metrics.tokens_response } | ForEach-Object { [double]$_.token_metrics.tokens_response })), 6)
        tokens_total = [math]::Round((Get-SumOrZero -Values @($results | Where-Object { $null -ne $_.token_metrics -and $null -ne $_.token_metrics.tokens_total } | ForEach-Object { [double]$_.token_metrics.tokens_total })), 6)
        cost_estimated_usd = [math]::Round((Get-SumOrZero -Values @($results | Where-Object { $null -ne $_.token_metrics -and $null -ne $_.token_metrics.cost_estimated_usd } | ForEach-Object { [double]$_.token_metrics.cost_estimated_usd })), 6)
        source = if ($DryRun) { 'dry-run' } else { 'summary-from-step-logs' }
    }
    results = @($results)
}

$jsonPath = Join-Path $runFolder 'summary.json'
$mdPath = Join-Path $runFolder 'summary.md'

$summaryObj | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8
Write-MarkdownReport -Path $mdPath -Config $config -Results $results -Started $startedAt -Ended $endedAt

Write-Host ''
Write-Host '=== DEMO SESSION SUMMARY ===' -ForegroundColor Cyan
Write-Host ("Session: {0}" -f $sessionName)
Write-Host ("Steps executed: {0}/{1}" -f $summaryObj.steps_executed, $summaryObj.steps_total)
Write-Host ("OK={0}, Failed={1}, Timeout={2}" -f $summaryObj.steps_ok, $summaryObj.steps_failed, $summaryObj.steps_timeout)
Write-Host ("JSON: {0}" -f $jsonPath)
Write-Host ("MD:   {0}" -f $mdPath)

if ($ShowConsoleSummary) {
    Write-Host ''
    Write-Host '=== SPEAKER SUMMARY ===' -ForegroundColor Yellow
    foreach ($result in $results) {
        $line = "- {0}: {1} (exit={2}, {3}s)" -f $result.name, $result.status, $result.exit_code, $result.duration_sec
        Write-Host $line
        if (-not [string]::IsNullOrWhiteSpace([string]$result.question)) {
            Write-Host ("  pregunta: {0}" -f $result.question)
        }
        if (@($result.flow).Count -gt 0) {
            Write-Host ("  flujo: {0}" -f ((@($result.flow) | ForEach-Object { [string]$_ }) -join ' -> '))
        }
    }
    Write-Host ''
    Write-Host 'Summary file content:' -ForegroundColor Yellow
    if (Test-Path $mdPath) {
        Get-Content -Path $mdPath
    }
}

if ($summaryObj.steps_required_failed -gt 0 -or $summaryObj.steps_required_timeout -gt 0) {
    Write-Host ''
    Write-Host '=== FIN EJECUCION: TERMINADO CON INCIDENCIAS ===' -ForegroundColor Red
    Write-Host ('Resultado final (pasos requeridos): FAILED={0}, TIMEOUT={1}. Revisa summary.md y logs.' -f $summaryObj.steps_required_failed, $summaryObj.steps_required_timeout)
    exit 1
}

Write-Host ''
Write-Host '=== FIN EJECUCION: TERMINADO OK ===' -ForegroundColor Green
Write-Host 'Resultado final: todos los pasos completados correctamente.'
exit 0
