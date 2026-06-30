# Security Policy

## Objetivo

Evitar exposicion de informacion sensible en indexacion, memoria, logs y respuestas.

## Reglas

1. No indexar .env, secretos, tokens, certificados, claves privadas ni datos personales.
2. No persistir secretos en memoria de usuario, sesion o repo.
3. En caso de duda de sensibilidad, no almacenar y declarar gap.
4. No ejecutar acciones destructivas o de alto impacto sin confirmacion humana.
5. No incluir credenciales en ejemplos, comandos o artefactos.

## Controles minimos

1. Revisar entradas candidatas antes de indexar o cachear.
2. Sanitizar salidas que puedan contener valores sensibles.
3. Mantener trazabilidad de bloqueos por seguridad en logs operativos.

## Senales de fallo

1. Secretos visibles en texto plano.
2. Datos sensibles en snapshots o indices.
3. Respuesta final con credenciales o tokens reales.
