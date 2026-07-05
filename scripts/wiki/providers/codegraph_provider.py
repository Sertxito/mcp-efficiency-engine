from pathlib import Path
from typing import Any, Dict, List

from scripts.wiki.providers.base_provider import BaseWikiProvider


class CodeGraphProvider(BaseWikiProvider):
    provider_id = "codegraph"

    def __init__(self, generated_root: Path) -> None:
        super().__init__(generated_root)

    def gather_knowledge(self) -> Dict[str, Any]:
        entities: List[Dict[str, Any]] = []
        for boost_dir in self.generated_root.iterdir():
            if not boost_dir.is_dir():
                continue

            capability_path = boost_dir / "capabilities" / "capability.json"
            manifest_path = boost_dir / "context-manifests" / "manifest.json"
            if not capability_path.exists() or not manifest_path.exists():
                continue

            capability = self._load_json_file(capability_path)
            if str(capability.get("engine", "")).lower() != "codegraph":
                continue

            manifest = self._load_json_file(manifest_path)
            payload = {
                "boost": boost_dir.name,
                "capability": capability,
                "manifest": manifest,
            }
            relations = []
            for dependency in capability.get("dependencies", []):
                relations.append({"target": str(dependency), "type": "depends_on"})

            entity_id = str(capability.get("repo", boost_dir.name))
            entities.append(
                {
                    "id": entity_id,
                    "type": "boost_capability",
                    "checksum": self._checksum(payload),
                    "raw_data": payload,
                    "relations": relations,
                }
            )

        return {"provider_id": self.provider_id, "entities": entities}