---
name: qa-learnings
description: Aprendizajes acumulados del QA engineer. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

## Reglas activas (validadas ≥2 veces)
*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea. Cuando un mismo patrón aparece en ≥2 entradas de LEARNINGS.md, se promueve aquí.*

### Accionables del agente qa

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A7** | Usar `jq` en vez de `python3 -c` para verificar respuestas JSON en bash. `jq 'type'` discrimina array/object; `jq 'length'` es inequívoco | **MEDIA** |
| **A8** | En fase GREEN, verificar que los endpoints nuevos responden con `curl -s -o /dev/null -w "%{http_code}"` ANTES de marcar como passing. No confiar solo en tests unitarios | **ALTA** |
| **A9** | Agregar al checklist de QA GREEN: ejecutar `git merge --no-commit --no-ff origin/dev` como dry-run para detectar conflictos antes del cierre | **MEDIA** |

## Lecciones recientes
- [2026-06-10] cleanup-ts-expect-error-after-red-phase — **Lección**: **Siempre** hacer una pasada de limpieza de `@ts-expect-error` después de la implementación. Los directives

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*
