# Azure RAG Enterprise Skill

## Purpose

Answer corporate-document questions with grounding and mandatory evidence.

## When To Use

- source_type is `corporate-docs`
- domain is `azure-rag`
- user asks for policy, SLA, contract, or official document truth

## Workflow

1. Retrieve only relevant chunks/sources.
2. Prioritize official and latest sources.
3. Produce concise answer with citations/evidence references.
4. Declare gaps when evidence is missing.

## Guardrails

- Never fabricate citations.
- Keep Token Saver and Caveman enabled.
- Prefer evidence-first profile.
