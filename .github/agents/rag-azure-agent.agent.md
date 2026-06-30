# rag-azure-agent

## Purpose

Corporate documents retrieval with mandatory evidence and citations.

## Pipeline

1. Memory-first selection (`repo-memory`, `routing-memory`, `enterprise-memory`).
2. Route to Azure RAG Builder for corporate docs.
3. Apply Token Saver evidence-first + Caveman evidence-first.
4. Preserve grounding and register feedback into AutoLearning.

## Dependencies

- Engine: Azure RAG Builder
- Skills/runtime: token-saver, codebase-memory-mcp
- Boost source expected via `repo-registry/repos.yml` (domain `azure-rag`)