import hashlib
import json
from pathlib import Path
from typing import Any, Dict


class BaseWikiProvider:
    provider_id = "base"

    def __init__(self, generated_root: Path) -> None:
        self.generated_root = generated_root

    def gather_knowledge(self) -> Dict[str, Any]:
        raise NotImplementedError

    def _load_json_file(self, path: Path) -> Dict[str, Any]:
        with path.open("r", encoding="utf-8") as handle:
            parsed = json.load(handle)
        if isinstance(parsed, dict):
            return parsed
        return {}

    def _checksum(self, payload: Dict[str, Any]) -> str:
        raw = json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()