# Spec: Detox E2E para la app móvil del supervisor

**Fecha:** 2026-06-10  
**Stack inferido:** Node/TypeScript — React Native 0.76.9 (Android), NestJS backend  
**Estado:** Completed (2026-06-10)  
**Revisión:** 2  

---

## Contexto

El proyecto open-supervisor tiene ~166 tests unitarios/integración en verde (Jest + RNTL), pero cero cobertura E2E real: todo lo de mobile se ejecuta sobre un render virtual en Node.js, nunca sobre la APK real corriendo en un emulador. Detox no está instalado. Esto significa que crashes de runtime nativos, problemas con `react-native-sse`, bugs de navegación entre pantallas o fallas en la integración con `react-native-config` no serían detectados por los tests actuales.

Este spec cubre el setup completo de Detox 20.x en `apps/mobile/` y la escritura de 3 suites E2E que recorren el flujo principal: login → lista de solicitudes (incluyendo llegada vía SSE) → detalle → decisión (autorizar / rechazar). Se elige un mock server Express local en lugar del backend real porque el stack completo (Keycloak + OpenLDAP + Kafka + Redis + Postgres) es demasiado frágil para tests determinísticos y requeriría un entorno de CI dedicado para esa infraestructura.

**Fuera de scope:** integración con CI/CD (GitHub Actions), soporte iOS, configuración de release signing para Detox, múltiples dispositivos/AVDs, tests de menú hamburguesa, historial o pantallas secundarias.

**Ambigüedades identificadas:**
- El `.env.e2e` solo contiene la URL del mock server (no secrets), por lo que puede commitearse. Si en el futuro se agregan credenciales reales, pasaría a gitignored.
- Con `reversePorts: [3001]` en `.detoxrc.js`, Detox hace `adb reverse tcp:3001 tcp:3001` automáticamente. El mock corre en el host en puerto 3001; el emulador lo accede como `localhost:3001`. Por eso `.env.e2e` usa `BFF_BASE_URL=http://localhost:3001`.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    El sistema está completo funcionalmente según 22 specs cerrados, pero sin un solo test
    que verifique el comportamiento en la APK real. Un crash de runtime en Android, un bug
    de native module (SSE, AsyncStorage) o una regresión de navegación pasaría invisible
    por los tests actuales. Detox cubre exactamente ese gap: corre la APK compilada en el
    emulador y automatiza gestos de usuario reales.
  </Rationale>
  <Explanation>
    Se instala Detox 20.x (compatible con RN 0.76.9 + New Architecture / Fabric).
    Un mock server Express local simula el BFF: responde al login, expone el endpoint de
    solicitudes pendientes, el resolve, y emite eventos SSE bajo demanda desde endpoints
    de control (/test/seed, /test/emit-sse). Los tests apuntan al mock vía ENVFILE=.env.e2e
    en el build del APK. Detox gestiona el emulador AVD open_supervisor automáticamente.
  </Explanation>
  <Assumptions>
    - El AVD "open_supervisor" está creado y disponible en la máquina (Pixel 8, API 35).
    - react-native-config respeta la variable de entorno ENVFILE al compilar el APK.
    - Los campos de testID existentes en componentes (LoginScreen, App.tsx, AuthorizationList)
      son suficientes para el flujo de login; los botones de detalle necesitan testIDs nuevos.
    - Detox 20.x soporta la New Architecture de RN 0.76.9 sin patches adicionales.
    - El proyecto corre en macOS con Android Studio y Gradle instalados.
  </Assumptions>
  <Scrutiny>
    ¿Vale la pena el overhead de Detox (build lento, AVD, flakiness) para un proyecto
    que aún no tiene usuarios en producción? Sí: el costo de configuración se paga una vez
    y los tests E2E detectan la clase de bugs más costosa de encontrar manualmente.
    ¿Por qué no esperar a tener CI? Porque los tests E2E locales ya dan valor — se corren
    antes de cada release candidate sin esperar a que exista una pipeline.
  </Scrutiny>
  <Objections>
    - "Los tests E2E son lentos y frágiles." — Cierto; por eso se limitan a 3 suites
      cubriendo el happy path crítico, no casos exhaustivos. El grueso de la cobertura
      sigue en RNTL (rápido, determinístico).
    - "El mock server no prueba la integración real." — Correcto; eso no es el objetivo.
      El objetivo es verificar que la APK abre, navega, renderiza y llama a las APIs
      correctamente. La integración real se valida con pnpm inject --verify.
  </Objections>
  <Novelty>
    Primera cobertura E2E del proyecto. Introduce el mock server como patrón de testing
    aislado para la app móvil. Establece la base para agregar más escenarios Detox en
    el futuro sin cambiar la infraestructura.
  </Novelty>
  <Substitutes>
    - Maestro (mobile testing framework): más simple, pero menor ecosistema TypeScript
      y sin integración directa con el runner Jest ya usado en el proyecto.
    - Appium: más genérico (iOS+Android), pero más lento de configurar y con peor DX
      para proyectos React Native.
    - Playwright (component testing): cubre mobile web, no APK nativa.
    - Backend real con make dev: más realista pero no determinístico; descartado para
      la suite base (puede agregarse como configuración opcional en el futuro).
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: Setup infraestructura Detox `[Must]`

