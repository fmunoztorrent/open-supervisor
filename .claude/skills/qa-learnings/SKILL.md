---
name: qa-learnings
description: Aprendizajes acumulados del QA engineer. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

## Reglas activas (validadas ≥2 veces)
- **cleanup-ts-expect-error-after-red-phase** (x2, 2026-06-10) — **Lección**: **Siempre** hacer una pasada de limpieza de `@ts-expect-error` después de la implementación. Los directives de FASE RED deben eliminarse en FASE 4. El typecheck falla con `TS2578: Unused '@ts-expect-error' directive` si quedan artifacts.

## Lecciones recientes
- [2026-06-04] prevencion-hardcodeos-tres-capas-enforcement — **Lección**: Tres capas de defensa contra hardcodeos: plugin opencode en tiempo real + pre-commit hook + script standalone. Compartir patrones en JSON centralizado con allowlist.
- [2026-06-04] despersonalizacion-harness-settings-local — **Lección**: Separar configuración en `settings.json` (portable, trackeado) y `settings.local.json` (personal, no trackeado). Para compose files, usar variables de entorno en lugar de rutas hardcodeadas.
- [2026-06-03] rntl-matchers-requieren-types-en-tsconfig-y-global-d-ts — **Lección**: En RN + Jest + RNTL, el tsconfig necesita `"types": ["jest", "@testing-library/react-native/extend-expect"]`. Crear `src/global.d.ts` con `declare var global: typeof globalThis`.
- [2026-06-02] typecheck-tsc-falla-sin-baseurl-en-tsconfig-json — **Lección**: `tsc` ignora `paths` sin `baseUrl` en tsconfig. En FASE GREEN, distinguir fallos preexistentes de typecheck (TS2307 en workspace packages) de regresiones reales introducidas por la feature.
- [2026-06-02] sse-server-necesita-tsconfig-spec-para-jest — **Lección**: Cualquier servicio que agregue tests con workspace packages necesita `moduleNameMapper` en jest config + `tsconfig.spec.json` con `baseUrl` y `paths`. ts-jest resuelve tipos desde tsconfig, no desde moduleNameMapper.

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*
