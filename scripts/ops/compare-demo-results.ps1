param(
    [string]$RunsRoot = ".\projects\TSS2026\analysis_mcpee\demo_runs",
    [string]$OutputPath,
    [string]$QualityPath = ".\projects\TSS2026\analysis_mcpee\demo-quality-rubric.json",
    [string]$TokenMetricsPath = ".\projects\TSS2026\analysis_mcpee\demo-token-metrics.json",
    [string]$McpSimMetricsPath = ".\projects\TSS2026\analysis_mcpee\demo-mcp-sim-metrics.json",
    [switch]$ShowConsole = $true
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

function Get-LatestSummaryBySuffix {
    param(
        [string]$Root,
        [string]$Suffix
    )

    $dirs = @(Get-ChildItem -Path $Root -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*-$Suffix" } |
        Sort-Object LastWriteTime -Descending)

    if (-not $dirs -or $dirs.Count -eq 0) {
        return $null
    }

    $summaryPath = Join-Path $dirs[0].FullName 'summary.json'
    if (-not (Test-Path $summaryPath)) {
        return $null
    }

    return [pscustomobject]@{
        Name = $dirs[0].Name
        Path = $summaryPath
        Data = (Get-Content -Path $summaryPath -Raw | ConvertFrom-Json -Depth 20)
    }
}

function Get-QualityMap {
    param(
        [string]$Path,
        [string]$BasePath
    )

    $qualityAbs = Resolve-AbsolutePath -Path $Path -BasePath $BasePath
    if (-not (Test-Path $qualityAbs)) {
        return @{}
    }

    $raw = Get-Content -Path $qualityAbs -Raw | ConvertFrom-Json -Depth 10
    if ($null -eq $raw -or $null -eq $raw.rows) {
        return @{}
    }

    $map = @{}
    foreach ($row in @($raw.rows)) {
        $name = [string]$row.arquitectura
        if ([string]::IsNullOrWhiteSpace($name)) {
            continue
        }

        $score = $null
        if ($null -ne $row.calidad_1_5) {
            $score = [double]$row.calidad_1_5
        }

        $map[$name] = [pscustomobject]@{
            calidad_1_5 = $score
            nota = [string]$row.nota
        }
    }

    return $map
}

function Get-TokenMetricsData {
    param(
        [string]$Path,
        [string]$BasePath
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return [pscustomobject]@{
            source_path = ''
            source_name = 'disabled'
            architecture_map = @{}
            rag_map = @{}
        }
    }

    $tokenAbs = Resolve-AbsolutePath -Path $Path -BasePath $BasePath
    if (-not (Test-Path $tokenAbs)) {
        return [pscustomobject]@{
            source_path = $tokenAbs
            source_name = 'missing'
            architecture_map = @{}
            rag_map = @{}
        }
    }

    $raw = Get-Content -Path $tokenAbs -Raw | ConvertFrom-Json -Depth 10
    $archMap = @{}
    $ragMap = @{}

    foreach ($row in @($raw.rows)) {
        $name = [string]$row.arquitectura
        if ([string]::IsNullOrWhiteSpace($name)) {
            continue
        }

        $archMap[$name] = [pscustomobject]@{
            tokens_prompt = if ($null -ne $row.tokens_prompt) { [double]$row.tokens_prompt } else { $null }
            tokens_context = if ($null -ne $row.tokens_context) { [double]$row.tokens_context } else { $null }
            tokens_response = if ($null -ne $row.tokens_response) { [double]$row.tokens_response } else { $null }
            tokens_total = if ($null -ne $row.tokens_total) { [double]$row.tokens_total } else { $null }
            cost_estimated_usd = if ($null -ne $row.cost_estimated_usd) { [double]$row.cost_estimated_usd } else { $null }
        }
    }

    foreach ($row in @($raw.rag_rows)) {
        $name = [string]$row.bloque
        if ([string]::IsNullOrWhiteSpace($name)) {
            continue
        }

        $ragMap[$name] = [pscustomobject]@{
            tokens_total = if ($null -ne $row.tokens_total) { [double]$row.tokens_total } else { $null }
            cost_estimated_usd = if ($null -ne $row.cost_estimated_usd) { [double]$row.cost_estimated_usd } else { $null }
        }
    }

    return [pscustomobject]@{
        source_path = $tokenAbs
        source_name = if (-not [string]::IsNullOrWhiteSpace([string]$raw.source_name)) { [string]$raw.source_name } else { 'unspecified' }
        architecture_map = $archMap
        rag_map = $ragMap
    }
}

function Get-McpSimMetricsData {
    param(
        [string]$Path,
        [string]$BasePath
    )

    $mcpAbs = Resolve-AbsolutePath -Path $Path -BasePath $BasePath
    if (-not (Test-Path $mcpAbs)) {
        return [pscustomobject]@{
            source_path = $mcpAbs
            source_name = 'missing'
            architecture_map = @{}
            rag_map = @{}
        }
    }

    $raw = Get-Content -Path $mcpAbs -Raw | ConvertFrom-Json -Depth 10
    $archMap = @{}
    $ragMap = @{}

    foreach ($row in @($raw.rows)) {
        $name = [string]$row.arquitectura
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $archMap[$name] = [pscustomobject]@{
            mcp_tokens_sim = if ($null -ne $row.mcp_tokens_sim) { [double]$row.mcp_tokens_sim } else { $null }
        }
    }

    foreach ($row in @($raw.rag_rows)) {
        $name = [string]$row.bloque
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $ragMap[$name] = [pscustomobject]@{
            mcp_tokens_sim = if ($null -ne $row.mcp_tokens_sim) { [double]$row.mcp_tokens_sim } else { $null }
        }
    }

    return [pscustomobject]@{
        source_path = $mcpAbs
        source_name = if (-not [string]::IsNullOrWhiteSpace([string]$raw.source_name)) { [string]$raw.source_name } else { 'unspecified' }
        architecture_map = $archMap
        rag_map = $ragMap
    }
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
    if ($null -eq $total) {
        $total = Get-PatternSum -Text $Text -Pattern '(?:Tokens)\s*:\s*([0-9]+(?:[\.,][0-9]+)?)'
    }
    $cost = Get-PatternSum -Text $Text -Pattern '(?:total_cost_usd|cost_estimated_usd|cost_usd|total_cost)\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)'

    return [pscustomobject]@{
        tokens_prompt = $prompt
        tokens_context = $context
        tokens_response = $response
        tokens_total = $total
        cost_estimated_usd = $cost
    }
}

function Merge-TokenMetrics {
    param(
        [pscustomobject]$Accumulator,
        [pscustomobject]$Current
    )

    if ($null -eq $Accumulator) {
        $Accumulator = [pscustomobject]@{
            tokens_prompt = $null
            tokens_context = $null
            tokens_response = $null
            tokens_total = $null
            cost_estimated_usd = $null
        }
    }

    foreach ($field in @('tokens_prompt', 'tokens_context', 'tokens_response', 'tokens_total', 'cost_estimated_usd')) {
        $value = $Current.$field
        if ($null -ne $value) {
            if ($null -eq $Accumulator.$field) {
                $Accumulator.$field = [double]$value
            }
            else {
                $Accumulator.$field = [double]$Accumulator.$field + [double]$value
            }
        }
    }

    return $Accumulator
}

function Get-TokenMetricsFromResultsLogs {
    param([object]$DemoData)

    $acc = $null
    foreach ($item in @($DemoData.results)) {
        $logPath = [string]$item.combined_log
        if ([string]::IsNullOrWhiteSpace($logPath) -or -not (Test-Path $logPath)) {
            continue
        }

        $text = Get-Content -Path $logPath -Raw
        $metrics = Get-TokenMetricsFromText -Text $text
        $acc = Merge-TokenMetrics -Accumulator $acc -Current $metrics
    }

    return $acc
}

function Find-RepoRootFromWorkingDir {
    param([string]$WorkingDir)

    if ([string]::IsNullOrWhiteSpace($WorkingDir) -or -not (Test-Path $WorkingDir)) {
        return $null
    }

    $current = [System.IO.Path]::GetFullPath($WorkingDir)
    while ($true) {
        if (Test-Path (Join-Path $current '.git')) {
            return $current
        }

        $parent = Split-Path -Path $current -Parent
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) {
            break
        }
        $current = $parent
    }

    return $null
}

