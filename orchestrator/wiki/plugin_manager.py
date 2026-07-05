from datetime import datetime, timezone
from typing import Any, Dict, List


class PluginManager:
    def __init__(self) -> None:
        self._providers: List[Any] = []

    def register_provider(self, provider: Any) -> None:
        if not hasattr(provider, "provider_id"):
            raise ValueError("Provider must define provider_id")
        if not hasattr(provider, "gather_knowledge"):
            raise ValueError("Provider must implement gather_knowledge()")
        self._providers.append(provider)

    def gather_all(self) -> Dict[str, List[Dict[str, Any]]]:
        contracts: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []
        for provider in self._providers:
            try:
                contract = provider.gather_knowledge()
                if isinstance(contract, dict):
                    contracts.append(contract)
                else:
                    errors.append(
                        {
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "provider_id": str(getattr(provider, "provider_id", "unknown")),
                            "error": "Provider returned non-dict contract",
                        }
                    )
            except Exception as exc:
                errors.append(
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "provider_id": str(getattr(provider, "provider_id", "unknown")),
                        "error": str(exc),
                    }
                )
        return {"contracts": contracts, "errors": errors}