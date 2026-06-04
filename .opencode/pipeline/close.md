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

### 2. Fusionar rama actual en `dev` local (integración)

- **Objetivo:** integrar la rama actual a la rama `dev` local como punto de
  integración temprana, antes de que el PR entre a review.
- Ejecutar el helper: `.opencode/pipeline/merge-to-dev.sh`
- El script se encarga de:
  - Si la rama actual es `main` o `dev`: no hacer nada (evita noop).
  - Si `dev` no existe: crearla desde `main` (`git branch dev main`).
  - Si `dev` existe: hacer `git merge --no-ff` de la rama actual hacia `dev`.
  - Si hay conflicto: aborta el merge (`git merge --abort`) y devuelve exit 2.
    Reportar al usuario y **no continuar** con los pasos siguientes hasta
    resolver.
- Al terminar, el worktree vuelve a la rama original automáticamente.
- **Solo local:** este paso no hace `git push`. El push queda para cuando
  se decida sincronizar el remoto (no se hace por defecto en el cierre).
- Si se trabajó directamente en `main` sin spec, saltar este paso.

### 3. Crear Pull Request

- Si se trabajó en una rama ad-hoc (no `main`):
  - `git push -u origin HEAD`
  - Abrir PR en GitHub/GitLab usando `gh` o el navegador
  - Asegurar que el PR apunte a `main` (no a `dev` — `dev` es solo integración local)
- Si se trabajó directamente en `main` (solo cambios triviales sin spec), saltar este paso
- No mergear el PR aún — marcar como "ready for review"

### 4. Entrada en LEARNINGS.md

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

### 5. Revisar CLAUDE.md

- ¿Cambió algo en la estructura del proyecto?
- ¿Nuevos comandos que documentar?
- ¿Nuevas convenciones o patrones?
- ¿Nuevos skills configurados?
- Actualizar solo si es relevante

### 6. Limpiar close-pending

- Verificar que `.opencode/pipeline/close-pending.json` exista
- Si existe, dejarlo como registro histórico (no eliminarlo)
- Marcar `completed_at` en state.json para el scope cerrado

### 7. Anunciar cierre

```
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Cierre completado · <scope>
  Spec: actualizado | no aplica
  Merge a dev: OK | no aplica | conflict|reportado a usuario
  PR: abierto | no aplica
  LEARNINGS.md: entrada agregada | sin cambios
  CLAUDE.md: actualizado | sin cambios
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```