function Get-RepoTelemetryFromDemo {
    param([object]$DemoData)

    $results = @($DemoData.results)
    if ($results.Count -eq 0) {
        return $null
    }

    $workingDir = [string]$results[0].working_dir
    $repoRoot = Find-RepoRootFromWorkingDir -WorkingDir $workingDir
    if ($null -eq $repoRoot) {
        return $null
    }

    $reportPath = Join-Path $repoRoot 'observability\evals\iteration-value-report.json'
    if (-not (Test-Path $reportPath)) {
        return $null
    }

    $raw = Get-Content -Path $reportPath -Raw | ConvertFrom-Json -Depth 10

    $kpis = $null
    if ($raw.PSObject.Properties.Name -contains 'kpis' -and $null -ne $raw.kpis) {
        $kpis = $raw.kpis
    }

    $totalTokens = $null
    if ($null -ne $kpis -and $kpis.PSObject.Properties.Name -contains 'total_tokens' -and $null -ne $kpis.total_tokens) {
        $totalTokens = [double]$kpis.total_tokens
    }
    elseif ($raw.PSObject.Properties.Name -contains 'total_tokens' -and $null -ne $raw.total_tokens) {
        $totalTokens = [double]$raw.total_tokens
    }

    $totalCost = $null
    if ($null -ne $kpis -and $kpis.PSObject.Properties.Name -contains 'total_cost_usd' -and $null -ne $kpis.total_cost_usd) {
        $totalCost = [double]$kpis.total_cost_usd
    }
    elseif ($raw.PSObject.Properties.Name -contains 'total_cost_usd' -and $null -ne $raw.total_cost_usd) {
        $totalCost = [double]$raw.total_cost_usd
    }

    return [pscustomobject]@{
        tokens_prompt = $null
        tokens_context = $null
        tokens_response = $null
        tokens_total = $totalTokens
        cost_estimated_usd = $totalCost
    }
}

