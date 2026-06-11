---
name: frontend-learnings
description: Aprendizajes acumulados del frontend engineer. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

## Reglas activas (validadas ≥2 veces)
*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea. Cuando un mismo patrón aparece en ≥2 entradas de LEARNINGS.md, se promueve aquí.*

## Lecciones recientes
- [2026-06-10] detox-e2e-testids-y-mock-server-js-ts-declarations — **Lección**:

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*

### Accionables del agente frontend

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A10** | Durante resolución de conflictos de merge, usar `git merge --strategy-option=theirs` para archivos no conflictivos en vez de edit manual | **BAJA** |
| **A11** | Al modificar cualquier archivo `.ts` en servicios NestJS, el paso final del agente DEBE ser: `nest build && pkill -f "node dist/main" && node dist/main &`. No marcar la tarea como completada sin rebuild + restart | **ALTA** |
| **A12** | Después de restart, verificar con `lsof -i :<port> -P | grep LISTEN` + `curl -s -o /dev/null -w "%{http_code}" <healthcheck>` que el servicio responde antes de continuar | **ALTA** |
| **E1** | Validación empírica mobile: build Android, no red screen, UI elements, SSE flow, no regressions. Ver `.opencode/pipeline/validate-empirica.md` | **ALTA** |