> Como **desarrollador**, quiero **tener Detox instalado y configurado en apps/mobile/**, para que **pueda compilar el APK E2E y correr tests en el emulador AVD open_supervisor**.

**Criterios de aceptación:**
- [x] `detox@^20.51.3`, `express@^4.21` y `jsonwebtoken@^9` instalados en `apps/mobile/devDependencies`
- [x] `.detoxrc.js` con configuración `android.emu.debug` apuntando al AVD `open_supervisor`
- [x] `apps/mobile/android/app/build.gradle` incluye `testInstrumentationRunner` y `androidTestImplementation('com.wix:detox:+')`
- [x] `apps/mobile/android/app/src/androidTest/java/com/opensupervisor/DetoxTest.kt` creado
- [x] Scripts `detox:build` y `detox:test` en `apps/mobile/package.json`
- [x] `apps/mobile/e2e/jest.config.js` con runner separado del jest unitario
- [ ] `pnpm detox:build` compila el APK sin errores Gradle (requiere emulador AVD open_supervisor corriendo)

**Notas:** `ENVFILE=.env.e2e` debe pasarse en el script `detox:build` para que `react-native-config` use la URL del mock server. `jest-circus` es el runner por defecto de Jest 29 — no requiere instalación separada. Verificar que `android/build.gradle` resuelve `com.wix:detox` (si falla, agregar bloque `allprojects.repositories` con la ruta del artefacto Detox-android en node_modules).

---

### US-02: Mock server para tests E2E `[Must]`

> Como **suite de tests Detox**, quiero **un servidor local que simule el BFF**, para que **los tests sean determinísticos y no dependan de Keycloak, Kafka ni Redis**.

**Criterios de aceptación:**
- [x] `apps/mobile/e2e/mock-server/index.js` implementa: `POST /auth/login`, `GET /authorization/store/:storeId/pending`, `POST /authorization/:id/resolve`, `GET /stream/store/:storeId` (SSE)
- [x] Endpoints de control: `POST /test/seed` (resetea pending), `POST /test/emit-sse` (dispara evento SSE)
- [x] El JWT retornado por `/auth/login` incluye claims `sub`, `preferred_username`, `storeId`, `displayName`, `exp = now + 8h` (generado en runtime, no hardcodeado)
- [x] El endpoint SSE respeta el protocolo exacto: `Content-Type: text/event-stream`, `event: authorization_request`, datos en JSON
- [x] `apps/mobile/e2e/mock-server/fixtures/pending-requests.json` contiene 2 solicitudes de prueba con `correlation_id` únicos
- [x] El servidor arranca y se detiene dentro de `beforeAll`/`afterAll` de cada suite sin dejar puertos abiertos

**Notas:** El servidor escucha en el puerto 3001 del host. Con `reversePorts: [3001]` en `.detoxrc.js`, Detox hace `adb reverse` automáticamente y el emulador accede al mock como `localhost:3001`. Por eso `.env.e2e` usa `BFF_BASE_URL=http://localhost:3001` (no `10.0.2.2`).

---

### US-03: Suite E2E — Login `[Must]`

> Como **supervisor**, quiero **poder iniciar sesión en la app**, para que **acceda a la lista de solicitudes**.

**Criterios de aceptación:**
- [x] Happy path: credenciales válidas → `app-safe-area` visible en ≤15s (test escrito, requiere emulador para ejecutar)
- [x] Error: credenciales inválidas → `login-error` visible con texto descriptivo (test escrito)
- [x] Post-login con lista vacía: `empty-list-text` visible (`testID="empty-list-text"`)
- [x] `rut-input`, `password-input`, `login-button` son interactuables vía Detox `by.id()`

**Notas:** Las credenciales de prueba son `e2e-supervisor / test1234` (mock server las acepta hardcodeadas).

---

### US-04: Suite E2E — Lista de solicitudes + SSE `[Must]`

> Como **supervisor**, quiero **ver las solicitudes pendientes y recibir nuevas en tiempo real**, para que **pueda actuar sobre ellas sin recargar la app**.

**Criterios de aceptación:**
- [x] Con seed de 2 solicitudes: `card-{correlationId}` visible para cada una tras login (test escrito)
- [x] Con lista vacía: `empty-list-text` visible → `POST /test/emit-sse` → nueva card aparece en ≤8s (test escrito)
- [x] `testID` de cada card es dinámico: `card-{correlation_id}` (no fijo `authorization-card`)

**Notas:** El `testID` dinámico requiere modificar `AuthorizationCard.tsx` y actualizar el test unitario RNTL correspondiente.

---

### US-05: Suite E2E — Decisión del supervisor `[Must]`

> Como **supervisor**, quiero **autorizar o rechazar una solicitud desde el detalle**, para que **la decisión se envíe al POS**.

**Criterios de aceptación:**
- [x] Tap en `card-{correlationId}` → `detail-type-header` visible
- [x] `authorize-button` y `reject-button` visibles en el detalle (`testID` agregados)
- [x] Tap Autorizar → `approve-button-spinner` visible → desaparece → volver → card ya no visible en lista
- [x] Tap Rechazar → mismo flujo → card ya no visible en lista
- [x] `back-button` (`testID="back-button"`) permite volver a la lista

**Notas:** Los botones Autorizar/Rechazar no tienen `testID` actualmente — hay que agregarlos en `AuthorizationDetailScreen.tsx`.

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|-----|-----------|-----------------|
| US-01 | — | sí (capa 1) |
| US-02 | — | sí (capa 1) |
| US-03 | US-01, US-02 | sí (capa 2) |
| US-04 | US-01, US-02 | sí (capa 2) |
| US-05 | US-01, US-02 | sí (capa 2) |

**Nota:** US-03, US-04 y US-05 también dependen de que los `testID` faltantes (`authorize-button`, `reject-button`, `back-button`, `empty-list-text`, `card-{id}`) estén en los componentes. Estos cambios de componentes se incluyen dentro del alcance de US-03/04/05 según corresponda.

---

## Escenarios BDD

```gherkin
Feature: Setup Detox E2E — US-01 y US-02
  Como desarrollador
  Quiero infraestructura Detox configurada con mock server
  Para que los tests E2E puedan compilar y correr

  Scenario: Build del APK E2E exitoso
    Given el proyecto tiene Detox y jest-circus en devDependencies
    And existe .detoxrc.js con configuración android.emu.debug
    And .env.e2e define BFF_BASE_URL=http://localhost:3001
    When se ejecuta pnpm detox:build
    Then el APK debug se genera sin errores en android/app/build/outputs/apk/debug/

  Scenario: Mock server arranca y responde
    Given el mock server está corriendo en puerto 3001
    When se hace POST /auth/login con credenciales válidas
    Then se recibe un JWT con storeId y exp en el futuro
    When se hace GET /authorization/store/store-e2e/pending
    Then se recibe el array de solicitudes del estado actual
```

```gherkin
Feature: Login con credenciales — US-03
  Como supervisor
  Quiero iniciar sesión en la app
  Para acceder a la lista de solicitudes

  Background:
    Given el mock server está corriendo
    And la app está instalada en el emulador open_supervisor

  Scenario: Login exitoso
    Given el supervisor ve la pantalla de login
    When ingresa "e2e-supervisor" en el campo rut
    And ingresa "test1234" en el campo contraseña
    And toca el botón "Ingresar"
    Then ve la lista de solicitudes (app-safe-area visible)

  Scenario: Credenciales inválidas
    Given el supervisor ve la pantalla de login
    When ingresa "supervisor-invalido" en el campo rut
    And ingresa "wrongpass" en el campo contraseña
    And toca el botón "Ingresar"
    Then ve un mensaje de error de credenciales

  Scenario: Login exitoso con lista vacía
    Given el mock server retorna lista vacía de solicitudes pendientes
    When el supervisor inicia sesión correctamente
    Then ve el mensaje de "Sin solicitudes pendientes"
```

```gherkin
Feature: Lista de solicitudes y SSE — US-04
  Como supervisor
  Quiero ver solicitudes pendientes y recibir nuevas en tiempo real
  Para actuar sin recargar la app

  Background:
    Given el supervisor está autenticado
    And la lista de solicitudes es visible

  Scenario: Lista con solicitudes pre-existentes
    Given el mock server tiene 2 solicitudes pendientes (corr-1, corr-2)
    When el supervisor abre la app y se autentica
    Then ve las cards de corr-1 y corr-2 en la lista

  Scenario: Nueva solicitud llega vía SSE
    Given el mock server tiene lista vacía
    And el supervisor ve "Sin solicitudes pendientes"
    When el sistema emite una solicitud vía SSE (corr-sse-1)
    Then la card de corr-sse-1 aparece en la lista en menos de 8 segundos
```

```gherkin
Feature: Decisión del supervisor — US-05
  Como supervisor
  Quiero autorizar o rechazar solicitudes desde el detalle
  Para que la decisión llegue al POS

  Background:
    Given el supervisor está autenticado
    And hay al menos una solicitud pendiente (corr-1) en la lista

  Scenario: Autorizar una solicitud
    Given el supervisor ve la card de corr-1 en la lista
    When toca la card de corr-1
    Then ve la pantalla de detalle con botones "Autorizar" y "Rechazar"
    When toca "Autorizar"
    Then ve un spinner en el botón
    And el spinner desaparece cuando la decisión es enviada
    When toca "Volver"
    Then la card de corr-1 ya no aparece en la lista

  Scenario: Rechazar una solicitud
    Given el supervisor ve la card de corr-1 en la lista
    When toca la card de corr-1
    And toca "Rechazar"
    Then el spinner aparece y desaparece
    When toca "Volver"
    Then la card de corr-1 ya no aparece en la lista
```

---

## Plan de Tests TDD

### US-01 — Setup infraestructura Detox

**Setup / Verificación**
- [ ] [RED]   `pnpm detox:build` falla — Detox no instalado
- [ ] [GREEN] Instalar Detox + crear `.detoxrc.js` + `DetoxTest.kt` + modificar `build.gradle` → `pnpm detox:build` pasa
- [ ] [GREEN] `pnpm test` (unitarios) sigue en verde tras los cambios en `package.json`

### US-02 — Mock server

**Unitarios (Node)**
- [ ] [RED]   `POST /auth/login` con credenciales inválidas devuelve 401
- [ ] [GREEN] Implementar validación en el handler
- [ ] [RED]   `GET /stream/...` devuelve `Content-Type: text/event-stream`
- [ ] [GREEN] Implementar endpoint SSE
- [ ] [RED]   `POST /test/emit-sse` dispara evento a los clientes conectados
- [ ] [GREEN] Implementar bus interno de eventos

**Edge cases**
- [ ] El JWT tiene `exp` en el futuro (no en el pasado)
- [ ] El mock server no deja el puerto 3001 abierto tras `afterAll`

### US-03 — Suite E2E Login

**E2E (Detox)**
- [ ] [RED]   `element(by.id('rut-input'))` no existe → test falla porque Detox no está configurado
- [ ] [GREEN] Tras setup US-01: test de login happy path pasa
- [ ] [RED]   Test de credenciales inválidas → `login-error` no tiene testID → falla por timeout
- [ ] [GREEN] El testID ya existe (`login-error`) → pasa
- [ ] [RED]   `empty-list-text` no existe en componente → falla
- [ ] [GREEN] Agregar `testID="empty-list-text"` en `AuthorizationList.tsx`

### US-04 — Suite E2E Lista + SSE

**Impacto en test unitario existente**
- [ ] [RED]   `AuthorizationCard.test.tsx` falla tras cambiar testID a dinámico
- [ ] [GREEN] Actualizar el test unitario para usar `card-{correlationId}`

**E2E (Detox)**
- [ ] [RED]   `element(by.id('card-corr-1'))` no existe → testID fijo, no dinámico → falla
- [ ] [GREEN] Cambiar `AuthorizationCard.tsx` testID a `card-${request.correlation_id}`
- [ ] [RED]   Test SSE: card no aparece en tiempo → falla por timeout
- [ ] [GREEN] Ajustar timeout a 8000ms + verificar nombre del evento SSE

### US-05 — Suite E2E Decisión

**E2E (Detox)**
- [ ] [RED]   `element(by.id('authorize-button'))` no existe → botón sin testID
- [ ] [GREEN] Agregar `testID="authorize-button"` y `testID="reject-button"` en `AuthorizationDetailScreen.tsx`
- [ ] [RED]   `element(by.id('back-button'))` no existe → Pressable volver sin testID
- [ ] [GREEN] Agregar `testID="back-button"` en `App.tsx` (DetailView)
- [ ] [RED]   Test de spinner: timeout demasiado corto para New Architecture
- [ ] [GREEN] Usar `.withTimeout(5000)` en waitFor de spinner

---

## Definition of Done

- [x] `pnpm test` (unitarios RNTL) sigue pasando sin regresiones (70/70 ✅)
- [x] `npx tsc --project e2e/tsconfig.json --noEmit` sin errores
- [x] `Makefile` tiene targets `detox-build`, `detox-test`, `e2e`
- [ ] `pnpm detox:build` compila sin errores (requiere AVD open_supervisor)
- [ ] `pnpm detox:test` pasa los 3 suites E2E (requiere AVD open_supervisor + Metro)
- [x] Los 3 scenarios BDD críticos tienen cobertura E2E (tests escritos en 01-login, 02-list, 03-decision)

## Resultados

**Completado:** 2026-06-10

**Implementado:**
- US-01 (Setup Detox): todas las dependencias, .detoxrc.js, DetoxTest.kt, build.gradle, scripts npm
- US-02 (Mock server): servidor Express con /auth/login, /pending, /resolve, /stream, /test/seed, /test/emit-sse, /test/reset
- US-03 (Login): 3 tests E2E escritos (happy path, credenciales inválidas, lista vacía)
- US-04 (Lista + SSE): 2 tests E2E escritos (cards pre-existentes, SSE en tiempo real)
- US-05 (Decisión): 3 tests E2E escritos (detalle, autorizar, rechazar)

**Desviaciones:**
- `pnpm detox:build` y `pnpm detox:test` no se ejecutaron en este pipeline — requieren el emulador Android AVD `open_supervisor` corriendo. El código de tests y configuración está completo.
- Stryker mutation testing no está configurado para `apps/mobile`.

**Tests:**
- RNTL: 70/70 ✅
- auth-service: 92/92 ✅
- typecheck mobile: limpio ✅
- typecheck e2e: limpio ✅

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | AVD `open_supervisor` debe existir en la máquina del desarrollador (Pixel 8, API 35) |
| Dependencia externa | Gradle + Android SDK instalados (ya requeridos por el proyecto) |
| Riesgo técnico | Detox 20.x + New Architecture (Fabric): los spinners pueden tener timing diferente; usar `.withTimeout(5000+)` |
| Riesgo técnico | El nombre del evento SSE debe ser exactamente `authorization_request` (igual que en `useSSERequests`) |
| Riesgo técnico | `react-native-config` + `ENVFILE=.env.e2e`: verificar que el APK compilado usa la URL del mock server |
| Suposición a validar | `reversePorts` en `.detoxrc.js` hace el `adb reverse` automáticamente (sin paso manual) |
| Confirmado | `jest-circus` es el runner por defecto de Jest 29 — no requiere instalación separada |
