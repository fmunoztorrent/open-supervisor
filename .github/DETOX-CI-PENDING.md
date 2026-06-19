# PENDIENTE: Job Detox (E2E + Emulator) en CI

> **Estado:** ⚠️ avanza hasta el boot del emulador. Las dos causas de código
> (shell del script y build nativo) están **resueltas y verificadas en CI**.
> El único blocker restante es **infra del emulador en CI**, no código del repo.
> **No bloquea formalmente el merge a `main`** (ver más abajo).

## Progreso (qué se resolvió)

El job `E2E (Detox + Emulator)` de `.github/workflows/ci.yml` falló en tres capas
sucesivas. Las dos primeras ya están corregidas:

| Capa | Síntoma original | Fix | Estado |
|---|---|---|---|
| 1. Shell del script | `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "detox:build" not found` — el `cd apps/mobile` no persistía entre líneas | Encadenar en un solo shell: `script: cd apps/mobile && pnpm detox:build && pnpm detox:test` | ✅ resuelto (commit `bea5f76`) — Gradle ahora corre 104 tasks |
| 2. Build nativo C++ | `no member named 'StyleSizeLength' in namespace 'facebook::yoga'` en `RNSVGLayoutableShadowNode.cpp` | Pin `react-native-svg` `15.15.5` → `15.12.1` (15.13+ dropeó el guard `REACT_NATIVE_MINOR_VERSION`; 15.12.1 mantiene el branch `<0.77` que usa `yoga::value::points`) | ✅ resuelto (commit `4507aff`) — APK compila e instala |
| 3. Boot del emulador | `##[error]Timeout waiting for emulator to boot.` — `getprop sys.boot_completed` siempre vacío | **pendiente** | ❌ blocker actual |

Run de referencia donde se ve el avance hasta la capa 3: `27847560853`
(sha `132275b`). Backend E2E pasó en verde en la misma corrida.

## Causa raíz del blocker actual (capa 3)

El step `Build APK + Run Detox tests` (`reactivecircus/android-emulator-runner@v2`)
arranca el emulador y hace polling de `sys.boot_completed`. En el runner
`ubuntu-latest` con la config actual el emulador **nunca completa el boot**:
arrancó a las `20:45:38` y siguió en polling (respuesta vacía) hasta el timeout
~15 min después. El log muestra intentos de cargar/guardar el snapshot
`default_boot`, sospechoso típico de cuelgue de boot.

Config actual del step:

```yaml
api-level: 34
target: google_apis
arch: x86_64
avd-name: open_supervisor
emulator-options: -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim
```

## Candidatos a probar (próxima sesión)

Cada ciclo de CI cuesta ~15 min. Probar de a uno, de mayor a menor probabilidad:

1. **Deshabilitar snapshots** (más probable): agregar `-no-snapshot` a
   `emulator-options` para evitar el cuelgue de carga/guardado de snapshot.
2. **`disable-animations: true`** como input del action.
3. **`force-avd-creation: false`** + `cores: 2` para acelerar/estabilizar el boot.
4. **Cambiar `target: google_apis` → `default`**: la imagen sin Google APIs
   suele bootear más rápido y la app no requiere GMS para los specs de Detox.
5. Subir `api-level` a 30/31 (imágenes históricamente más estables en CI).

## Cómo verificar

1. Aplicar el ajuste en `.github/workflows/ci.yml` (chore — sin spec).
2. Push a `dev` → dispara el workflow `CI` (corre en `push`/`pull_request` a `dev`).
3. Seguir el job:
   ```bash
   gh run list --branch dev --workflow CI --limit 1
   gh run view <run-id> --json jobs -q '.jobs[] | "\(.name): \(.status) \(.conclusion // "")"'
   gh run view --job <job-id> --log-failed   # log del step que falla
   ```

## Por qué NO bloquea formalmente el merge

`main` no tiene branch protection clásica; está gobernada por rulesets
(`contributors`, `only-admins`) cuyas reglas efectivas son: `pull_request`
(**0 aprobaciones**, sin reviewers obligatorios) + integridad
(`non_fast_forward`, `deletion`, `update`, `creation`). **No hay regla
`required_status_checks`** → ningún check es obligatorio. GitHub marca el PR como
`BLOCKED` por tener un check en rojo, pero un admin/owner puede mergear igual.

## Referencias

- Commits de esta tanda:
  - `bea5f76` — fix capa 1 (shell del script Detox).
  - `4507aff` — fix capa 2 (pin react-native-svg para RN 0.76.9).
- Commit que documentó originalmente el pendiente: `ba4923f`.
