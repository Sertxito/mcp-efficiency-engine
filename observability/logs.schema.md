Schema: timestamp, input, intent, source_type, agent, engine, optimization_profile, fallback, grounded, sources, notes.

## Optimization fields

```json
{
  "optimization": {
    "token_saver": "always_on",
    "token_saver_profile": "strict|balanced|evidence-first|didactic",
    "caveman": "always_on",
    "caveman_profile": "full|lite|evidence-first|didactic-lite",
    "sources_preserved": true,
    "context_reduction_strategy": "symbol|node|chunk|manifest|snapshot-scope"
  },
  "memory": {
  "selected": ["code-memory", "enterprise-memory"],
  "reason": "multi-domain query"
},
"learning": {
  "used_pattern": "auth+sla",
  "success": true,
  "fallback": false,
  "confidence": 0.84
}
}
```
