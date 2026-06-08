---
name: frontend-learnings
description: Aprendizajes acumulados del frontend engineer. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

# Frontend Learnings

## Reglas activas (validadas ≥2 veces)
*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea. Cuando un mismo patrón aparece en ≥2 entradas de LEARNINGS.md, se promueve aquí.*

## Lecciones recientes
*Últimas 5 entradas de `.claude/LEARNINGS.md` con `agent: frontend`. Se actualizan automáticamente al cierre de cada scope.*

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*

### Accionables del agente frontend

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A14** | NUNCA simplificar o reemplazar archivos existentes fuera del scope. Usar `edit` mínimo | **ALTA** |
| **A.1-A.5** | Validación empírica mobile: build Android, no red screen, UI elements, SSE flow, no regressions. Ver `.opencode/pipeline/validate-empirica.md` | **ALTA** |
