#!/usr/bin/env python3
"""
llm-token-probe.py

Ejecuta una consulta LLM real (Azure OpenAI) y emite metricas parseables
por run-demo-session.ps1:
- prompt_tokens=...
- completion_tokens=...
- total_tokens=...
- total_cost_usd=...

Uso:
  python llm-token-probe.py --profile baseline --repo-root C:/repo/TSS2026 --question "..."
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import List

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from telemetry import build_telemetry_collector

try:
    from openai import AzureOpenAI
except Exception:
    AzureOpenAI = None

PROFILES = {
    "baseline": {"max_files": 8, "chars_per_file": 1800},
    "agentes": {"max_files": 6, "chars_per_file": 1200},
    "rag": {"max_files": 4, "chars_per_file": 900},
    "master": {"max_files": 3, "chars_per_file": 700},
}

CODE_EXTS = {".cs", ".md", ".json", ".ps1", ".py", ".ts", ".js", ".yaml", ".yml"}
SKIP_PARTS = {"bin", "obj", ".git", "node_modules", ".venv", "dist", "build", "__pycache__"}


def select_files(repo_root: Path, max_files: int) -> List[Path]:
    candidates: List[Path] = []
    for p in repo_root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in CODE_EXTS:
            continue
        if any(part in SKIP_PARTS for part in p.parts):
            continue
        candidates.append(p)
        if len(candidates) >= max_files:
            break
    return candidates


def build_context(files: List[Path], repo_root: Path, chars_per_file: int) -> str:
    chunks: List[str] = []
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        rel = f.relative_to(repo_root).as_posix()
        snippet = text[:chars_per_file]
        chunks.append(f"FILE: {rel}\n{snippet}")
    return "\n\n".join(chunks)


def to_float(value: str | None, default: float) -> float:
    if not value:
        return default
    try:
        return float(value)
    except Exception:
        return default


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=sorted(PROFILES.keys()), required=True)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--question", required=True)
    args = parser.parse_args()

    repo_root = Path(args.repo_root)
    collector = build_telemetry_collector(_REPO_ROOT)
    if not repo_root.exists():
        collector.record_event("WarningGenerated", {"warning": "repo_root_missing", "repo_root": str(repo_root)}, level="WARNING")
        collector.shutdown()
        print("prompt_tokens=0")
        print("completion_tokens=0")
        print("total_tokens=0")
        print("total_cost_usd=0")
        print("probe_status=repo_root_missing")
        return 0

    cfg = PROFILES[args.profile]
    files = select_files(repo_root, cfg["max_files"])
    context = build_context(files, repo_root, cfg["chars_per_file"])

    api_key = os.getenv("AZURE_OPENAI_API_KEY")
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview")
    model = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")

    if AzureOpenAI is None or not api_key or not endpoint:
        collector.record_event(
            "WarningGenerated",
            {
                "warning": "missing_credentials_or_openai_pkg",
                "has_openai_pkg": AzureOpenAI is not None,
                "has_api_key": bool(api_key),
                "has_endpoint": bool(endpoint),
            },
            level="WARNING",
        )
        collector.shutdown()
        print("prompt_tokens=0")
        print("completion_tokens=0")
        print("total_tokens=0")
        print("total_cost_usd=0")
        print("probe_status=missing_credentials_or_openai_pkg")
        return 0

    client = AzureOpenAI(api_key=api_key, api_version=api_version, azure_endpoint=endpoint)

    system_prompt = (
        "Eres un asistente tecnico. Responde de forma breve y con foco en evidencia "
        "sobre validacion de sesion, JWT y permisos."
    )
    user_prompt = (
        f"Arquitectura: {args.profile}\n"
        f"Pregunta: {args.question}\n\n"
        f"Contexto:\n{context}\n\n"
        "Devuelve un resumen tecnico corto con riesgos y evidencia."
    )

    with collector.start_execution(
        operation="llm-token-probe",
        session_id="ops",
        provider="azure-openai",
        model=model,
    ):
        with collector.start_span(name="provider.azure_openai_call", kind="CLIENT", attributes={"profile": args.profile}):
            collector.record_event(
                "LLMRequest",
                {
                    "provider": "azure-openai",
                    "model": model,
                    "profile": args.profile,
                    "selected_files": len(files),
                },
            )
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0,
                    max_completion_tokens=400,
                )

                usage = response.usage
                prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
                completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
                total_tokens = int(getattr(usage, "total_tokens", prompt_tokens + completion_tokens) or 0)

                price_in = to_float(os.getenv("LLM_PRICE_INPUT_USD_PER_1K"), 0.0)
                price_out = to_float(os.getenv("LLM_PRICE_OUTPUT_USD_PER_1K"), 0.0)
                if price_in > 0 or price_out > 0:
                    cost = (prompt_tokens / 1000.0) * price_in + (completion_tokens / 1000.0) * price_out
                else:
                    # fallback simple when split pricing is unknown
                    flat = to_float(os.getenv("LLM_PRICE_USD_PER_1K_TOKENS"), 0.0)
                    cost = (total_tokens / 1000.0) * flat if flat > 0 else 0.0

                collector.record_usage(
                    input_tokens=prompt_tokens,
                    output_tokens=completion_tokens,
                    estimated_cost_usd=cost,
                )
                collector.record_event(
                    "LLMResponse",
                    {
                        "provider": "azure-openai",
                        "model": model,
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "total_tokens": total_tokens,
                        "estimated_cost_usd": round(cost, 6),
                    },
                )

                print(f"prompt_tokens={prompt_tokens}")
                print(f"completion_tokens={completion_tokens}")
                print(f"total_tokens={total_tokens}")
                print(f"total_cost_usd={cost:.6f}")
                print("probe_status=ok")
                collector.shutdown()
                return 0

            except Exception as ex:
                collector.record_event(
                    "ExceptionThrown",
                    {
                        "provider": "azure-openai",
                        "error": str(ex),
                    },
                    level="ERROR",
                )
                print("prompt_tokens=0")
                print("completion_tokens=0")
                print("total_tokens=0")
                print("total_cost_usd=0")
                print(f"probe_status=error:{str(ex).replace(os.linesep, ' ')[:200]}")
                collector.shutdown()
                return 0


if __name__ == "__main__":
    raise SystemExit(main())
