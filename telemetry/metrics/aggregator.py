from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class MetricsSnapshot:
    execution_time_ms: float = 0.0
    tool_duration_ms: float = 0.0
    average_duration_ms: float = 0.0
    parallel_tasks: int = 0
    sequential_tasks: int = 0
    retry_count: int = 0
    error_count: int = 0
    warning_count: int = 0
    llm_calls: int = 0
    provider_calls: int = 0
    mcp_calls: int = 0
    tool_invocations: int = 0
    tokens_input: int = 0
    tokens_output: int = 0
    total_tokens: int = 0
    estimated_cost: float = 0.0
    cache_hits: int = 0
    cache_misses: int = 0
    compression_ratio: float = 0.0
    parallel_efficiency: float = 0.0
    prompt_reduction: float = 0.0
    context_reduction: float = 0.0


@dataclass
class MetricsAggregator:
    durations: list[float] = field(default_factory=list)
    snapshot: MetricsSnapshot = field(default_factory=MetricsSnapshot)

    def add_duration(self, value_ms: float) -> None:
        safe = max(0.0, float(value_ms))
        self.durations.append(safe)
        self.snapshot.tool_duration_ms += safe
        if self.durations:
            self.snapshot.average_duration_ms = self.snapshot.tool_duration_ms / len(self.durations)

    def add_tokens(self, input_tokens: int, output_tokens: int) -> None:
        self.snapshot.tokens_input += max(0, int(input_tokens))
        self.snapshot.tokens_output += max(0, int(output_tokens))
        self.snapshot.total_tokens = self.snapshot.tokens_input + self.snapshot.tokens_output

    def add_cost(self, estimated_cost: float) -> None:
        self.snapshot.estimated_cost += max(0.0, float(estimated_cost))

    def bump(self, metric_name: str, value: int = 1) -> None:
        if not hasattr(self.snapshot, metric_name):
            return
        current = getattr(self.snapshot, metric_name)
        if isinstance(current, int):
            setattr(self.snapshot, metric_name, max(0, current + int(value)))

    def to_dict(self) -> dict[str, float | int]:
        return self.snapshot.__dict__.copy()
