from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_registry(path: Path) -> dict[str, Any]:
    content = path.read_text(encoding="utf-8")
    if content.lstrip().startswith("{"):
        return json.loads(content)
    raise ValueError("Registry must be JSON-first in current setup.")


def slug_name(folder_name: str) -> str:
    name = folder_name.lower().replace("-", "_")
    name = re.sub(r"[^a-z0-9_]+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name.startswith("boost_"):
        name = f"boost_{name}"
    return name


def infer_domain(folder_name: str) -> str:
    token = folder_name.lower()
    if "dba" in token or "sql" in token or "db" in token:
        return "dba"
    if "iot" in token or "edge" in token:
        return "iot"
    if "rag" in token or "azure" in token:
        return "azure-rag"
    if "legacy" in token or "migration" in token:
        return "legacy"
    return "dev"


def default_engines(domain: str) -> dict[str, str]:
    if domain == "dba":
        return {"knowledge": "graphify", "execution": "none", "snapshot": "repomix"}
    if domain == "iot":
        return {"knowledge": "graphify", "execution": "gitnexus", "snapshot": "repomix"}
    if domain == "azure-rag":
        return {"knowledge": "azure-rag-builder", "execution": "none", "snapshot": "repomix"}
    if domain == "legacy":
        return {"knowledge": "gitnexus", "execution": "none", "snapshot": "repomix"}
    return {"knowledge": "codegraph", "execution": "none", "snapshot": "repomix"}


def build_candidate(folder: Path, review_ticket_prefix: str, idx: int) -> dict[str, Any]:
    folder_name = folder.name
    repo_name = slug_name(folder_name)
    domain = infer_domain(folder_name)
    return {
        "name": repo_name,
        "domain": domain,
        "version": "1.0.0",
        "location": f"../{folder_name}",
        "type": "local",
        "dependencies": [],
        "approval": {
            "status": "approved",
            "approved_by": "platform-team",
            "approved_date": datetime.now().date().isoformat(),
            "review_ticket": f"{review_ticket_prefix}-{1000 + idx}",
        },
        "engines": default_engines(domain),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Discover sibling boost_* repos and generate onboarding proposal.")
    parser.add_argument("--root", default="C:/repo", help="Parent folder containing sibling repos")
    parser.add_argument("--registry", default="repo-registry/repos.yml", help="Registry file path")
    parser.add_argument("--output", default="repo-intake/generated/reports/boost-discovery-proposal.json")
    parser.add_argument("--apply", action="store_true", help="Apply candidates directly to registry")
    parser.add_argument("--review-ticket-prefix", default="PLATFORM", help="Prefix used for generated review tickets")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    registry_path = (repo_root / args.registry).resolve()
    registry = load_registry(registry_path)

    prefix = str(registry.get("governance", {}).get("repo_name_prefix", "boost_"))
    root = Path(args.root)
    if not root.exists():
        print(f"Root path not found: {root}")
        return 1

    existing_names = {
        str(r.get("name", ""))
        for r in registry.get("repos", [])
        if isinstance(r, dict)
    }
    existing_locations = {
        str(r.get("location", ""))
        for r in registry.get("repos", [])
        if isinstance(r, dict)
    }

    siblings = [
        p for p in root.iterdir()
        if p.is_dir() and p.name.startswith(prefix) and p.name != repo_root.name
    ]

    candidates: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    idx = 1
    for folder in sorted(siblings, key=lambda x: x.name.lower()):
        candidate = build_candidate(folder=folder, review_ticket_prefix=args.review_ticket_prefix, idx=idx)
        idx += 1

        if candidate["name"] in existing_names:
            skipped.append({"folder": folder.name, "reason": "already_registered_name"})
            continue
        if candidate["location"] in existing_locations:
            skipped.append({"folder": folder.name, "reason": "already_registered_location"})
            continue
        candidates.append(candidate)

    proposal = {
        "timestamp": utc_now(),
        "root": str(root).replace("\\", "/"),
        "prefix": prefix,
        "registry": str(registry_path).replace("\\", "/"),
        "existing_count": len(existing_names),
        "candidates_count": len(candidates),
        "skipped_count": len(skipped),
        "candidates": candidates,
        "skipped": skipped,
        "apply_mode": bool(args.apply),
    }

    out_path = (repo_root / args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(proposal, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    md_path = out_path.with_suffix(".md")
    lines = [
        "# Boost Discovery Proposal",
        "",
        f"- timestamp: {proposal['timestamp']}",
        f"- candidates: {proposal['candidates_count']}",
        f"- skipped: {proposal['skipped_count']}",
        "",
        "## Candidates",
        "",
    ]
    if candidates:
        for c in candidates:
            lines.append(f"- {c['name']} ({c['domain']}) -> {c['location']}")
    else:
        lines.append("- none")
    lines.extend(["", "## Skipped", ""])
    if skipped:
        for s in skipped:
            lines.append(f"- {s['folder']}: {s['reason']}")
    else:
        lines.append("- none")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    if args.apply and candidates:
        registry_repos = registry.get("repos", [])
        if not isinstance(registry_repos, list):
            print("Registry repos field is invalid.")
            return 1
        registry_repos.extend(candidates)
        registry["repos"] = registry_repos
        registry_path.write_text(json.dumps(registry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Applied {len(candidates)} candidates to registry.")
    else:
        print("Dry-run mode. No registry changes applied.")

    print(f"Proposal JSON: {out_path}")
    print(f"Proposal MD: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
