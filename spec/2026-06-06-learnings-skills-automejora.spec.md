# Spec: Self-Improvement Loop — Learnings → Skills

**Fecha**: 2026-06-06
**Scope**: `learnings-skills-setup`
**Tipo**: chore
**Capa**: 1 (independiente, paralelizable)

## Objetivo

Crear un loop de automejora donde los aprendizajes del equipo (LEARNINGS.md) se extraen automáticamente en skills específicos por subagente (qa, backend, frontend, architect). Esto permite que cada agente herede conocimiento validado sin tener que leer 877 líneas de LEARNINGS.md.

## Arquitectura del loop

```
Tarea → Agente → Aprende → LEARNINGS.md
                              ↓
              close.md step 4b + hook/plugin
                              ↓
              extract-learnings.ts
                              ↓
           Skill {agent}-learnings actualizado
                              ↓
        Siguiente tarea: agente carga su skill
```

## Archivos a crear

| # | Archivo | Contenido |
|---|---|---|
| 1 | `.claude/skills/qa-learnings/SKILL.md` | Skill con reglas activas + lecciones recientes de QA |
| 2 | `.claude/skills/backend-learnings/SKILL.md` | Skill con reglas activas + lecciones recientes de backend |
| 3 | `.claude/skills/frontend-learnings/SKILL.md` | Skill con reglas activas + lecciones recientes de frontend |
| 4 | `.claude/skills/architect-learnings/SKILL.md` | Skill con reglas activas + lecciones recientes de architect |
| 5 | `scripts/extract-learnings.ts` | Script que extrae última entrada de LEARNINGS.md y actualiza el skill |

## Archivos a modificar

| # | Archivo | Cambio |
|---|---|---|
| 6-9 | `.claude/agents/{qa,backend,frontend,architect}.md` | Agregar `Skill({agent}-learnings)` en sección "Mejora continua" |
| 10-13 | `.opencode/agents/{qa,backend,frontend,architect}.md` | Agregar `Skill({agent}-learnings)` en sección "Mejora continua" |
| 14 | `.opencode/pipeline/close.md` | Agregar step 4b: extracción de learnings a skills |
| 15 | `.opencode/plugins/pipeline-enforcer.js` | Agregar hook que ejecuta `extract-learnings.ts` al detectar close-pending |
| 16 | `.claude/settings.json` | Agregar Stop hook condicional que ejecuta `extract-learnings.ts` |

## Skill template

```markdown
---
name: {agent}-learnings
description: Aprendizajes acumulados del {agent}. Patrones validados en el proyecto.
---

# {Agent} Learnings

## Reglas activas (validadas ≥2 veces)
<!-- Auto-poblado por extract-learnings.ts -->

## Lecciones recientes
<!-- Últimas 5 entradas de LEARNINGS.md con agent: {agent} -->

## Promovidas a CLAUDE.md
<!-- Entradas que ya migraron a reglas permanentes -->
```

## Script extract-learnings.ts

- Lee última entrada de `.claude/LEARNINGS.md` (último bloque entre `---` y `---`)
- Extrae `agent`, `slug`, `category`, `tags` del frontmatter
- Lee `.claude/skills/{agent}-learnings/SKILL.md`
- Agrega la entrada en "Lecciones recientes" (máximo 5)
- Si el mismo slug ya existe ≥2 veces en "Lecciones recientes", lo promueve a "Reglas activas"
- Escribe el skill actualizado
- **Idempotente**: si la entrada ya existe, no duplica

## Mecanismos de disparo

| Motor | Mecanismo | Guard |
|---|---|---|
| opencode | Plugin `pipeline-enforcer.js` → hook `todo.updated` | Detecta `close-pending.json` |
| Claude Code | Stop hook en `.claude/settings.json` | `[ -f close-pending.json ] && npx tsx ...` |
| Fallback | Instrucciones inline en close.md step 4b | Manual (el agente sigue el checklist) |

## Verificación

1. Ejecutar `npx tsx scripts/extract-learnings.ts` con datos de prueba
2. Verificar que el skill correspondiente se actualiza correctamente
3. Verificar idempotencia: ejecutar 2 veces sin duplicar
4. `pnpm typecheck` pasa

## Resultado

**Completado**: 2026-06-06
**Estado**: ✅ Completado

**Implementado**:
- [x] 4 skills de learnings creados (qa, backend, frontend, architect)
- [x] Script `extract-learnings.ts` con --dry-run funcional
- [x] 8 agentes actualizados con pre-read de learnings skill
- [x] close.md con step 4b insertado
- [x] Plugin pipeline-enforcer con hook de extracción
- [x] Stop hook en settings.json condicional

**Desviaciones**: Ninguna.

**Tests**: Typecheck 6/6 limpio. Dry run de extract-learnings.ts parsea correctamente.

## Dependencias entre scopes

| Scope | Depende de | Capa |
|---|---|---|
| `mutation-testing-setup` | — | 1 |
| `learnings-skills-setup` | — | 1 |
| `qa-green-red-integration` | mutation-testing-setup, learnings-skills-setup | 2 |
