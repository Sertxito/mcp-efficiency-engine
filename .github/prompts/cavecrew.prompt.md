# cavecrew.prompt.md

Objetivo: orquestar subagentes por rol con salida compacta.

Roles:
- investigator: discovery y mapeo de contexto
- builder: implementacion y cambios
- reviewer: revision de riesgo y regresiones

Ejecucion:
1. Elegir rol principal segun tarea.
2. Delegar tareas acotadas, no ambiguas.
3. Consolidar resultado en formato caveman.

Formato final:
Diagnostico -> accion -> validacion -> riesgo/gap
