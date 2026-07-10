import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from telemetry import build_telemetry_collector

from orchestrator.wiki.graph_consolidator import GraphConsolidator
from orchestrator.wiki.incremental_engine import IncrementalEngine
from orchestrator.wiki.plugin_manager import PluginManager
from scripts.wiki.providers.repo_content_provider import RepoContentProvider
from scripts.wiki.validator import WikiValidator
from scripts.wiki.providers.codegraph_provider import CodeGraphProvider
from scripts.wiki.providers.graphify_provider import GraphifyProvider


REPO_ROOT = Path(__file__).resolve().parents[2]
AUTODOCS_ROOT = REPO_ROOT / "autodocs"
GENERATED_OUTPUT_DIR = AUTODOCS_ROOT / "generated"
SCHEMA_PATH = AUTODOCS_ROOT / "schema" / "wiki-node.schema.json"
UNIFIED_GRAPH_PATH = GENERATED_OUTPUT_DIR / "unified-graph.json"
MARKDOWN_OUTPUT_DIR = AUTODOCS_ROOT / "site"
VALIDATION_REPORT_JSON = GENERATED_OUTPUT_DIR / "validation-report.json"
VALIDATION_REPORT_MD = GENERATED_OUTPUT_DIR / "validation-report.md"
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
            "autodocs/generated/unified-graph.json",
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
    collector = build_telemetry_collector(REPO_ROOT)

    with collector.start_execution(operation="autodocs-compiler", session_id="autodocs"):
        collector.record_event("ExecutionStarted", {"pipeline": "autodocs", "env_keys": sorted(env_snapshot.keys())})

        manager = PluginManager(telemetry_collector=collector)
        include_external = str(os.getenv("AUTODOCS_INCLUDE_EXTERNAL_PROVIDERS", "")).strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

        # Keep CI output deterministic: external providers depend on local intake artifacts that
        # may not exist on clean runners.
        if include_external:
            manager.register_provider(CodeGraphProvider(REPO_ROOT / "repo-intake" / "generated"))
            manager.register_provider(GraphifyProvider(REPO_ROOT / "repo-intake" / "generated"))

        manager.register_provider(RepoContentProvider(REPO_ROOT))

        with collector.start_span(name="autodocs.providers", kind="INTERNAL"):
            provider_result = manager.gather_all()
            contracts = provider_result.get("contracts", [])
            provider_errors = provider_result.get("errors", [])
            collector.record_metric("provider_calls", float(len(contracts) + len(provider_errors)), unit="count")

        consolidator = GraphConsolidator(
            output_graph_path=UNIFIED_GRAPH_PATH,
            markdown_output_dir=MARKDOWN_OUTPUT_DIR,
            telemetry_collector=collector,
        )
        with collector.start_span(name="autodocs.consolidate", kind="INTERNAL"):
            unified_graph = consolidator.consolidate(contracts)
            wiki_nodes = unified_graph.get("wiki_nodes", {})

        incremental_engine = IncrementalEngine(UNIFIED_GRAPH_PATH, telemetry_collector=collector)
        with collector.start_span(name="autodocs.incremental", kind="INTERNAL"):
            diff = incremental_engine.diff(wiki_nodes)
            dirty_nodes = diff.get("dirty_nodes", {})
            deleted_nodes = diff.get("deleted_nodes", [])
            cached_nodes = diff.get("cached_graph", {}).get("nodes", {})

        validator = WikiValidator(SCHEMA_PATH, telemetry_collector=collector)
        with collector.start_span(name="autodocs.validate", kind="INTERNAL"):
            validation_report = validator.validate(wiki_nodes)
            validator.write_reports(
                json_path=VALIDATION_REPORT_JSON,
                markdown_path=VALIDATION_REPORT_MD,
                report=validation_report,
            )

        with collector.start_span(name="autodocs.project", kind="INTERNAL"):
            project_stats = consolidator.project_dirty_nodes(
                dirty_nodes=dirty_nodes,
                deleted_nodes=deleted_nodes,
                all_nodes=wiki_nodes,
                cached_nodes=cached_nodes,
            )
            consolidator.persist_graph(unified_graph)
            consolidator.persist_manifests(unified_graph)

        elapsed_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
        iteration_event: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source_type": "technical-docs",
            "module": "autodocs",
            "total_nodes": len(wiki_nodes),
            "dirty_nodes": len(dirty_nodes),
            "deleted_nodes": len(deleted_nodes),
            "rendered_markdown": int(project_stats.get("rendered", 0)),
            "deleted_markdown": int(project_stats.get("deleted", 0)),
            "rendered_indexes": int(project_stats.get("indexes", 0)),
            "rendered_manifests": int(project_stats.get("manifests", 0)),
            "provider_errors": len(provider_errors),
            "validation_errors": int(validation_report.get("summary", {}).get("error_count", 0)),
            "validation_warnings": int(validation_report.get("summary", {}).get("warning_count", 0)),
            "elapsed_ms": elapsed_ms,
        }
        _append_jsonl(ITERATION_LOG, iteration_event)
        _write_routing_event(
            env_snapshot=env_snapshot,
            dirty_count=len(dirty_nodes),
            total_nodes=len(wiki_nodes),
            errors=provider_errors,
            elapsed_ms=elapsed_ms,
        )

        collector.record_metric("execution_time_ms", float(elapsed_ms), unit="ms")
        collector.record_metric("warning_count", float(len(provider_errors)), unit="count")
        collector.record_event(
            "KnowledgeGenerated",
            {
                "total_nodes": len(wiki_nodes),
                "dirty_nodes": len(dirty_nodes),
                "deleted_nodes": len(deleted_nodes),
                "elapsed_ms": elapsed_ms,
            },
        )

    collector.shutdown()

    if int(validation_report.get("summary", {}).get("error_count", 0)) > 0:
        return 1

    return 0