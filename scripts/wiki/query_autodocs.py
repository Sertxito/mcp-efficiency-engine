import json
import sys
from pathlib import Path
from typing import Any, Dict, List, cast


REPO_ROOT = Path(__file__).resolve().parents[2]
SEARCH_INDEX_PATH = REPO_ROOT / "autodocs" / "generated" / "search-index.json"


SearchEntry = Dict[str, Any]


def _load_index() -> List[SearchEntry]:
    if not SEARCH_INDEX_PATH.exists():
        return []
    with SEARCH_INDEX_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, list):
        entries: List[SearchEntry] = []
        for item in cast(List[Any], payload):
            if isinstance(item, dict):
                entries.append(cast(SearchEntry, item))
        return entries
    return []


def _matches(entry: SearchEntry, query: str) -> bool:
    haystack = " ".join(
        [
            str(entry.get("title", "")),
            str(entry.get("summary", "")),
            str(entry.get("kind", "")),
            str(entry.get("domain", "")),
            " ".join(str(tag) for tag in entry.get("tags", [])),
        ]
    ).lower()
    return query.lower() in haystack


def main() -> int:
    query = " ".join(sys.argv[1:]).strip()
    if not query:
        print("Usage: py -3 -m scripts.wiki.query_autodocs <query>")
        return 1

    results = [entry for entry in _load_index() if _matches(entry, query)]
    if not results:
        print("No matches")
        return 0

    for entry in results:
        print(f"- {entry.get('title', '')} [{entry.get('kind', '')}] -> {entry.get('path', '')}")
        print(f"  {entry.get('summary', '')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())