function Resolve-ArchitectureTokenMetrics {
    param(
        [string]$Architecture,
        [object]$DemoData,
        [pscustomobject]$TokenData
    )

    if ($DemoData.PSObject.Properties.Name -contains 'token_metrics' -and $null -ne $DemoData.token_metrics) {
        $tm = $DemoData.token_metrics
        if ($null -ne $tm.tokens_total -or $null -ne $tm.total_tokens -or $null -ne $tm.cost_estimated_usd -or $null -ne $tm.total_cost_usd) {
            $summaryMetrics = [pscustomobject]@{
                tokens_prompt = if ($null -ne $tm.tokens_prompt) { [double]$tm.tokens_prompt } else { $null }
                tokens_context = if ($null -ne $tm.tokens_context) { [double]$tm.tokens_context } else { $null }
                tokens_response = if ($null -ne $tm.tokens_response) { [double]$tm.tokens_response } else { $null }
                tokens_total = if ($null -ne $tm.tokens_total) { [double]$tm.tokens_total } elseif ($null -ne $tm.total_tokens) { [double]$tm.total_tokens } else { $null }
                cost_estimated_usd = if ($null -ne $tm.cost_estimated_usd) { [double]$tm.cost_estimated_usd } elseif ($null -ne $tm.total_cost_usd) { [double]$tm.total_cost_usd } else { $null }
            }

            $summaryHasValue = ($null -ne $summaryMetrics.tokens_total -and [double]$summaryMetrics.tokens_total -gt 0) -or
                ($null -ne $summaryMetrics.cost_estimated_usd -and [double]$summaryMetrics.cost_estimated_usd -gt 0) -or
                ($null -ne $summaryMetrics.tokens_prompt -and [double]$summaryMetrics.tokens_prompt -gt 0) -or
                ($null -ne $summaryMetrics.tokens_context -and [double]$summaryMetrics.tokens_context -gt 0) -or
                ($null -ne $summaryMetrics.tokens_response -and [double]$summaryMetrics.tokens_response -gt 0)

            if ($summaryHasValue) {
                return [pscustomobject]@{
                    tokens_prompt = $summaryMetrics.tokens_prompt
                    tokens_context = $summaryMetrics.tokens_context
                    tokens_response = $summaryMetrics.tokens_response
                    tokens_total = $summaryMetrics.tokens_total
                    cost_estimated_usd = $summaryMetrics.cost_estimated_usd
                    source = 'summary'
                }
            }
        }
    }

    $fromLogs = Get-TokenMetricsFromResultsLogs -DemoData $DemoData
    $logsHaveValue = ($null -ne $fromLogs) -and (
        ($null -ne $fromLogs.tokens_total -and [double]$fromLogs.tokens_total -gt 0) -or
        ($null -ne $fromLogs.cost_estimated_usd -and [double]$fromLogs.cost_estimated_usd -gt 0) -or
        ($null -ne $fromLogs.tokens_prompt -and [double]$fromLogs.tokens_prompt -gt 0) -or
        ($null -ne $fromLogs.tokens_context -and [double]$fromLogs.tokens_context -gt 0) -or
        ($null -ne $fromLogs.tokens_response -and [double]$fromLogs.tokens_response -gt 0)
    )
    if ($logsHaveValue) {
        return [pscustomobject]@{
            tokens_prompt = $fromLogs.tokens_prompt
            tokens_context = $fromLogs.tokens_context
            tokens_response = $fromLogs.tokens_response
            tokens_total = $fromLogs.tokens_total
            cost_estimated_usd = $fromLogs.cost_estimated_usd
            source = 'logs'
        }
    }

    $fromRepo = Get-RepoTelemetryFromDemo -DemoData $DemoData
    $repoHasValue = ($null -ne $fromRepo) -and (
        ($null -ne $fromRepo.tokens_total -and [double]$fromRepo.tokens_total -gt 0) -or
        ($null -ne $fromRepo.cost_estimated_usd -and [double]$fromRepo.cost_estimated_usd -gt 0)
    )
    if ($repoHasValue) {
        return [pscustomobject]@{
            tokens_prompt = $fromRepo.tokens_prompt
            tokens_context = $fromRepo.tokens_context
            tokens_response = $fromRepo.tokens_response
            tokens_total = $fromRepo.tokens_total
            cost_estimated_usd = $fromRepo.cost_estimated_usd
            source = 'repo-observability'
        }
    }

    if ($TokenData.architecture_map.ContainsKey($Architecture)) {
        $m = $TokenData.architecture_map[$Architecture]
        return [pscustomobject]@{
            tokens_prompt = $m.tokens_prompt
            tokens_context = $m.tokens_context
            tokens_response = $m.tokens_response
            tokens_total = $m.tokens_total
            cost_estimated_usd = $m.cost_estimated_usd
            source = 'manual-fallback'
        }
    }

    return [pscustomobject]@{
        tokens_prompt = $null
        tokens_context = $null
        tokens_response = $null
        tokens_total = $null
        cost_estimated_usd = $null
        source = 'none'
    }
}

