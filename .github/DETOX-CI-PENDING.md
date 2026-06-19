# PENDIENTE: Job Detox (E2E + Emulator) en CI

> **Estado:** ❌ falla. Aislado para retomar en una sesión dedicada.
> **No bloquea formalmente el merge a `main`** (ver más abajo), pero deja el job en rojo.

## Contexto

El job `E2E (Detox + Emulator)` de `.github/workflows/ci.yml` **nunca se había
ejecutado de verdad**: corre `needs: validate`, y el job `validate` siempre moría
en el step `Run lint` (lint nunca estuvo configurado). Al arreglar lint
(commit `e09ef19`), `validate` pasó por primera vez y Detox finalmente corrió —
exponiendo este bug.

Detox **sí está configurado** en el repo: dependencia `detox@^20.51.3`,
`apps/mobile/.detoxrc.js`, specs en `apps/mobile/e2e/` (`01-login`, `02-list`,
`03-decision`), `jest.config.js`, `mock-server` y los scripts
`detox:build` / `detox:test` en `apps/mobile/package.json`. El problema es del
**workflow**, no de la configuración de Detox.

## Causa raíz

El `script:` del step `Build APK + Run Detox tests`
(`reactivecircus/android-emulator-runner`) corre cada línea en un **shell
separado**, así que el `cd apps/mobile` no persiste:

```yaml
script: |
  cd apps/mobile      # ← este cd se pierde
  pnpm detox:build    # ← corre en la raíz del repo
  pnpm detox:test
```

Resultado en el log de CI:

```
/usr/bin/sh -c cd apps/mobile
/usr/bin/sh -c pnpm detox:build
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "detox:build" not found
Did you mean "pnpm build"?
##[error]The process '/usr/bin/sh' failed with exit code 1
```

`pnpm detox:build` se ejecuta desde la raíz (donde no existe ese script) en vez
de desde `apps/mobile`.

## Fix candidato (1 línea)

Encadenar con `&&` en una sola línea para que el `cd` persista en el mismo shell:

```yaml
script: cd apps/mobile && pnpm detox:build && pnpm detox:test
```

**Importante:** este fix sólo resuelve el `cd`. Es la **primera ejecución real**
de Detox en CI, así que el build del APK (Gradle), el boot del emulador, el
`mock-server` y los specs podrían destapar problemas adicionales. Presupuestar
varios ciclos (~11 min cada uno) y revisar el log completo en cada iteración.

## Cómo verificar

1. Aplicar el fix en `.github/workflows/ci.yml` (chore — sin spec).
2. Push a `dev` → dispara el workflow `CI` (corre en `push`/`pull_request` a `dev`).
3. Seguir el job:
   ```bash
   gh run list --branch dev --workflow CI --limit 1
   gh run view <run-id> --json jobs -q '.jobs[] | "\(.name): \(.status) \(.conclusion // "")"'
   gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs   # log crudo si falla
   ```

## Por qué NO bloquea formalmente el merge

`main` no tiene branch protection clásica; está gobernada por rulesets
(`contributors`, `only-admins`) cuyas reglas efectivas son: `pull_request`
(**0 aprobaciones**, sin reviewers obligatorios) + integridad
(`non_fast_forward`, `deletion`, `update`, `creation`). **No hay regla
`required_status_checks`** → ningún check es obligatorio. GitHub marca el PR como
`BLOCKED` por tener un check en rojo, pero un admin/owner puede mergear igual.

## Referencias

- Rama de trabajo: `dev` (PR #20 → `main`).
- Commits relacionados de esta tanda:
  - `e09ef19` — ESLint baseline (causa de que Detox por fin corriera).
  - `339610d` — de-flake tests de health.
  - `5673cd1` — barrera de readiness de Kafka en el e2e backend.
- Checks de PR #20 al momento de aislar esto: Tests+Typecheck+Lint ✅,
  Backend E2E ✅, Quality Gate ✅, **Detox ❌**.
