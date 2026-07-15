# Session Cost Estimate (Pre-flight)

Plantilla para estimar coste antes de sesiones complejas o iterativas.

## Metadata

- date:
- owner:
- objective:
- repo_scope:
- expected_duration_min:

## Complejidad y modelo

- complexity: simple | media | alta | critica
- default_model:
- fallback_model:
- premium_allowed: yes | no
- premium_justification:

## Estimacion de consumo

| Fase | Motor | Modelo | Prompts estimados | Coste estimado por prompt (credits) | Subtotal |
| --- | --- | --- | --- | --- | --- |
| Discovery |  |  |  |  |  |
| Analysis |  |  |  |  |  |
| Edit/Validate |  |  |  |  |  |
| Total |  |  |  |  |  |

## Guardrails

- budget_limit_credits:
- escalation_rule: subir tier solo con evidencia insuficiente
- stop_condition: grounding suficiente o limite alcanzado
- ci_code_review_enabled: yes | no

## Resultado post-sesion

- real_credits_used:
- delta_vs_estimate:
- lessons_learned:
- report_link: observability/evals/chat-token-usage-report.json
