---
name: frontend-learnings
description: Aprendizajes acumulados del frontend engineer. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

## Reglas activas (validadas ≥2 veces)
*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea. Cuando un mismo patrón aparece en ≥2 entradas de LEARNINGS.md, se promueve aquí.*

## Lecciones recientes
- [2026-06-08] reintegrar-login-huerfano-en-app-tsx — **Lección**: cuando un gate de auth envuelve la app, TODOS los tests que renderizan `<App/>` y esperan la pantalla inter

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*

### Accionables del agente frontend

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A14** | NUNCA simplificar o reemplazar archivos existentes fuera del scope. Usar `edit` mínimo | **ALTA** |
| **A.1-A.5** | Validación empírica mobile: build Android, no red screen, UI elements, SSE flow, no regressions. Ver `.opencode/pipeline/validate-empirica.md` | **ALTA** |
