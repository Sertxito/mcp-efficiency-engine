# security spec

## Objetivo

Definir reglas de seguridad para routing, memoria, snapshots y respuestas.

## Reglas

1. No exponer secretos, tokens, credenciales ni datos sensibles.
2. No persistir secretos en memorias ni logs.
3. Acciones destructivas o de alto impacto requieren confirmacion humana.
4. En duda de sensibilidad, bloquear cacheado y declarar gap.

## Controles

1. Revisar artefactos generados antes de publicarlos.
2. Mantener exclusions de secretos en flujos de empaquetado/indexado.
3. Verificar que respuestas no contengan valores sensibles reales.

## Senales de incumplimiento

1. Secretos en texto plano en snapshots o logs.
2. Comandos de alto riesgo ejecutados sin aprobacion.
3. Memoria persistente con informacion sensible.

## Validacion minima

1. `py -3 .\scripts\intake\validate-security.py` completa sin errores.
2. Alineado con `policies/security-policy.md` (verificado por el script anterior).
3. Eventos de riesgo alto deben reflejar ruta HITL en observabilidad (verificado por el script anterior).
