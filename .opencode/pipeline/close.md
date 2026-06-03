# Close checklist

Ejecutar **inmediatamente** cuando el último todo de un scope se marca como `completed`.

## Pasos

### 1. Actualizar spec (si aplica)

- Buscar el spec relacionado en `spec/` por fecha/asunto
- Agregar sección `## Resultado` al final con:
  - Fecha de finalización
  - Status del spec: `completed`
  - `### Implementado` — criterios completados `[x]`
  - `### No implementado / Desviaciones` — si las hay
  - `### Tests` — resumen de resultados
- Marcar `[x]` los criterios de aceptación que se completaron
- Si no hay spec asociado, saltar este paso

### 2. Entrada en LEARNINGS.md

- Abrir `.claude/LEARNINGS.md`
- Agregar entrada al final con el template estándar:

```markdown
---
date: YYYY-MM-DD
agent: agent-type
category: setup | pattern | api-gotcha | test-strategy | security-finding | spec-process | user-feedback
tags: [tag1, tag2]
slug: descripcion-corta-en-kebab-case
---

**Contexto**: qué estaba haciendo cuando lo descubrí.
**Qué pasó**: el comportamiento sorpresivo, el error, o la decisión.
**Lección**: qué hacer / no hacer en el futuro.
**Cómo aplicar**: en qué situaciones específicas recordar esto.
```

- Preguntar al usuario si quiere agregar algo
- Solo agregar si hay una lección no obvia

### 3. Revisar CLAUDE.md

- ¿Cambió algo en la estructura del proyecto?
- ¿Nuevos comandos que documentar?
- ¿Nuevas convenciones o patrones?
- ¿Nuevos skills configurados?
- Actualizar solo si es relevante

### 4. Limpiar close-pending

- Verificar que `.opencode/pipeline/close-pending.json` exista
- Si existe, dejarlo como registro histórico (no eliminarlo)
- Marcar `completed_at` en state.json para el scope cerrado

### 5. Anunciar cierre

```
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Cierre completado · <scope>
  Spec: actualizado | no aplica
  LEARNINGS.md: entrada agregada | sin cambios
  CLAUDE.md: actualizado | sin cambios
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```
