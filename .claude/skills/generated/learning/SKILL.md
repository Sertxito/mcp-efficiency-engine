---
name: learning
description: "Skill for the Learning area of mcpFirst. 23 symbols across 4 files."
---

# Learning

23 symbols | 4 files | Cohesion: 100%

## When to Use

- Working with code in `scripts/`
- Understanding how utc_now, pct, safe_rate work
- Modifying learning-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `scripts/learning/learning-loop-report.py` | utc_now, pct, safe_rate, parse_events, parse_feedback (+3) |
| `scripts/learning/iteration-value-report.py` | utc_now, safe_rate, parse_jsonl, latest_by_event, build_report (+2) |
| `scripts/learning/record-iteration-metrics.py` | utc_now, parse_jsonl, latest_event_id, main |
| `scripts/learning/record-learning-feedback.py` | utc_now, parse_jsonl, latest_event_id, main |

## Entry Points

Start here when exploring this area:

- **`utc_now`** (Function) — `scripts/learning/learning-loop-report.py:10`
- **`pct`** (Function) — `scripts/learning/learning-loop-report.py:14`
- **`safe_rate`** (Function) — `scripts/learning/learning-loop-report.py:18`
- **`parse_events`** (Function) — `scripts/learning/learning-loop-report.py:24`
- **`parse_feedback`** (Function) — `scripts/learning/learning-loop-report.py:42`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `utc_now` | Function | `scripts/learning/learning-loop-report.py` | 10 |
| `pct` | Function | `scripts/learning/learning-loop-report.py` | 14 |
| `safe_rate` | Function | `scripts/learning/learning-loop-report.py` | 18 |
| `parse_events` | Function | `scripts/learning/learning-loop-report.py` | 24 |
| `parse_feedback` | Function | `scripts/learning/learning-loop-report.py` | 42 |
| `build_report` | Function | `scripts/learning/learning-loop-report.py` | 64 |
| `report_to_markdown` | Function | `scripts/learning/learning-loop-report.py` | 190 |
| `main` | Function | `scripts/learning/learning-loop-report.py` | 240 |
| `utc_now` | Function | `scripts/learning/iteration-value-report.py` | 10 |
| `safe_rate` | Function | `scripts/learning/iteration-value-report.py` | 14 |
| `parse_jsonl` | Function | `scripts/learning/iteration-value-report.py` | 20 |
| `latest_by_event` | Function | `scripts/learning/iteration-value-report.py` | 37 |
| `build_report` | Function | `scripts/learning/iteration-value-report.py` | 47 |
| `to_markdown` | Function | `scripts/learning/iteration-value-report.py` | 150 |
| `main` | Function | `scripts/learning/iteration-value-report.py` | 230 |
| `utc_now` | Function | `scripts/learning/record-iteration-metrics.py` | 9 |
| `parse_jsonl` | Function | `scripts/learning/record-iteration-metrics.py` | 13 |
| `latest_event_id` | Function | `scripts/learning/record-iteration-metrics.py` | 30 |
| `main` | Function | `scripts/learning/record-iteration-metrics.py` | 38 |
| `utc_now` | Function | `scripts/learning/record-learning-feedback.py` | 9 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → Utc_now` | intra_community | 3 |
| `Main → Safe_rate` | intra_community | 3 |
| `Main → Safe_rate` | intra_community | 3 |
| `Main → Utc_now` | intra_community | 3 |
| `Main → Pct` | intra_community | 3 |

## How to Explore

1. `context({name: "utc_now"})` — see callers and callees
2. `query({search_query: "learning"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
