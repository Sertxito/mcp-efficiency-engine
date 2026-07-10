from __future__ import annotations

import os
import unittest
from pathlib import Path

from telemetry.collector.engine import TelemetryCollector
from telemetry.config import load_config
from telemetry.exporters.json.exporter import JsonExporter
from telemetry.exporters.langsmith.exporter import LangSmithExporter
from telemetry.scoring.efficiency import compute_efficiency_score


class InMemoryExporter:
    name = "memory"

    def __init__(self) -> None:
        self.records: list[dict] = []

    def export(self, records: list[dict]) -> None:
        self.records.extend(records)

    def flush(self) -> None:
        return

    def shutdown(self) -> None:
        return


class RecordingLangSmithClient:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create_run(self, **kwargs) -> None:
        self.calls.append(kwargs)


class TelemetryEngineTests(unittest.TestCase):
    def test_execution_and_span_emit_events(self) -> None:
        exporter = InMemoryExporter()
        collector = TelemetryCollector(exporters=[exporter], enabled=True, batch_size=3)

        with collector.start_execution(operation="unit-test", session_id="tests"):
            with collector.start_span(name="inner", kind="INTERNAL"):
                collector.record_event("ToolStarted", {"tool": "dummy"})
                collector.record_event("ToolFinished", {"tool": "dummy"})

        collector.shutdown()
        event_names = {str(r.get("event_name", "")) for r in exporter.records}
        self.assertIn("ExecutionStarted", event_names)
        self.assertIn("ExecutionFinished", event_names)
        self.assertIn("SpanFinished", event_names)

    def test_usage_metrics_are_recorded(self) -> None:
        exporter = InMemoryExporter()
        collector = TelemetryCollector(exporters=[exporter], enabled=True, batch_size=50)

        with collector.start_execution(operation="usage-test", session_id="tests"):
            collector.record_usage(input_tokens=100, output_tokens=50, estimated_cost_usd=0.012)

        collector.shutdown()
        metric_records = [r for r in exporter.records if str(r.get("type", "")) == "metric"]
        self.assertTrue(any(r.get("payload", {}).get("name") == "total_tokens" for r in metric_records))

    def test_efficiency_score_in_range(self) -> None:
        score = compute_efficiency_score(
            {
                "execution_time_ms": 1500,
                "estimated_cost": 0.02,
                "total_tokens": 1200,
                "cache_hits": 8,
                "cache_misses": 2,
                "parallel_efficiency": 0.8,
                "prompt_reduction": 0.3,
                "context_reduction": 0.5,
                "tool_invocations": 5,
                "provider_calls": 2,
                "llm_calls": 1,
                "mcp_calls": 3,
                "compression_ratio": 0.6,
            }
        )
        self.assertGreaterEqual(score, 0.0)
        self.assertLessEqual(score, 100.0)

    def test_json_exporter_writes_files(self) -> None:
        temp_dir = Path(".telemetry/test-output")
        exporter = JsonExporter(temp_dir)
        exporter.export(
            [
                {"type": "event", "event_name": "ExecutionStarted", "payload": {}},
                {"type": "metric", "event_name": "MetricCalculated", "payload": {"name": "x", "value": 1}},
            ]
        )
        self.assertTrue((temp_dir / "traces.jsonl").exists())
        self.assertTrue((temp_dir / "metrics.jsonl").exists())

    def test_langsmith_exporter_emits_usage_summary(self) -> None:
        exporter = LangSmithExporter(api_key="k", project="p")
        fake_client = RecordingLangSmithClient()
        exporter._client = fake_client

        records = [
            {
                "timestamp": "2026-07-10T12:20:18+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-1",
                    "trace_id": "0123456789abcdef0123456789abcdef",
                    "span_id": "abcdef0123456789",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                },
                "payload": {"name": "tokens_input", "value": 100, "unit": "tokens"},
            },
            {
                "timestamp": "2026-07-10T12:20:19+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-1",
                    "trace_id": "0123456789abcdef0123456789abcdef",
                    "span_id": "abcdef0123456789",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                },
                "payload": {"name": "tokens_output", "value": 50, "unit": "tokens"},
            },
            {
                "timestamp": "2026-07-10T12:20:20+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-1",
                    "trace_id": "0123456789abcdef0123456789abcdef",
                    "span_id": "abcdef0123456789",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                },
                "payload": {"name": "total_tokens", "value": 150, "unit": "tokens"},
            },
            {
                "timestamp": "2026-07-10T12:20:21+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-1",
                    "trace_id": "0123456789abcdef0123456789abcdef",
                    "span_id": "abcdef0123456789",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                },
                "payload": {"name": "estimated_cost", "value": 0.0123, "unit": "usd"},
            },
        ]

        exporter.export(records)

        summary_calls = [c for c in fake_client.calls if c.get("name") == "UsageSummary"]
        self.assertEqual(len(summary_calls), 1)
        summary = summary_calls[0]
        self.assertEqual(summary.get("run_type"), "llm")
        self.assertEqual(summary.get("outputs", {}).get("model"), "gpt-4o-mini")
        self.assertEqual(summary.get("outputs", {}).get("provider"), "openai")
        self.assertEqual(summary.get("total_cost"), 0.0123)
        self.assertEqual(summary.get("total_tokens"), 150)
        self.assertEqual(summary.get("prompt_tokens"), 100)
        self.assertEqual(summary.get("completion_tokens"), 50)
        self.assertEqual(summary.get("extra", {}).get("metadata", {}).get("ls_model_name"), "gpt-4o-mini")
        self.assertEqual(summary.get("extra", {}).get("metadata", {}).get("ls_provider"), "openai")
        self.assertEqual(
            summary.get("outputs", {}).get("usage_metadata", {}).get("total_cost"),
            0.0123,
        )

    def test_langsmith_high_signal_filters_metric_noise(self) -> None:
        exporter = LangSmithExporter(api_key="k", project="p", high_signal_only=True)
        fake_client = RecordingLangSmithClient()
        exporter._client = fake_client

        records = [
            {
                "timestamp": "2026-07-10T12:20:18+00:00",
                "type": "event",
                "event_name": "ExecutionStarted",
                "level": "INFO",
                "context": {"execution_id": "exec-2", "trace_id": "trace-2", "span_id": "span-2"},
                "payload": {"operation": "test"},
            },
            {
                "timestamp": "2026-07-10T12:20:19+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-2",
                    "trace_id": "trace-2",
                    "span_id": "span-2",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"name": "tokens_input", "value": 100, "unit": "tokens"},
            },
            {
                "timestamp": "2026-07-10T12:20:20+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-2",
                    "trace_id": "trace-2",
                    "span_id": "span-2",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"name": "tokens_output", "value": 50, "unit": "tokens"},
            },
            {
                "timestamp": "2026-07-10T12:20:21+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-2",
                    "trace_id": "trace-2",
                    "span_id": "span-2",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"name": "total_tokens", "value": 150, "unit": "tokens"},
            },
            {
                "timestamp": "2026-07-10T12:20:22+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-2",
                    "trace_id": "trace-2",
                    "span_id": "span-2",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"name": "estimated_cost", "value": 0.02, "unit": "usd"},
            },
        ]

        exporter.export(records)

        names = [c.get("name") for c in fake_client.calls]
        self.assertIn("ExecutionStarted", names)
        self.assertIn("UsageSummary", names)
        self.assertNotIn("MetricCalculated", names)

    def test_langsmith_emits_execution_summary(self) -> None:
        exporter = LangSmithExporter(api_key="k", project="p", high_signal_only=True, emit_execution_summary=True)
        fake_client = RecordingLangSmithClient()
        exporter._client = fake_client

        records = [
            {
                "timestamp": "2026-07-10T12:20:18+00:00",
                "type": "event",
                "event_name": "ExecutionStarted",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-3",
                    "trace_id": "trace-3",
                    "span_id": "span-3",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"operation": "routing"},
            },
            {
                "timestamp": "2026-07-10T12:20:19+00:00",
                "type": "event",
                "event_name": "RoutingResolved",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-3",
                    "trace_id": "trace-3",
                    "span_id": "span-3",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"agent": "backend", "engine": "CodeGraph"},
            },
            {
                "timestamp": "2026-07-10T12:20:20+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-3",
                    "trace_id": "trace-3",
                    "span_id": "span-3",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"name": "tokens_input", "value": 100, "unit": "tokens"},
            },
            {
                "timestamp": "2026-07-10T12:20:21+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-3",
                    "trace_id": "trace-3",
                    "span_id": "span-3",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"name": "tokens_output", "value": 50, "unit": "tokens"},
            },
            {
                "timestamp": "2026-07-10T12:20:22+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-3",
                    "trace_id": "trace-3",
                    "span_id": "span-3",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"name": "total_tokens", "value": 150, "unit": "tokens"},
            },
            {
                "timestamp": "2026-07-10T12:20:23+00:00",
                "type": "metric",
                "event_name": "MetricCalculated",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-3",
                    "trace_id": "trace-3",
                    "span_id": "span-3",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"name": "estimated_cost", "value": 0.01, "unit": "usd"},
            },
            {
                "timestamp": "2026-07-10T12:20:24+00:00",
                "type": "event",
                "event_name": "ExecutionFinished",
                "level": "INFO",
                "context": {
                    "execution_id": "exec-3",
                    "trace_id": "trace-3",
                    "span_id": "span-3",
                    "provider": "openai",
                    "model": "gpt-5.3-codex",
                },
                "payload": {"operation": "routing"},
            },
        ]

        exporter.export(records)
        names = [c.get("name") for c in fake_client.calls]
        self.assertIn("ExecutionSummary", names)
        summary = next(c for c in fake_client.calls if c.get("name") == "ExecutionSummary")
        self.assertEqual(summary.get("outputs", {}).get("status"), "ok")
        self.assertEqual(summary.get("outputs", {}).get("usage_metadata", {}).get("total_tokens"), 150)
        self.assertEqual(summary.get("outputs", {}).get("usage_metadata", {}).get("total_cost"), 0.01)

    def test_config_reads_langsmith_signal_tuning(self) -> None:
        keys = {
            "LANGSMITH_HIGH_SIGNAL_ONLY": "false",
            "LANGSMITH_MIN_SPAN_DURATION_MS": "250",
            "LANGSMITH_EMIT_EXECUTION_SUMMARY": "false",
        }
        backup = {k: os.environ.get(k) for k in keys}
        try:
            for k, v in keys.items():
                os.environ[k] = v
            cfg = load_config(Path(".").resolve())
            self.assertFalse(cfg.langsmith.high_signal_only)
            self.assertEqual(cfg.langsmith.min_span_duration_ms, 250.0)
            self.assertFalse(cfg.langsmith.emit_execution_summary)
        finally:
            for k, v in backup.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
