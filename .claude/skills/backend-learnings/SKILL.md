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
- [2026-06-05] specs-independientes-paralelizables-con-task-tool — **Lección**: Antes de lanzar sub-agentes en paralelo, verificar que no haya overlap de archivos entre los specs. Si dos specs modifican el mismo archivo, secuencializarlos.
- [2026-06-05] specs-tempranos-pueden-carecer-de-cierre-formal — **Lección**: Antes de asumir que un spec viejo está "sin implementar", verificar si el código correspondiente existe en el tree y los tests pasan.
- [2026-06-04] makefile-tsbuildinfo-wrong-filename — **Lección**: Al limpiar caches de TypeScript en scripts de build, usar wildcard (`tsconfig*.tsbuildinfo`) en lugar de nombres fijos. El nombre del `.tsbuildinfo` deriva del tsconfig usado.
- [2026-06-04] tsbuildinfo-stale-blocks-build-emission — **Lección**: El incremental build cache de TypeScript puede desincronizarse del output si el directorio de salida se limpia por un mecanismo externo a tsc. Limpiar `tsconfig*.tsbuildinfo` antes de cada build.
- [2026-06-04] podman-compose-delegates-to-docker-compose-breaking-make-dev — **Lección**: Siempre preferir `podman-compose` (Python) sobre `podman compose` (subcomando CLI) en entornos macOS donde puede coexistir Docker Compose.

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*