function Resolve-RagTokenMetrics {
    param(
        [object]$Step,
        [pscustomobject]$TokenData
    )

    $logPath = [string]$Step.combined_log
    if (-not [string]::IsNullOrWhiteSpace($logPath) -and (Test-Path $logPath)) {
        $text = Get-Content -Path $logPath -Raw
        $metrics = Get-TokenMetricsFromText -Text $text
        $ragLogsHaveValue = ($null -ne $metrics.tokens_total -and [double]$metrics.tokens_total -gt 0) -or
            ($null -ne $metrics.cost_estimated_usd -and [double]$metrics.cost_estimated_usd -gt 0)
        if ($ragLogsHaveValue) {
            return [pscustomobject]@{
                tokens_total = $metrics.tokens_total
                cost_estimated_usd = $metrics.cost_estimated_usd
                source = 'logs'
            }
        }
    }

    $name = [string]$Step.name
    if ($TokenData.rag_map.ContainsKey($name)) {
        $m = $TokenData.rag_map[$name]
        return [pscustomobject]@{
            tokens_total = $m.tokens_total
            cost_estimated_usd = $m.cost_estimated_usd
            source = 'manual-fallback'
        }
    }

    return [pscustomobject]@{
        tokens_total = $null
        cost_estimated_usd = $null
        source = 'none'
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runsAbsRoot = Resolve-AbsolutePath -Path $RunsRoot -BasePath $repoRoot
$qualityMap = Get-QualityMap -Path $QualityPath -BasePath $repoRoot
$tokenData = Get-TokenMetricsData -Path $TokenMetricsPath -BasePath $repoRoot
$mcpSimData = Get-McpSimMetricsData -Path $McpSimMetricsPath -BasePath $repoRoot

if (-not (Test-Path $runsAbsRoot)) {
    throw "Runs folder not found: $runsAbsRoot"
}

$demo1 = Get-LatestSummaryBySuffix -Root $runsAbsRoot -Suffix 'demo1'
$demo2 = Get-LatestSummaryBySuffix -Root $runsAbsRoot -Suffix 'demo2'
$demo3 = Get-LatestSummaryBySuffix -Root $runsAbsRoot -Suffix 'demo3'
$demo4 = Get-LatestSummaryBySuffix -Root $runsAbsRoot -Suffix 'demo4'

if ($null -eq $demo1 -or $null -eq $demo2 -or $null -eq $demo3 -or $null -eq $demo4) {
    throw 'Missing one or more demo summaries (demo1/demo2/demo3/demo4). Run demos first.'
}

$resolvedD1Tokens = Resolve-ArchitectureTokenMetrics -Architecture 'D1 Baseline' -DemoData $demo1.Data -TokenData $tokenData
$resolvedD2Tokens = Resolve-ArchitectureTokenMetrics -Architecture 'D2 Agentes' -DemoData $demo2.Data -TokenData $tokenData
$resolvedD3Tokens = Resolve-ArchitectureTokenMetrics -Architecture 'D3 RAG Local+Azure' -DemoData $demo3.Data -TokenData $tokenData
$resolvedD4Tokens = Resolve-ArchitectureTokenMetrics -Architecture 'D4 Master Orquestador' -DemoData $demo4.Data -TokenData $tokenData

function Get-FirstResultQuestion {
    param([object]$DemoData)
    $results = @($DemoData.results)
    if ($results.Count -eq 0) { return '' }
    return [string]$results[0].question
}

function Get-FirstResultFlow {
    param([object]$DemoData)
    $results = @($DemoData.results)
    if ($results.Count -eq 0) { return '' }
    return ((@($results[0].flow) | ForEach-Object { [string]$_ }) -join ' -> ')
}

$rows = @(
    [pscustomobject]@{
        arquitectura = 'D1 Baseline'
        repo = 'TSS2026'
        session = [string]$demo1.Data.session_name
        pregunta = Get-FirstResultQuestion -DemoData $demo1.Data
        flujo = Get-FirstResultFlow -DemoData $demo1.Data
        duration_sec = [double]$demo1.Data.duration_sec
        steps_ok = [int]$demo1.Data.steps_ok
        steps_failed = [int]$demo1.Data.steps_failed
        steps_timeout = [int]$demo1.Data.steps_timeout
        calidad_1_5 = if ($qualityMap.ContainsKey('D1 Baseline')) { $qualityMap['D1 Baseline'].calidad_1_5 } else { $null }
        nota_calidad = if ($qualityMap.ContainsKey('D1 Baseline')) { $qualityMap['D1 Baseline'].nota } else { '' }
        tokens_prompt = $resolvedD1Tokens.tokens_prompt
        tokens_context = $resolvedD1Tokens.tokens_context
        tokens_response = $resolvedD1Tokens.tokens_response
        tokens_total = $resolvedD1Tokens.tokens_total
        cost_estimated_usd = $resolvedD1Tokens.cost_estimated_usd
        token_source = $resolvedD1Tokens.source
        mcp_tokens_sim = if ($mcpSimData.architecture_map.ContainsKey('D1 Baseline')) { $mcpSimData.architecture_map['D1 Baseline'].mcp_tokens_sim } else { $null }
        run_folder = [string]$demo1.Data.run_folder
        summary_json = $demo1.Path
    },
    [pscustomobject]@{
        arquitectura = 'D2 Agentes'
        repo = 'TSS2026_agentes'
        session = [string]$demo2.Data.session_name
        pregunta = Get-FirstResultQuestion -DemoData $demo2.Data
        flujo = Get-FirstResultFlow -DemoData $demo2.Data
        duration_sec = [double]$demo2.Data.duration_sec
        steps_ok = [int]$demo2.Data.steps_ok
        steps_failed = [int]$demo2.Data.steps_failed
        steps_timeout = [int]$demo2.Data.steps_timeout
        calidad_1_5 = if ($qualityMap.ContainsKey('D2 Agentes')) { $qualityMap['D2 Agentes'].calidad_1_5 } else { $null }
        nota_calidad = if ($qualityMap.ContainsKey('D2 Agentes')) { $qualityMap['D2 Agentes'].nota } else { '' }
        tokens_prompt = $resolvedD2Tokens.tokens_prompt
        tokens_context = $resolvedD2Tokens.tokens_context
        tokens_response = $resolvedD2Tokens.tokens_response
        tokens_total = $resolvedD2Tokens.tokens_total
        cost_estimated_usd = $resolvedD2Tokens.cost_estimated_usd
        token_source = $resolvedD2Tokens.source
        mcp_tokens_sim = if ($mcpSimData.architecture_map.ContainsKey('D2 Agentes')) { $mcpSimData.architecture_map['D2 Agentes'].mcp_tokens_sim } else { $null }
        run_folder = [string]$demo2.Data.run_folder
        summary_json = $demo2.Path
    },
    [pscustomobject]@{
        arquitectura = 'D3 RAG Local+Azure'
        repo = 'TSS2026_RAG'
        session = [string]$demo3.Data.session_name
        pregunta = Get-FirstResultQuestion -DemoData $demo3.Data
        flujo = Get-FirstResultFlow -DemoData $demo3.Data
        duration_sec = [double]$demo3.Data.duration_sec
        steps_ok = [int]$demo3.Data.steps_ok
        steps_failed = [int]$demo3.Data.steps_failed
        steps_timeout = [int]$demo3.Data.steps_timeout
        calidad_1_5 = if ($qualityMap.ContainsKey('D3 RAG Local+Azure')) { $qualityMap['D3 RAG Local+Azure'].calidad_1_5 } else { $null }
        nota_calidad = if ($qualityMap.ContainsKey('D3 RAG Local+Azure')) { $qualityMap['D3 RAG Local+Azure'].nota } else { '' }
        tokens_prompt = $resolvedD3Tokens.tokens_prompt
        tokens_context = $resolvedD3Tokens.tokens_context
        tokens_response = $resolvedD3Tokens.tokens_response
        tokens_total = $resolvedD3Tokens.tokens_total
        cost_estimated_usd = $resolvedD3Tokens.cost_estimated_usd
        token_source = $resolvedD3Tokens.source
        mcp_tokens_sim = if ($mcpSimData.architecture_map.ContainsKey('D3 RAG Local+Azure')) { $mcpSimData.architecture_map['D3 RAG Local+Azure'].mcp_tokens_sim } else { $null }
        run_folder = [string]$demo3.Data.run_folder
        summary_json = $demo3.Path
    },
    [pscustomobject]@{
        arquitectura = 'D4 Master Orquestador'
        repo = 'mcp-efficiency-engine'
        session = [string]$demo4.Data.session_name
        pregunta = Get-FirstResultQuestion -DemoData $demo4.Data
        flujo = Get-FirstResultFlow -DemoData $demo4.Data
        duration_sec = [double]$demo4.Data.duration_sec
        steps_ok = [int]$demo4.Data.steps_ok
        steps_failed = [int]$demo4.Data.steps_failed
        steps_timeout = [int]$demo4.Data.steps_timeout
        calidad_1_5 = if ($qualityMap.ContainsKey('D4 Master Orquestador')) { $qualityMap['D4 Master Orquestador'].calidad_1_5 } else { $null }
        nota_calidad = if ($qualityMap.ContainsKey('D4 Master Orquestador')) { $qualityMap['D4 Master Orquestador'].nota } else { '' }
        tokens_prompt = $resolvedD4Tokens.tokens_prompt
        tokens_context = $resolvedD4Tokens.tokens_context
        tokens_response = $resolvedD4Tokens.tokens_response
        tokens_total = $resolvedD4Tokens.tokens_total
        cost_estimated_usd = $resolvedD4Tokens.cost_estimated_usd
        token_source = $resolvedD4Tokens.source
        mcp_tokens_sim = if ($mcpSimData.architecture_map.ContainsKey('D4 Master Orquestador')) { $mcpSimData.architecture_map['D4 Master Orquestador'].mcp_tokens_sim } else { $null }
        run_folder = [string]$demo4.Data.run_folder
        summary_json = $demo4.Path
    }
)

$ragSubRows = @()
foreach ($item in @($demo3.Data.results)) {
    $ragToken = Resolve-RagTokenMetrics -Step $item -TokenData $tokenData
    $ragSubRows += [pscustomobject]@{
        bloque = [string]$item.name
        pregunta = [string]$item.question
        flujo = ((@($item.flow) | ForEach-Object { [string]$_ }) -join ' -> ')
        duration_sec = [double]$item.duration_sec
        status = [string]$item.status
        exit_code = [int]$item.exit_code
        tokens_total = $ragToken.tokens_total
        cost_estimated_usd = $ragToken.cost_estimated_usd
        token_source = $ragToken.source
        mcp_tokens_sim = if ($mcpSimData.rag_map.ContainsKey([string]$item.name)) { $mcpSimData.rag_map[[string]$item.name].mcp_tokens_sim } else { $null }
    }
}

$best = $rows | Sort-Object duration_sec | Select-Object -First 1
$worst = $rows | Sort-Object duration_sec -Descending | Select-Object -First 1
$delta = [math]::Round(($worst.duration_sec - $best.duration_sec), 2)
$qualityRows = @($rows | Where-Object { $null -ne $_.calidad_1_5 })
$bestQuality = if ($qualityRows.Count -gt 0) { $qualityRows | Sort-Object calidad_1_5 -Descending | Select-Object -First 1 } else { $null }
$tokenRows = @($rows | Where-Object { $null -ne $_.tokens_total })
$bestToken = if ($tokenRows.Count -gt 0) { $tokenRows | Sort-Object tokens_total | Select-Object -First 1 } else { $null }
$worstToken = if ($tokenRows.Count -gt 0) { $tokenRows | Sort-Object tokens_total -Descending | Select-Object -First 1 } else { $null }
$tokenDelta = if ($null -ne $bestToken -and $null -ne $worstToken) { [math]::Round(($worstToken.tokens_total - $bestToken.tokens_total), 2) } else { $null }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $outputDir = Join-Path $runsAbsRoot ("$stamp-comparativa-arquitecturas")
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    $outputMd = Join-Path $outputDir 'comparison.md'
    $outputJson = Join-Path $outputDir 'comparison.json'
}
else {
    $outputMdAbs = Resolve-AbsolutePath -Path $OutputPath -BasePath $repoRoot
    $outputDir = Split-Path -Path $outputMdAbs -Parent
    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    }
    $outputMd = $outputMdAbs
    $outputJson = [System.IO.Path]::ChangeExtension($outputMdAbs, '.json')
}

