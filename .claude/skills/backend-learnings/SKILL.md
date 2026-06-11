---
name: backend-learnings
description: Aprendizajes acumulados del backend engineer. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

# Backend Learnings

## Reglas activas (validadas ≥2 veces)
*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea. Cuando un mismo patrón aparece en ≥2 entradas de LEARNINGS.md, se promueve aquí.*

### Accionables del agente backend

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A10** | Durante resolución de conflictos de merge, usar `git merge --strategy-option=theirs` para archivos no conflictivos en vez de edit manual | **BAJA** |
| **A11** | Al modificar cualquier archivo `.ts` en servicios NestJS, el paso final del agente DEBE ser: `nest build && pkill -f "node dist/main" && node dist/main &`. No marcar la tarea como completada sin rebuild + restart | **ALTA** |
| **A12** | Después de restart, verificar con `lsof -i :<port> -P | grep LISTEN` + `curl -s -o /dev/null -w "%{http_code}" <healthcheck>` que el servicio responde antes de continuar | **ALTA** |

## Lecciones recientes
*Últimas 5 entradas de `.claude/LEARNINGS.md` con `agent: backend`. Se actualizan automáticamente al cierre de cada scope.*

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*
