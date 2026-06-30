from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except Exception:
    yaml = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_simple_yml(path: Path) -> dict[str, Any]:
    repos: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        st = line.strip()
        if st.startswith("- name:"):
            if current:
                repos.append(current)
            current = {"name": st.split(":", 1)[1].strip()}
        elif current and ":" in st and not st.startswith("#"):
            k, v = st.split(":", 1)
            k = k.strip()
            v = v.strip().strip('"')
            if k in {"domain", "location", "type"}:
                current[k] = v
    if current:
        repos.append(current)
    return {"schema_version": "1.0", "repos": repos}


def load_registry(path: Path) -> dict[str, Any]:
    content = path.read_text(encoding="utf-8")

    # JSON-first support (JSON is valid YAML, but this path avoids extra deps).
    if content.lstrip().startswith("{"):
        return json.loads(content)

    if yaml is not None:
        data = yaml.safe_load(content) or {}
        if isinstance(data, dict):
            return data

    return parse_simple_yml(path)


@dataclass
class ValidationResult:
    errors: list[str]
    warnings: list[str]


def validate(registry: dict[str, Any], strict: bool, repo_root: Path) -> ValidationResult:
    errors: list[str] = []
    warnings: list[str] = []

    registry_mode = str(registry.get("registry_mode", "enterprise")).strip().lower() or "enterprise"
    repos = registry.get("repos")
    if not isinstance(repos, list):
        return ValidationResult(errors=["Registry must define a repos list."], warnings=[])

    if not repos:
        if strict or registry_mode != "template":
            return ValidationResult(errors=["Registry must define a non-empty repos list."], warnings=[])
        warnings.append("Template registry has no repos yet.")
        return ValidationResult(errors=[], warnings=warnings)

    schema_version = str(registry.get("schema_version", "1.0"))
    is_v2 = schema_version >= "2.0"
    governance = registry.get("governance", {}) if isinstance(registry.get("governance", {}), dict) else {}
    repo_name_prefix = str(governance.get("repo_name_prefix", "boost_")).strip() or "boost_"

    names: set[str] = set()
    graph: dict[str, list[str]] = {}

    for repo in repos:
        if not isinstance(repo, dict):
            errors.append("Each repo entry must be an object.")
            continue

        name = str(repo.get("name", "")).strip()
        if not name:
            errors.append("Repo is missing required field: name")
            continue

        if strict or is_v2:
            if not name.startswith(repo_name_prefix):
                errors.append(
                    f"Repo '{name}' does not satisfy naming contract. Expected prefix '{repo_name_prefix}'."
                )

        if name in names:
            errors.append(f"Duplicate repo name: {name}")
            continue
        names.add(name)

        for field in ("domain", "location", "type"):
            if not str(repo.get(field, "")).strip():
                errors.append(f"Repo '{name}' is missing required field: {field}")

        if str(repo.get("type", "")).strip() and repo.get("type") != "local":
            errors.append(f"Repo '{name}' type must be 'local' in this phase.")

        location = str(repo.get("location", "")).strip()
        if location:
            resolved = (repo_root / location).resolve()
            if not resolved.exists():
                if bool(repo.get("optional", False)):
                    warnings.append(f"Optional repo '{name}' location does not exist: {location}")
                else:
                    errors.append(f"Repo '{name}' location does not exist: {location}")

        deps = repo.get("dependencies", [])
        dep_refs: list[str] = []
        if deps:
            if not isinstance(deps, list):
                errors.append(f"Repo '{name}' dependencies must be a list.")
            else:
                for dep in deps:
                    if not isinstance(dep, dict) or not str(dep.get("ref", "")).strip():
                        errors.append(f"Repo '{name}' has a dependency without ref.")
                        continue
                    dep_refs.append(str(dep["ref"]))
        graph[name] = dep_refs

        if strict or is_v2:
            approval = repo.get("approval")
            if not isinstance(approval, dict):
                errors.append(f"Repo '{name}' requires approval block in v2/strict mode.")
            else:
                if approval.get("status") != "approved":
                    errors.append(f"Repo '{name}' is not approved (approval.status must be 'approved').")
                if not str(approval.get("approved_by", "")).strip():
                    errors.append(f"Repo '{name}' missing approval.approved_by")
                if not str(approval.get("approved_date", "")).strip():
                    errors.append(f"Repo '{name}' missing approval.approved_date")
                if not str(approval.get("review_ticket", "")).strip():
                    warnings.append(f"Repo '{name}' missing approval.review_ticket")

    for src, dep_refs in graph.items():
        for dep in dep_refs:
            if dep not in names:
                errors.append(f"Repo '{src}' depends on unknown repo '{dep}'.")

    # Cycle detection via DFS colors: 0=unseen, 1=visiting, 2=done
    state: dict[str, int] = {name: 0 for name in names}

    def visit(node: str) -> None:
        if state[node] == 1:
            errors.append(f"Dependency cycle detected at '{node}'.")
            return
        if state[node] == 2:
            return
        state[node] = 1
        for nxt in graph.get(node, []):
            if nxt in state:
                visit(nxt)
        state[node] = 2

    for name in names:
        visit(name)

    return ValidationResult(errors=errors, warnings=warnings)


def write_report(
    path: Path,
    registry_path: Path,
    registry_mode: str,
    schema_version: str,
    strict: bool,
    result: ValidationResult,
    repos_count: int,
) -> None:
    report = {
        "timestamp": utc_now(),
        "registry_path": str(registry_path).replace("\\", "/"),
        "registry_mode": str(registry_mode),
        "schema_version": schema_version,
        "strict_mode": strict,
        "repos_count": repos_count,
        "errors_count": len(result.errors),
        "warnings_count": len(result.warnings),
        "errors": result.errors,
        "warnings": result.warnings,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate repo-registry with strict governance checks.")
    parser.add_argument("--registry", default="repo-registry/repos.yml", help="Registry file path")
    parser.add_argument("--strict", action="store_true", help="Enable strict governance checks")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    registry_path = (repo_root / args.registry).resolve()
    if not registry_path.exists():
        print(f"Missing registry file: {registry_path}")
        return 1

    try:
        registry = load_registry(registry_path)
    except Exception as exc:
        print(f"Failed to parse registry file: {exc}")
        return 1

    registry_mode = str(registry.get("registry_mode", "enterprise")).strip().lower() or "enterprise"
    schema_version = str(registry.get("schema_version", "1.0"))
    repos_count = len(registry.get("repos", [])) if isinstance(registry.get("repos", []), list) else 0
    result = validate(registry=registry, strict=args.strict, repo_root=repo_root)

    report_path = repo_root / "repo-intake/generated/reports/repo-registry-validation.json"
    write_report(
        path=report_path,
        registry_path=registry_path,
        registry_mode=registry_mode,
        schema_version=schema_version,
        strict=args.strict,
        result=result,
        repos_count=repos_count,
    )

    if result.errors:
        print("Repo registry validation failed.")
        for err in result.errors:
            print(f"- {err}")
        print(f"Report: {report_path}")
        return 1

    print("Repo registry validation OK.")
    if result.warnings:
        print("Warnings:")
        for warn in result.warnings:
            print(f"- {warn}")
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
