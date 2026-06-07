# Spec: Mutation Testing con StrykerJS

**Fecha**: 2026-06-06
**Scope**: `mutation-testing-setup`
**Tipo**: chore
**Capa**: 1 (independiente, paralelizable)

## Objetivo

Integrar Stryker Mutator en los 3 servicios backend (`authorization-service`, `sse-server`, `bff`) para detectar tests débiles identificando mutantes que sobreviven.

## Archivos a crear/modificar

| # | Archivo | Acción |
|---|---|---|
| 1 | `apps/authorization-service/stryker.config.mjs` | Crear |
| 2 | `apps/sse-server/stryker.config.mjs` | Crear |
| 3 | `apps/bff/stryker.config.mjs` | Crear |
| 4 | `apps/authorization-service/package.json` | Modificar: agregar script `test:mutation` |
| 5 | `apps/sse-server/package.json` | Modificar: agregar script `test:mutation` |
| 6 | `apps/bff/package.json` | Modificar: agregar script `test:mutation` |
| 7 | `package.json` (root) | Modificar: agregar script `test:mutation` |
| 8 | `.claude/skills/mutation-testing/SKILL.md` | Crear |

## Dependencias a instalar

En cada uno de los 3 servicios backend:
- `@stryker-mutator/core`
- `@stryker-mutator/jest-runner`
- `@stryker-mutator/typescript-checker`

## Configuración

### stryker.config.mjs (template)
```js
export default {
  packageManager: "pnpm",
  testRunner: "jest",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.spec.json", // bff usa "tsconfig.json"
  mutate: ["src/**/*.ts", "!src/**/*.spec.ts", "!src/**/__tests__/**"],
  reporters: ["progress", "clear-text", "html"],
  thresholds: { high: 80, low: 50, break: null },
  coverageAnalysis: "perTest",
};
```

### Particularidades por servicio
- **authorization-service**: `tsconfigFile: "tsconfig.spec.json"` (ya existe)
- **sse-server**: `tsconfigFile: "tsconfig.spec.json"` (ya existe)
- **bff**: `tsconfigFile: "tsconfig.json"` (no tiene spec tsconfig)

## Skill mutation-testing
Documenta:
- Cómo correr (`pnpm test:mutation` o por servicio)
- Cómo leer el reporte HTML (`reports/mutation.html`)
- Significado de thresholds
- Integración con QA GREEN → RED

## Verificación

1. `pnpm test:mutation` en cada servicio — Stryker corre sin errores de configuración
2. El reporte HTML se genera en `reports/mutation.html`
3. Typecheck pasa: `pnpm typecheck`

## Resultado (scope mutation-testing-setup)

- **Completado**: 2026-06-06
- **Archivos creados**: 3 stryker.config.mjs + 1 skill
- **Archivos modificados**: 4 package.json (scripts `test:mutation`)
- **Dependencias instaladas**: `@stryker-mutator/core ^9.6.1`, `@stryker-mutator/jest-runner ^9.6.1`, `@stryker-mutator/typescript-checker ^9.6.1` en los 3 servicios
- **Desviaciones**: Se agregó `plugins: ["@stryker-mutator/jest-runner", "@stryker-mutator/typescript-checker"]` explícito en cada stryker.config.mjs para compatibilidad con pnpm workspaces (los child processes de Stryker no resuelven plugins automáticamente con la estructura de node_modules de pnpm)
- **Verificación**: Typecheck ✅ (7/7 servicios), dry run Stryker ✅ (32 archivos, 411 mutantes, 92 tests)
- **Tests**: No se agregaron tests (chore de infraestructura)

## Dependencias entre scopes

| Scope | Depende de | Capa |
|---|---|---|
| `mutation-testing-setup` | — | 1 |
| `learnings-skills-setup` | — | 1 |
| `qa-green-red-integration` | mutation-testing-setup, learnings-skills-setup | 2 |
