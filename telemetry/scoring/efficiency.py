from __future__ import annotations

from typing import Any


DEFAULT_WEIGHTS = {
    "time": 0.18,
    "cost": 0.16,
    "tokens": 0.14,
    "cache": 0.12,
    "parallelism": 0.10,
    "reuse": 0.10,
    "calls": 0.10,
    "compression": 0.10,
}


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _safe_ratio(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return numerator / denominator


def compute_efficiency_score(metrics: dict[str, Any], weights: dict[str, float] | None = None) -> float:
    w = dict(DEFAULT_WEIGHTS)
    if weights:
        w.update(weights)

    duration = float(metrics.get("execution_time_ms", 0.0))
    cost = float(metrics.get("estimated_cost", 0.0))
    total_tokens = float(metrics.get("total_tokens", 0.0))
    cache_hits = float(metrics.get("cache_hits", 0.0))
    cache_misses = float(metrics.get("cache_misses", 0.0))
    parallel_eff = float(metrics.get("parallel_efficiency", 0.0))
    prompt_reduction = float(metrics.get("prompt_reduction", 0.0))
    context_reduction = float(metrics.get("context_reduction", 0.0))
    calls = float(
        metrics.get("tool_invocations", 0)
        + metrics.get("provider_calls", 0)
        + metrics.get("llm_calls", 0)
        + metrics.get("mcp_calls", 0)
    )
    compression = float(metrics.get("compression_ratio", 0.0))

    time_score = 1.0 - _clamp(duration / 120000.0)
    cost_score = 1.0 - _clamp(cost / 2.0)
    token_score = 1.0 - _clamp(total_tokens / 200000.0)
    cache_score = _clamp(_safe_ratio(cache_hits, cache_hits + cache_misses))
    parallel_score = _clamp(parallel_eff)
    reuse_score = _clamp((prompt_reduction + context_reduction) / 2.0)
    call_score = 1.0 - _clamp(calls / 200.0)
    compression_score = _clamp(compression)

    weighted = (
        time_score * w["time"]
        + cost_score * w["cost"]
        + token_score * w["tokens"]
        + cache_score * w["cache"]
        + parallel_score * w["parallelism"]
        + reuse_score * w["reuse"]
        + call_score * w["calls"]
        + compression_score * w["compression"]
    )
    return round(_clamp(weighted) * 100.0, 2)
