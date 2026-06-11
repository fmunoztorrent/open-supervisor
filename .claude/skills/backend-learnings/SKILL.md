---
name: backend-learnings
description: Aprendizajes acumulados del backend engineer. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

## Reglas activas (validadas ≥2 veces)
- **quality-gate-metric-names-match-architect-contract-over-criteria** (x2, 2026-06-10) — **Lección**: cuando hay discrepancia entre las historias de usuario (que usan lenguaje funcional) y el contrato detallad

## Lecciones recientes
- [2026-06-05] specs-independientes-paralelizables-con-task-tool — **Lección**: Antes de lanzar sub-agentes en paralelo, verificar que no haya overlap de archivos entre los specs. Si dos specs modifican el mismo archivo, secuencializarlos.
- [2026-06-05] specs-tempranos-pueden-carecer-de-cierre-formal — **Lección**: Antes de asumir que un spec viejo está "sin implementar", verificar si el código correspondiente existe en el tree y los tests pasan.
- [2026-06-04] makefile-tsbuildinfo-wrong-filename — **Lección**: Al limpiar caches de TypeScript en scripts de build, usar wildcard (`tsconfig*.tsbuildinfo`) en lugar de nombres fijos. El nombre del `.tsbuildinfo` deriva del tsconfig usado.
- [2026-06-04] tsbuildinfo-stale-blocks-build-emission — **Lección**: El incremental build cache de TypeScript puede desincronizarse del output si el directorio de salida se limpia por un mecanismo externo a tsc. Limpiar `tsconfig*.tsbuildinfo` antes de cada build.

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*