$comparison = [ordered]@{
    generated_at = (Get-Date).ToString('o')
    runs_root = $runsAbsRoot
    quality_source = Resolve-AbsolutePath -Path $QualityPath -BasePath $repoRoot
    token_metrics_source = $tokenData.source_path
    token_metrics_source_name = $tokenData.source_name
    mcp_sim_source = $mcpSimData.source_path
    mcp_sim_source_name = $mcpSimData.source_name
    best_architecture = $best.arquitectura
    best_duration_sec = $best.duration_sec
    worst_architecture = $worst.arquitectura
    worst_duration_sec = $worst.duration_sec
    duration_delta_sec = $delta
    best_token_architecture = if ($null -ne $bestToken) { $bestToken.arquitectura } else { $null }
    best_token_total = if ($null -ne $bestToken) { $bestToken.tokens_total } else { $null }
    worst_token_architecture = if ($null -ne $worstToken) { $worstToken.arquitectura } else { $null }
    worst_token_total = if ($null -ne $worstToken) { $worstToken.tokens_total } else { $null }
    token_delta = $tokenDelta
    best_quality_architecture = if ($null -ne $bestQuality) { $bestQuality.arquitectura } else { $null }
    best_quality_score = if ($null -ne $bestQuality) { $bestQuality.calidad_1_5 } else { $null }
    rows = $rows
    rag_subrows = $ragSubRows
}

