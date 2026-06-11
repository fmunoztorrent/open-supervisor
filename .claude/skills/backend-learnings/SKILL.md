---
name: backend-learnings
description: Aprendizajes acumulados del backend engineer. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

## Reglas activas (validadas ≥2 veces)
*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea. Cuando un mismo patrón aparece en ≥2 entradas de LEARNINGS.md, se promueve aquí.*

## Lecciones recientes
- [2026-06-10] jest-coverage-directory-relative-to-rootdir-not-project-root — **Lección**: siempre verificar la ruta real del coverage generado después de configurar Jest. El `coverageDirectory` es 
- [2026-06-10] quality-gate-metric-names-match-architect-contract-over-criteria — **Lección**: cuando hay discrepancia entre las historias de usuario (que usan lenguaje funcional) y el contrato detallad
- [2026-06-05] specs-independientes-paralelizables-con-task-tool — **Lección**: Antes de lanzar sub-agentes en paralelo, verificar que no haya overlap de archivos entre los specs. Si dos specs modifican el mismo archivo, secuencializarlos.
- [2026-06-05] specs-tempranos-pueden-carecer-de-cierre-formal — **Lección**: Antes de asumir que un spec viejo está "sin implementar", verificar si el código correspondiente existe en el tree y los tests pasan.
- [2026-06-04] makefile-tsbuildinfo-wrong-filename — **Lección**: Al limpiar caches de TypeScript en scripts de build, usar wildcard (`tsconfig*.tsbuildinfo`) en lugar de nombres fijos. El nombre del `.tsbuildinfo` deriva del tsconfig usado.

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*
