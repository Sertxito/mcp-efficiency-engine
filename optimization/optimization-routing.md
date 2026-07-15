# Optimization Routing — Always On

## Regla global

Token Saver y Caveman están siempre activos.

Memory MCP y Learning son transversales (always-on), pero la eleccion de engine es propiedad del routing segun intencion/contexto.

## Perfil por tipo de tarea

| Tarea | Token Saver | Caveman |
| --- | --- | --- |
| Debug / bug / CLI | strict | full |
| Refactor | strict | full/lite |
| Legacy impact | balanced | lite |
| Arquitectura | balanced | lite |
| DBA / SQL | strict | full/lite |
| RAG local | balanced | lite |
| Azure RAG corporativo | evidence-first | evidence-first |
| Formación | balanced | didactic-lite |
| Community content | balanced | lite |
| Snapshot | strict | lite |

## Prioridad

```txt
Si requiere fuentes -> evidence-first.
Si requiere código -> strict.
Si requiere enseñanza -> didactic-lite.
```

## Cost-aware fallback

Regla principal:

```txt
Si complejidad = simple o media y hay modelo barato disponible,
usar modelo barato por defecto.
Solo subir a modelo premium cuando la tarea marque [premium]
o falle el intento con evidencia insuficiente.
```

Reglas operativas:

1. Primer intento: modelo minimo viable por complejidad.
2. Escalado: subir un tier cada vez (simple -> media -> alta -> critica).
3. Stop condition: detener escalado cuando ya haya evidencia/grounding suficiente.
4. Guardrail: no usar Opus en tareas simples/media salvo excepcion documentada.
5. Trazabilidad: registrar en salida final el motivo de escalado de tier.

Referencia de tiers y multiplicadores: `optimization/model-pricing-reference.md`.