$comparison | ConvertTo-Json -Depth 10 | Set-Content -Path $outputJson -Encoding UTF8

$lines = @()
$lines += '# Comparativa Arquitecturas (Demo Session)'
$lines += ''
$lines += ('Generado: {0}' -f $comparison.generated_at)
$lines += ('Fuente tokens/coste fallback: {0} ({1})' -f $comparison.token_metrics_source_name, $comparison.token_metrics_source)
$lines += ('Fuente MCP simulado: {0} ({1})' -f $comparison.mcp_sim_source_name, $comparison.mcp_sim_source)
$lines += ''
$lines += '| Arquitectura | Repo | Pregunta | Flujo | Duracion (s) | Tokens total | Coste est. (USD) | Fuente tokens | MCP sim (tokens) | Calidad (1-5) | OK | Failed | Timeout | Session |'
$lines += '|---|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---|'
foreach ($row in $rows) {
    $qualityText = if ($null -ne $row.calidad_1_5) { [string]$row.calidad_1_5 } else { 'n/a' }
    $tokensText = if ($null -ne $row.tokens_total) { [string]$row.tokens_total } else { 'n/a' }
    $costText = if ($null -ne $row.cost_estimated_usd) { [string]$row.cost_estimated_usd } else { 'n/a' }
    $tokenSourceText = if (-not [string]::IsNullOrWhiteSpace([string]$row.token_source)) { [string]$row.token_source } else { 'none' }
    $mcpSimText = if ($null -ne $row.mcp_tokens_sim) { [string]$row.mcp_tokens_sim } else { 'n/a' }
    $lines += ('| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8} | {9} | {10} | {11} | {12} | {13} |' -f $row.arquitectura, $row.repo, $row.pregunta, $row.flujo, $row.duration_sec, $tokensText, $costText, $tokenSourceText, $mcpSimText, $qualityText, $row.steps_ok, $row.steps_failed, $row.steps_timeout, $row.session)
}
$lines += ''
$lines += '## Subcomparativa RAG (Local vs Azure)'
$lines += ''
$lines += '| Bloque RAG | Pregunta | Flujo | Duracion (s) | Tokens total | Coste est. (USD) | Fuente tokens | MCP sim (tokens) | Estado | Exit |'
$lines += '|---|---|---|---:|---:|---:|---|---:|---|---:|'
foreach ($row in $ragSubRows) {
    $tokensText = if ($null -ne $row.tokens_total) { [string]$row.tokens_total } else { 'n/a' }
    $costText = if ($null -ne $row.cost_estimated_usd) { [string]$row.cost_estimated_usd } else { 'n/a' }
    $tokenSourceText = if (-not [string]::IsNullOrWhiteSpace([string]$row.token_source)) { [string]$row.token_source } else { 'none' }
    $mcpSimText = if ($null -ne $row.mcp_tokens_sim) { [string]$row.mcp_tokens_sim } else { 'n/a' }
    $lines += ('| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8} | {9} |' -f $row.bloque, $row.pregunta, $row.flujo, $row.duration_sec, $tokensText, $costText, $tokenSourceText, $mcpSimText, $row.status, $row.exit_code)
}
$lines += ''
$lines += '## Lectura Ejecutiva'
$lines += ''
$lines += ('- Mejor tiempo: {0} ({1}s)' -f $comparison.best_architecture, $comparison.best_duration_sec)
$lines += ('- Peor tiempo: {0} ({1}s)' -f $comparison.worst_architecture, $comparison.worst_duration_sec)
$lines += ('- Delta entre mejor y peor: {0}s' -f $comparison.duration_delta_sec)
if ($null -ne $comparison.best_token_architecture) {
    $lines += ('- Menor gasto tokens: {0} ({1})' -f $comparison.best_token_architecture, $comparison.best_token_total)
    $lines += ('- Mayor gasto tokens: {0} ({1})' -f $comparison.worst_token_architecture, $comparison.worst_token_total)
    $lines += ('- Delta tokens entre mejor y peor: {0}' -f $comparison.token_delta)
}
if ($null -ne $comparison.best_quality_architecture) {
    $lines += ('- Mejor calidad: {0} ({1}/5)' -f $comparison.best_quality_architecture, $comparison.best_quality_score)
}
$lines += ''
$lines += '## Evidencias'
$lines += ''
foreach ($row in $rows) {
    $lines += ('- {0}: {1}' -f $row.arquitectura, $row.summary_json)
    if (-not [string]::IsNullOrWhiteSpace($row.nota_calidad)) {
        $lines += ('  Nota calidad: {0}' -f $row.nota_calidad)
    }
}

