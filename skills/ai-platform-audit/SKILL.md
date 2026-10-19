---
name: ai-platform-audit
description: "Review AI, retrieval, agent, and MCP systems for grounding, evaluation, permissions, privacy, observability, and cost evidence."
---

# AI platform audit

## Procedure
1. Map model, retrieval, ingestion, tools, memory, users, trust boundaries, and
   data flows.
2. Inspect grounding sources, freshness, access trimming, evaluation sets, and
   observed quality evidence.
3. Review tool permissions, prompt-injection boundaries, approval behavior,
   retention, and cross-user/session isolation.
4. Inspect latency, failure, cost, and audit signals; mark absent measurements
   as unknown rather than assigning maturity scores.
5. Define representative positive, ambiguous, unavailable-tool, and adversarial
   evaluations with explicit oracles.

## Output
Evidence-backed risks, coverage limits, evaluation gaps, and prioritized
verification. Do not claim zero hallucinations, safety, or maturity without
measured and reviewed evidence.
