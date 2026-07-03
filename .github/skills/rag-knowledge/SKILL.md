# RAG Knowledge Skill

## Purpose

Answer technical/local documentation questions from local knowledge sources.

## When To Use

- source_type is `technical-docs`
- agent route is `rag-local`

## Workflow

1. Retrieve minimal relevant local nodes/chunks.
2. Synthesize concise technical answer.
3. Mention evidence basis or declare a gap.

## Guardrails

- No unsupported claims.
- Keep context scope minimal.
