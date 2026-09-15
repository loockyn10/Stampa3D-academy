# AI_WORKFLOW

## 1. Objetivo

Usar varios agentes sin convertir cada feature en una cadena obligatoria de revisiones ni depender del historial de chats.

El repositorio y `/docs` son la memoria permanente.

## 2. Roles

### ChatGPT — Arquitecto de Producto y Software

Responsabilidades:

- definir producto y UX;
- discutir alternativas;
- detectar requisitos faltantes;
- diseñar funcionalidades;
- definir invariantes;
- dividir trabajo;
- elaborar especificaciones;
- decidir qué agente conviene;
- revisar conceptualmente resultados;
- mantener coherencia documental.

ChatGPT no es, por defecto, el implementador principal.

### Codex — Agente de implementación

Responsabilidades principales:

- explorar repo;
- implementar;
- modificar código;
- migrations;
- tests;
- debugging;
- validación técnica.

### Claude Code — Agente de implementación y revisión

Puede cumplir las mismas tareas de repositorio y además utilizarse como revisor independiente cuando aporte valor.

## 3. Multiagente no significa doble paso obligatorio

Ejemplos válidos:

- Feature A → Codex.
- Bug B → Claude.
- Refactor C → Codex y luego Claude revisa.
- Feature D → Claude y ChatGPT hace revisión conceptual.

No existe una regla:

`cada tarea → Codex → Claude`

La elección depende de:

- tipo/complejidad;
- riesgo;
- disponibilidad;
- fortalezas del agente;
- créditos/tokens.

## 4. Una tarea importante = un contexto nuevo

Cada feature, bug significativo o investigación debe comenzar en un contexto limpio o suficientemente pequeño.

El contexto mínimo debe contener:

- objetivo;
- reglas relevantes;
- archivos/docs a leer;
- restricciones;
- criterio de aceptación.

No adjuntar conversaciones enormes como sustituto de documentación.

## 5. Inicio de tarea

Antes de implementar:

1. leer `/docs` relevante;
2. leer `AGENTS.md` o `CLAUDE.md`;
3. inspeccionar el estado actual del repo;
4. verificar branch/worktree y cambios pendientes;
5. reconciliar cualquier contradicción entre docs y código.

## 6. Secuencial vs paralelo

### Trabajo secuencial

Codex y Claude pueden trabajar sucesivamente sobre la misma feature.

El segundo debe partir del código actualizado, no de un reporte textual del primero.

### Trabajo paralelo

Solo cuando:

- tareas son independientes; o
- se usan branches/worktrees separados.

Evitar dos agentes editando simultáneamente los mismos archivos sin coordinación.

## 7. Arquitectura y decisiones

Ningún agente modifica silenciosamente:

- source of truth;
- permisos;
- RLS;
- modelo Free/Paid;
- arquitectura de stock;
- pricing;
- contratos globales;
- schema compartido.

Si aparece una decisión nueva importante:

1. detener o aislar el trabajo;
2. consultar/definir decisión;
3. reflejarla en `/docs/DECISIONS.md` y documento de dominio correspondiente;
4. recién después implementar.

## 8. Handoff entre agentes

Formato recomendado:

### Objetivo
Qué se intentó resolver.

### Estado del repo
Branch/worktree, migrations pendientes, cambios sin commit.

### Implementado
Solo hechos comprobados.

### Pendiente
Qué falta.

### Riesgos
Supuestos, schema drift, RLS, regresiones.

### Validaciones
Tests/typecheck/build realmente ejecutados.

### Docs
Qué documentación fue actualizada o debe actualizarse.

## 9. Política de documentación

Actualizar documentación cuando cambie algo estructural.

Mantenerla compacta:

- estado vigente;
- decisiones vigentes;
- restricciones;
- pendientes.

No conservar cronología completa, prompts, logs ni tareas terminadas.

`TASKS.md` solo contiene trabajo actual/próximo.

## 10. Jerarquía ante contradicciones

Cuando código y docs difieren:

- no asumir automáticamente que uno está correcto;
- señalarlo;
- comprobar intención con tests, migrations, commits y reglas de producto;
- corregir código o docs según corresponda.

El código tiene prioridad para describir “qué está ejecutándose”; las decisiones vigentes en docs tienen prioridad para describir “qué debería hacer el producto”. Una discrepancia es un issue a resolver.

## 11. Cierre de tarea

Una tarea se considera cerrada cuando:

- criterio de aceptación cumplido;
- validaciones relevantes ejecutadas;
- migrations/manual steps reportados;
- riesgos conocidos documentados;
- `/docs` actualizado si cambió arquitectura/producto;
- `TASKS.md` actualizado si corresponde.

Después cerrar el contexto y comenzar uno nuevo para el siguiente problema importante.
