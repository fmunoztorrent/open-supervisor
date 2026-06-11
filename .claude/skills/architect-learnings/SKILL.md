---
name: architect-learnings
description: Aprendizajes acumulados del architect. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

## Reglas activas (validadas ≥2 veces)
*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea. Cuando un mismo patrón aparece en ≥2 entradas de LEARNINGS.md, se promueve aquí.*

## Lecciones recientes
- [2026-06-10] multi-scope-parallel-coordination — **Lección**: La paralelización multi-scope funciona cuando cada sub-agente recibe instrucciones explícitas de NO merge/dev/push/PR, los archivos no se solapan, y el cierre es coordinado centralmente por el orquestador.
- [2026-06-10] mobile-hook-url-vs-bff-controller-prefix — **Lección**: **Siempre** validar las rutas de los hooks mobile contra los `@Controller()` prefixes reales del BFF. No asumir prefijos como `/api/`. Verificar URLs exactas en tests.
- [2026-06-06] keycloak-openldap-auth-hexagonal-pattern — **Lección**: Para integrar OIDC externo en BFF NestJS hexagonal: usar `isAxiosError()` no `instanceof AxiosError` (mocks son objetos planos). El adapter recibe config strings de `ConfigService`, no hardcodea.
- [2026-06-06] learnings-skills-self-improvement-loop — **Lección**: Para que un sistema de auto-mejora sea efectivo, debe ser automático (triggers via hooks), idempotente (no duplica), y promover lecciones recurrentes a reglas activas.
- [2026-06-03] lsp-built-in-opencode-plugin-oficial-claude-code — **Lección**: LSP es built-in en opencode (`"lsp": true`). En Claude Code requiere `typescript-language-server` global + feature flag `ENABLE_LSP_TOOL` + plugin oficial.

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*