Set-Content -Path $outputMd -Value $lines -Encoding UTF8

if ($ShowConsole) {
    Write-Host ''
    Write-Host '=== COMPARATIVA ARQUITECTURAS ===' -ForegroundColor Cyan
    foreach ($row in $rows) {
        $qualityText = if ($null -ne $row.calidad_1_5) { [string]$row.calidad_1_5 } else { 'n/a' }
        $tokensText = if ($null -ne $row.tokens_total) { [string]$row.tokens_total } else { 'n/a' }
        $costText = if ($null -ne $row.cost_estimated_usd) { [string]$row.cost_estimated_usd } else { 'n/a' }
        $tokenSourceText = if (-not [string]::IsNullOrWhiteSpace([string]$row.token_source)) { [string]$row.token_source } else { 'none' }
        $mcpSimText = if ($null -ne $row.mcp_tokens_sim) { [string]$row.mcp_tokens_sim } else { 'n/a' }
        Write-Host ('- {0} [{1}]: {2}s | Tokens={3} | CosteUSD={4} | FuenteTokens={5} | MCPsim={6} | Calidad={7}/5 | OK={8} Failed={9} Timeout={10}' -f $row.arquitectura, $row.repo, $row.duration_sec, $tokensText, $costText, $tokenSourceText, $mcpSimText, $qualityText, $row.steps_ok, $row.steps_failed, $row.steps_timeout)
        if (-not [string]::IsNullOrWhiteSpace([string]$row.pregunta)) {
            Write-Host ('  pregunta: {0}' -f $row.pregunta)
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$row.flujo)) {
            Write-Host ('  flujo: {0}' -f $row.flujo)
        }
    }

    if ($ragSubRows.Count -gt 0) {
        Write-Host ''
        Write-Host '--- Subcomparativa RAG (Local vs Azure) ---' -ForegroundColor Cyan
        foreach ($row in $ragSubRows) {
            $tokensText = if ($null -ne $row.tokens_total) { [string]$row.tokens_total } else { 'n/a' }
            $costText = if ($null -ne $row.cost_estimated_usd) { [string]$row.cost_estimated_usd } else { 'n/a' }
            $tokenSourceText = if (-not [string]::IsNullOrWhiteSpace([string]$row.token_source)) { [string]$row.token_source } else { 'none' }
            $mcpSimText = if ($null -ne $row.mcp_tokens_sim) { [string]$row.mcp_tokens_sim } else { 'n/a' }
            Write-Host ('- {0}: {1}s | tokens={2} | costeUSD={3} | fuenteTokens={4} | mcpSim={5} | status={6} exit={7}' -f $row.bloque, $row.duration_sec, $tokensText, $costText, $tokenSourceText, $mcpSimText, $row.status, $row.exit_code)
            if (-not [string]::IsNullOrWhiteSpace([string]$row.pregunta)) {
                Write-Host ('  pregunta: {0}' -f $row.pregunta)
            }
            if (-not [string]::IsNullOrWhiteSpace([string]$row.flujo)) {
                Write-Host ('  flujo: {0}' -f $row.flujo)
            }
        }
    }
    Write-Host ('- Mejor: {0} ({1}s)' -f $comparison.best_architecture, $comparison.best_duration_sec) -ForegroundColor Green
    Write-Host ('- Peor:  {0} ({1}s)' -f $comparison.worst_architecture, $comparison.worst_duration_sec) -ForegroundColor Yellow
    Write-Host ('- Delta: {0}s' -f $comparison.duration_delta_sec)
    if ($null -ne $comparison.best_token_architecture) {
        Write-Host ('- Menor tokens: {0} ({1})' -f $comparison.best_token_architecture, $comparison.best_token_total) -ForegroundColor Green
        Write-Host ('- Mayor tokens: {0} ({1})' -f $comparison.worst_token_architecture, $comparison.worst_token_total) -ForegroundColor Yellow
        Write-Host ('- Delta tokens: {0}' -f $comparison.token_delta)
    }
    if ($null -ne $comparison.best_quality_architecture) {
        Write-Host ('- Mejor calidad: {0} ({1}/5)' -f $comparison.best_quality_architecture, $comparison.best_quality_score) -ForegroundColor Green
    }
    Write-Host ('MD:   {0}' -f $outputMd)
    Write-Host ('JSON: {0}' -f $outputJson)
}
