# Metrics

Métricas: routing accuracy, tool usage, tool misuse, tool switching, grounding quality, gaps, token efficiency, caveman effectiveness.

## Optimization Metrics

### Token Saver effectiveness

- reduced_context_used: true/false
- full_file_reads_avoided
- chunks_retrieved
- tool_calls_count
- fallback_used

### Caveman effectiveness

- response_mode: lite/full/evidence-first/didactic-lite
- unnecessary_intro_removed: true/false
- sources_preserved: true/false
- user_requested_more_detail: true/false

## Umbrales operativos recomendados

- routing_accuracy: `>= 95%`
- grounding_quality (casos con fuentes): `>= 90%`
- tool_misuse: `<= 2%`
- fallback_rate: `<= 10%` (si supera, revisar reglas)
- token_efficiency: tendencia estable o mejorando
- caveman_effectiveness: `>= 85%`

## Telemetry Engine native metrics

El engine expone métricas propias y no depende de proveedores externos:

- execution_time_ms
- tool_duration_ms
- average_duration_ms
- parallel_tasks
- sequential_tasks
- retry_count
- error_count
- warning_count
- llm_calls
- provider_calls
- mcp_calls
- tool_invocations
- tokens_input
- tokens_output
- total_tokens
- estimated_cost
- cache_hits
- cache_misses
- compression_ratio
- parallel_efficiency
- prompt_reduction
- context_reduction
- efficiency_score (0-100)

Los cálculos viven en:

- `telemetry/metrics/aggregator.py`
- `telemetry/scoring/efficiency.py`

## Semaforo

- `OK`: todos los umbrales en rango.
- `WARN`: 1-2 metricas fuera de rango.
- `FAIL`: 3+ metricas fuera de rango o fallo repetido de grounding/HITL.
