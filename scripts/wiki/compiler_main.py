import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from orchestrator.wiki.graph_consolidator import GraphConsolidator
from orchestrator.wiki.incremental_engine import IncrementalEngine
from orchestrator.wiki.plugin_manager import PluginManager
from scripts.wiki.providers.codegraph_provider import CodeGraphProvider
from scripts.wiki.providers.graphify_provider import GraphifyProvider


REPO_ROOT = Path(__file__).resolve().parents[2]
UNIFIED_GRAPH_PATH = REPO_ROOT / "repo-intake" / "generated" / "wiki" / "unified-graph.json"
MARKDOWN_OUTPUT_DIR = REPO_ROOT / "projects" / "openwiki_projection"
ITERATION_LOG = REPO_ROOT / "observability" / "logs" / "iteration-metrics.jsonl"
ROUTING_LOG = REPO_ROOT / "observability" / "logs" / "routing-decisions.jsonl"


def _append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=True) + "\n")


def _read_session_env() -> Dict[str, str]:
    keys = [
        "MCP_AGENT",
        "MCP_ENGINE",
        "MCP_SESSION_ID",
        "VSCODE_TARGET_SESSION_LOG",
        "CI",
    ]
    env_snapshot: Dict[str, str] = {}
    for key in keys:
        value = os.getenv(key)
        if value:
            env_snapshot[key] = value
    return env_snapshot


def _write_routing_event(
    env_snapshot: Dict[str, str],
    dirty_count: int,
    total_nodes: int,
    errors: List[Dict[str, Any]],
    elapsed_ms: int,
) -> None:
    routing_event: Dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "input": "autodocs compile",
        "intent": "documentar",
        "source_type": "technical-docs",
        "agent": "autodocs-agent",
        "engine": "CodeGraph",
        "optimization_profile": "strict+full",
        "fallback": False,
        "grounded": True,
        "sources": [
            "repo-intake/generated/*/capabilities/capability.json",
            "repo-intake/generated/*/context-manifests/manifest.json",
            "repo-intake/generated/wiki/unified-graph.json",
        ],
        "notes": f"dirty_nodes={dirty_count}; total_nodes={total_nodes}; elapsed_ms={elapsed_ms}; errors={len(errors)}",
        "optimization": {
            "token_saver": "always_on",
            "token_saver_profile": "strict",
            "caveman": "always_on",
            "caveman_profile": "full",
            "sources_preserved": True,
            "context_reduction_strategy": "manifest",
        },
        "memory": {
            "selected": ["/memories/repo/ops-notes.md"],
            "reason": "Reuse intake/telemetry conventions and fallback guidance.",
        },
        "learning": {
            "used_pattern": "incremental-json-projection",
            "success": len(errors) == 0,
            "outcome_status": "confirmed" if len(errors) == 0 else "pending",
            "fallback": len(errors) > 0,
            "confidence": 0.91 if len(errors) == 0 else 0.6,
        },
        "hitl": {
            "mode": "always_on_auto",
            "required": False,
            "action": "none",
            "reason": "Local deterministic docs projection with no destructive operations.",
        },
        "execution": {
            "env": env_snapshot,
            "provider_errors": errors,
        },
    }
    _append_jsonl(ROUTING_LOG, routing_event)


def main() -> int:
    start = datetime.now(timezone.utc)
    env_snapshot = _read_session_env()

    manager = PluginManager()
    manager.register_provider(CodeGraphProvider(REPO_ROOT / "repo-intake" / "generated"))
    manager.register_provider(GraphifyProvider(REPO_ROOT / "repo-intake" / "generated"))

    provider_result = manager.gather_all()
    contracts = provider_result.get("contracts", [])
    provider_errors = provider_result.get("errors", [])

    consolidator = GraphConsolidator(
        output_graph_path=UNIFIED_GRAPH_PATH,
        markdown_output_dir=MARKDOWN_OUTPUT_DIR,
    )
    unified_graph = consolidator.consolidate(contracts)

    incremental_engine = IncrementalEngine(UNIFIED_GRAPH_PATH)
    diff = incremental_engine.diff(unified_graph.get("nodes", {}))
    dirty_nodes = diff.get("dirty_nodes", {})
    deleted_nodes = diff.get("deleted_nodes", [])

    project_stats = consolidator.project_dirty_nodes(dirty_nodes, deleted_nodes)
    consolidator.persist_graph(unified_graph)

    elapsed_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
    iteration_event: Dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source_type": "technical-docs",
        "module": "autodocs",
        "total_nodes": len(unified_graph.get("nodes", {})),
        "dirty_nodes": len(dirty_nodes),
        "deleted_nodes": len(deleted_nodes),
        "rendered_markdown": int(project_stats.get("rendered", 0)),
        "deleted_markdown": int(project_stats.get("deleted", 0)),
        "provider_errors": len(provider_errors),
        "elapsed_ms": elapsed_ms,
    }
    _append_jsonl(ITERATION_LOG, iteration_event)
    _write_routing_event(
        env_snapshot=env_snapshot,
        dirty_count=len(dirty_nodes),
        total_nodes=len(unified_graph.get("nodes", {})),
        errors=provider_errors,
        elapsed_ms=elapsed_ms,
    )

    return 0