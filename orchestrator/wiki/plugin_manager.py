from datetime import datetime, timezone
from typing import Any, Dict, List

from telemetry import build_telemetry_collector


class PluginManager:
    def __init__(self, telemetry_collector: Any | None = None) -> None:
        self._providers: List[Any] = []
        self._telemetry = telemetry_collector

    def _collector(self) -> Any:
        if self._telemetry is None:
            from pathlib import Path

            repo_root = Path(__file__).resolve().parents[2]
            self._telemetry = build_telemetry_collector(repo_root)
        return self._telemetry

    def register_provider(self, provider: Any) -> None:
        collector = self._collector()
        with collector.start_span(name="plugin.register_provider", kind="INTERNAL"):
            collector.record_event(
                "ProviderRequest",
                {
                    "provider_id": str(getattr(provider, "provider_id", "unknown")),
                    "operation": "register_provider",
                },
            )
        if not hasattr(provider, "provider_id"):
            raise ValueError("Provider must define provider_id")
        if not hasattr(provider, "gather_knowledge"):
            raise ValueError("Provider must implement gather_knowledge()")
        self._providers.append(provider)
        collector.record_event(
            "ProviderResponse",
            {
                "provider_id": str(getattr(provider, "provider_id", "unknown")),
                "status": "registered",
            },
        )

    def gather_all(self) -> Dict[str, List[Dict[str, Any]]]:
        collector = self._collector()
        contracts: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []
        with collector.start_execution(operation="plugin-manager-gather-all", session_id="wiki-orchestrator"):
            for provider in self._providers:
                provider_id = str(getattr(provider, "provider_id", "unknown"))
                with collector.start_span(name="plugin.gather_knowledge", kind="INTERNAL", attributes={"provider_id": provider_id}):
                    try:
                        collector.record_event(
                            "ProviderRequest",
                            {
                                "provider_id": provider_id,
                                "operation": "gather_knowledge",
                            },
                        )
                        contract = provider.gather_knowledge()
                        if isinstance(contract, dict):
                            contracts.append(contract)
                            collector.record_event(
                                "ProviderResponse",
                                {
                                    "provider_id": provider_id,
                                    "status": "ok",
                                    "contract_kind": str(contract.get("kind", "unknown")),
                                },
                            )
                        else:
                            errors.append(
                                {
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                    "provider_id": provider_id,
                                    "error": "Provider returned non-dict contract",
                                }
                            )
                            collector.record_event(
                                "WarningGenerated",
                                {
                                    "provider_id": provider_id,
                                    "warning": "Provider returned non-dict contract",
                                },
                                level="WARNING",
                            )
                    except Exception as exc:
                        errors.append(
                            {
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                "provider_id": provider_id,
                                "error": str(exc),
                            }
                        )
                        collector.record_event(
                            "ExceptionThrown",
                            {
                                "provider_id": provider_id,
                                "error": str(exc),
                            },
                            level="ERROR",
                        )

            collector.record_metric("provider_calls", float(len(self._providers)), unit="count")
            collector.record_metric("error_count", float(len(errors)), unit="count")
        return {"contracts": contracts, "errors": errors}