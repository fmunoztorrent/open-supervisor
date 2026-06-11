# LEARNINGS.md

Log de aprendizajes del equipo open-supervisor. **Append-only** — nunca edites entradas pasadas. Si algo queda obsoleto, agrega una nueva entrada que lo supersede.

## Propósito

Cada agente lee este archivo al comenzar (filtrando por su rol y categorías relevantes) y agrega una entrada al cerrar si aprendió algo no obvio: una API sorpresiva, un error corregido, una decisión validada por el usuario, un patrón que funcionó bien.

## Instrucciones

**Al comenzar una tarea**: busca entradas cuya `category` y `tags` sean relevantes a tu rol y al trabajo que vas a hacer. Aplica las lecciones para no repetir errores pasados.

**Al cerrar una tarea**: agrega una entrada si — y solo si — aprendiste algo que no es obvio leyendo el código o la documentación estándar. No documentes lo obvio.

## Template de entrada

```markdown
---
date: YYYY-MM-DD
agent: architect | spec | backend | frontend | qa
category: setup | pattern | api-gotcha | test-strategy | security-finding | spec-process | user-feedback
tags: [nestjs, kafka, react-native, sse, detox, ...]
slug: descripcion-corta-en-kebab-case
---

**Contexto**: qué estaba haciendo cuando lo descubrí.
**Qué pasó**: el comportamiento sorpresivo, el error, o la decisión.
**Lección**: qué hacer / no hacer en el futuro.
**Cómo aplicar**: en qué situaciones específicas recordar esto.
```

## Categorías sugeridas

| Categoría | Cuándo usarla |
|---|---|
| `setup` | Configuración inicial de herramientas, monorepo, build, CI |
| `pattern` | Patrón de código o arquitectura validado en este proyecto |
| `api-gotcha` | API de librería que se comporta diferente a lo documentado o esperado |
| `test-strategy` | Estrategia de test no obvia: cómo mockear ports NestJS, setup Detox Android, etc. |
| `security-finding` | Hallazgo de seguridad relevante para el equipo |
| `spec-process` | Algo sobre el proceso de spec que mejoró o empeoró la calidad |
| `user-feedback` | Decisión o preferencia del usuario que debe mantenerse en el tiempo |

---

<!-- Las entradas van debajo de esta línea, más recientes al final -->

---
date: 2026-06-04
agent: qa
category: api-gotcha
tags: [nestjs, rest, correlationId, repository, in-memory, domain-id]
slug: resolve-endpoint-debe-buscar-por-correlationId-no-por-id-interno
---

**Contexto**: prueba empírica en emulador — el botón "Autorizar" devolvía HTTP 500/404 aunque la solicitud existía en el auth-service.
**Qué pasó**: el endpoint `POST /authorization/:id/resolve` en auth-service hacía `repository.findById(id)`, pero `:id` es el `correlationId` (identificador de negocio que viaja por Kafka, BFF y móvil). El `id` interno del entity (generado por el repositorio) es distinto. El fix: añadir `findByCorrelationId()` al port y al repositorio; el use-case lo llama con el correlationId.
**Lección**: en sistemas con dos identificadores (id interno vs. correlationId de negocio), los endpoints REST de dominio deben exponer siempre el identificador de negocio — no el id de persistencia. El id interno es un detalle de infra que no debería cruzar las capas.
**Cómo aplicar**: al agregar un endpoint REST que resuelve/actualiza una entidad, verificar qué identificador conoce el caller (BFF, client) y asegurarse de que el port del repositorio expone `findBy<BusinessKey>()`.

---
date: 2026-06-04
agent: frontend
category: api-gotcha
tags: [react-native, bff, camelCase, snake_case, normalization, useSSERequests]
slug: bff-retorna-camelCase-pero-dto-espera-snake-case
---

**Contexto**: emulador mostraba "NaN/NaN NaN:NaN" en las fechas de las cards y la navegación al detalle no funcionaba.
**Qué pasó**: el BFF devuelve camelCase (`storeId`, `correlationId`, `createdAt`) desde el auth-service (NestJS serializa entidades en camelCase). Pero `AuthorizationRequestDto` usa snake_case (`store_id`, `correlation_id`, `created_at`). En `useSSERequests`, el GET /pending y los eventos SSE se parseaban directamente como `AuthorizationRequestDto` sin normalizar, dejando todos los campos clave en `undefined`.
**Lección**: el contrato Kafka (snake_case en `AuthorizationRequestDto`) y el contrato REST/SSE del BFF (camelCase en la serialización NestJS) son diferentes. Cualquier cliente que consuma el BFF debe normalizar. No asumir que el DTO del backend y el payload HTTP tienen el mismo casing.
**Cómo aplicar**: al agregar un nuevo endpoint en el BFF que retorne entidades, agregar una función `normalizeXxx(raw: any)` en el hook que lo consume para mapear camelCase → snake_case. Patrón: `raw.snake_field ?? raw.camelField`.

---
date: 2026-06-04
agent: qa
category: test-strategy
tags: [android, emulator, adb, uiautomator, coordinates, tap]
slug: usar-uiautomator-dump-para-coordenadas-exactas-de-botones
---

**Contexto**: prueba empírica en emulador — los taps basados en estimaciones visuales de las capturas de pantalla no registraban en los botones.
**Qué pasó**: los botones dentro de un `ScrollView` de Gluestack se renderizan en coordenadas distintas a las que se esperaría por la posición visual en el screenshot. `adb shell uiautomator dump /sdcard/ui.xml` produce un XML con las bounds exactas de cada elemento en coordenadas reales del dispositivo (1080x2400).
**Lección**: para testing empírico con `adb shell input tap`, siempre usar `uiautomator dump` para obtener las coordenadas exactas. Nunca estimar desde screenshots escalados — el error puede ser >200px.
**Cómo aplicar**: antes de automatizar taps en un flujo de prueba empírica: (1) `adb shell uiautomator dump /sdcard/ui.xml`, (2) `adb pull /sdcard/ui.xml`, (3) parsear con python o grep el `content-desc` o `resource-id` del elemento, (4) calcular el centro desde `bounds="[x1,y1][x2,y2]"` como `((x1+x2)/2, (y1+y2)/2)`.

---
date: 2026-06-02
agent: spec
category: spec-process
tags: [employee-benefit, active-directory, kafka, contrato]
slug: employee-id-como-rut-no-campo-nuevo
---

**Contexto**: spec inicial usó `rut` como campo nuevo en el payload Kafka para identificar al empleado ante el AD.
**Qué pasó**: el architect detectó que `shared-types` ya tiene `employee_id?: string` en `AuthorizationRequestDto`. Agregar `rut` habría roto el contrato Kafka con el `internal-server` de tienda.
**Lección**: antes de introducir un campo nuevo en el payload Kafka, verificar si ya existe un campo que cumpla la misma función. Renombrar o duplicar campos Kafka tiene impacto cross-repo.
**Cómo aplicar**: en cualquier spec que añada campos a `AuthorizationRequestDto` o `AuthorizationResponseDto`, el architect debe leer `shared-types` primero.

---
date: 2026-06-02
agent: architect
category: pattern
tags: [nestjs, hexagonal, active-directory, http-adapter]
slug: dto-crudo-externo-local-al-adapter
---

**Contexto**: decidiendo dónde poner el DTO de respuesta del AD (JSON crudo con `associate`, `displayName`, etc.).
**Qué pasó**: el DTO crudo del proveedor externo fue puesto en `infrastructure/active-directory/` (local al servicio), NO en `shared-types`.
**Lección**: `shared-types` es para contratos inter-servicio (Kafka, SSE). Los DTOs de APIs externas van locales al adapter que los consume — son detalles de infra, no contratos de negocio.
**Cómo aplicar**: cualquier integración con un servicio externo (AD, ERP, API de pago) pone su DTO de respuesta junto al adapter, nunca en `shared-types`.

---
date: 2026-06-02
agent: architect
category: pattern
tags: [nestjs, hexagonal, use-case, dispatch]
slug: use-case-especifico-delegado-desde-orquestador
---

**Contexto**: el spec proponía `VerifyEmployeeBenefitUseCase` como use-case aislado, pero el flujo existente usaba `ProcessAuthorizationRequestUseCase` para todos los tipos.
**Qué pasó**: se implementó el verify use-case como delegado de `ProcessAuthorizationRequestUseCase` (que actúa como dispatcher por tipo). El proceso principal hace branching y delega sin duplicar lógica.
**Lección**: cuando un use-case orquestador ya existe, introducir sub-use-cases especializados como delegados, no como entradas paralelas al consumer. El consumer solo conoce el orquestador.
**Cómo aplicar**: para futuros tipos de solicitud nuevos (ej. `SUSPEND` con lógica especial), seguir el mismo patrón: crear `VerifyXUseCase` y delegarlo desde `ProcessAuthorizationRequestUseCase`.

---
date: 2026-06-02
agent: qa
category: test-strategy
tags: [jest, workspace, moduleNameMapper, nestjs]
slug: jest-workspace-packages-necesitan-moduleNameMapper
---

**Contexto**: los tests del `authorization-service` importan `@open-supervisor/shared-types` y `@open-supervisor/shared-messaging`.
**Qué pasó**: Jest no resuelve workspace packages de pnpm por defecto. Fue necesario agregar `moduleNameMapper` en la config de Jest apuntando a los paths de source de cada package. El `typecheck` (tsc) también falla con los paths actuales, pero es un problema preexistente del proyecto.
**Lección**: al agregar tests que importen workspace packages, configurar `moduleNameMapper` en `jest.config.js` o `package.json#jest`. El typecheck con `tsc` requiere que `paths` en `tsconfig.json` y `baseUrl` estén alineados correctamente.
**Cómo aplicar**: si un nuevo servicio importa un package del workspace y los tests fallan con "Cannot find module", revisar `moduleNameMapper` antes de buscar otros problemas.

---
date: 2026-06-02
agent: backend
category: pattern
tags: [nestjs, controller, error-handling, http-status]
slug: dominio-error-mapeo-a-http-409-en-controller
---

**Contexto**: el spec requería HTTP 409 cuando `assertPending` lanza `Error("already APPROVED/REJECTED")`, pero NestJS mapea errores genéricos a HTTP 500 por defecto.
**Qué pasó**: el controller necesita un bloque `try/catch` explícito que inspeccione `error.message.includes('is already')` y lance `ConflictException` antes de re-lanzar el error original. Los errores NestJS propios (`NotFoundException`, etc.) se dejan pasar sin transformar.
**Lección**: para mapear errores de dominio a códigos HTTP específicos sin contaminar el use-case con NestJS, el catch debe ser selectivo: identificar el error de dominio por su mensaje/tipo y lanzar la excepción HTTP equivalente; todo lo demás se re-lanza sin modificar.
**Cómo aplicar**: cada vez que el spec exija un código HTTP distinto de 400/404/500 para un error de dominio, agregar el catch selectivo en el controller, no en el use-case.

---
date: 2026-06-02
agent: backend
category: pattern
tags: [sse, redis, rxjs, subject, multi-channel]
slug: sse-service-un-subject-por-store-multiples-canales-redis
---

**Contexto**: el `SseService` necesitaba suscribir dos canales Redis (`store:{id}:requests` y `store:{id}:dispatches`) y emitir eventos SSE con `type` distinto por canal, pero ambos debían llegar al mismo Observable del cliente.
**Qué pasó**: se usa un único `Subject<SseEvent>` por `storeId`, indexado por el canal `:requests`. Ambas suscripciones Redis (`:requests` y `:dispatches`) hacen `subject.next()` sobre el mismo subject con su `type` correspondiente. El guard `if (!this.subjects.has(requestsChannel))` evita duplicar las suscripciones si `getStoreStream` se llama varias veces para el mismo store.
**Lección**: cuando varios canales Redis deben multiplexarse en un único stream SSE, usar un Subject compartido por store (no por canal) y suscribir ambos canales en el mismo bloque de inicialización.
**Cómo aplicar**: para futuros canales Redis adicionales por store (ej. `store:{id}:alerts`), agregar la suscripción en el mismo bloque `if (!this.subjects.has(...))` con el `type` SSE correspondiente.

---
date: 2026-06-02
agent: architect
category: spec-process
tags: [solid, discriminated-union, dto, entidad, spec, price-change]
slug: spec-no-asumir-contratos-que-no-existen-en-el-codigo
---

**Contexto**: spec de PRICE_CHANGE propuso discriminated unions (`BaseAuthorizationRequestDto` + subtipos) y herencia de entidad (`PriceChangeRequest extends AuthorizationRequest`) siguiendo principios OCP/ISP.
**Qué pasó**: el architect encontró que el código real usa una interfaz plana con campos opcionales (`amount?`, `employee_id?`) y un constructor privado en la entidad que impide herencia directa. Adoptar discriminated unions habría sido un refactor cross-repo que rompe los 4 tipos existentes y sus tests — trabajo mucho mayor que la feature en sí.
**Lección**: el spec no debe asumir patrones de contrato (discriminated unions, herencia) que no existen aún en el código. El architect debe validar la *forma real* de DTOs y entidades antes de aceptar diseños SOLID idealizados. Migrar a union discriminada es un spec de refactor separado con su propio ciclo TDD, no parte de una feature nueva.
**Cómo aplicar**: en cualquier spec que introduzca un nuevo tipo de solicitud, el architect lee `shared-types/src/dtos/authorization-request.dto.ts` y `authorization-request.entity.ts` primero. Si el patrón vigente es campos opcionales, el spec sigue ese patrón — no lo cambia.

**Contexto**: FASE GREEN para PRICE_CHANGE — corriendo `pnpm typecheck` en `authorization-service` y `sse-server`.
**Qué pasó**: `tsc --noEmit` falla con TS2307 para todos los imports de `@open-supervisor/shared-*` en ambos servicios. El `tsconfig.json` define `paths` pero el `tsconfig.base.json` que extiende no define `baseUrl`, y TypeScript ignora `paths` sin `baseUrl`. Los tests Jest pasan porque `moduleNameMapper` resuelve en runtime y `tsconfig.spec.json` (con `baseUrl`) resuelve en compilación de test. Confirmado como defecto pre-existente en LEARNINGS.md entrada `jest-workspace-packages-necesitan-moduleNameMapper`.
**Lección**: `pnpm typecheck` (que usa el `tsconfig.json` de producción) siempre fallará en estos servicios hasta que se agregue `baseUrl: "."` al `tsconfig.json` de cada servicio (o al `tsconfig.base.json`). Los tests Jest no revelan este problema. Distinguir este fallo de regresiones introducidas por features nuevas.
**Cómo aplicar**: en cada FASE GREEN, el reporte debe distinguir entre "fallos pre-existentes de typecheck" y "errores nuevos introducidos por la feature". Si los únicos errores de tsc son TS2307 en imports de workspace packages, son pre-existentes. Si aparecen errores TS en archivos nuevos de la feature, son regresiones reales.

---
date: 2026-06-03
agent: architect
category: spec-process
tags: [react-native, bff, sse, contrato, mobile, spec]
slug: spec-mobile-debe-verificar-rutas-bff-antes-de-qa-red
---

**Contexto**: spec de UI mobile (listado + detalle de solicitudes) fue generado asumiendo rutas y contratos del BFF sin verificar el código real.
**Qué pasó**: el architect encontró tres divergencias críticas: (1) la ruta SSE real es `GET /stream/store/:storeId`, no `/stores/:storeId/requests/stream`; (2) el endpoint de decisión es `POST /authorization/:id/resolve` con body `{ decision: 'APPROVE'|'REJECT', supervisor_id: string }`, no `approved: boolean`; (3) el BFF expone `GET /authorization/store/:storeId/pending` para carga inicial — dato que el spec omitía completamente. El spec también usaba `onerror`/`onopen` como propiedades de EventSource cuando la API real de `react-native-sse` es `addEventListener('error'|'open', ...)`.
**Lección**: cualquier spec de feature mobile que interactúe con el BFF debe incluir un paso explícito de verificación de rutas en el architect step. El spec no puede asumir contratos — debe leer `apps/bff/src/` antes de cerrar el spec. La omisión de la carga inicial de pendientes (GET /pending) fue el error más costoso: dejaba solicitudes previas invisibles al abrir la app.
**Cómo aplicar**: en el architect step para features mobile↔BFF, siempre leer `apps/bff/src/**/*.controller.ts` y `apps/bff/src/**/*.service.ts` y comparar rutas/bodies contra los supuestos del spec antes de dar luz verde a QA RED.

---
date: 2026-06-03
agent: backend
category: api-gotcha
tags: [node-test, tsx, eventsource, sse, mock]
slug: node-test-sse-mock-handler-debe-ser-EventListener-cast
---

**Contexto**: implementando `waitForSseEvent` con el mock de EventSource del spec (`createMockEventSource`), que usa `addEventListener(type, handler)` donde `handler` acepta `{ data: string | null }`.
**Qué pasó**: TypeScript rechaza pasar `(event: { data: string | null }) => void` directamente como `EventListener` (que espera `Event`). El cast `handler as EventListener` en el `addEventListener` call es necesario. Dentro del handler, se castea el `Event` a `MessageEvent` para acceder a `.data`. El mock del test usa `h({ data })` con el objeto plano — funciona porque el cast se hace en runtime y el mock solo llama a la función directamente.
**Lección**: cuando se escriben funciones que usen `EventSource.addEventListener`, tipar el handler interno como `(event: Event)` y hacer cast a `MessageEvent` para `.data`. Al llamar `addEventListener`, usar `handler as EventListener` para compatibilidad de tipos. El mock de test puede pasar objetos planos que satisfagan la forma en runtime.
**Cómo aplicar**: en cualquier código que agregue listeners a EventSource (SSE), seguir el patrón `addEventListener('event-name', handler as EventListener)` con cast interno a `MessageEvent`.

---
date: 2026-06-03
agent: backend
category: pattern
tags: [typescript, uuid, crypto, pure-function, buildDto]
slug: uuid-sincrono-en-funcion-pura-con-crypto-getRandomValues
---

**Contexto**: `buildDto` debe generar un UUID v4 sin requerir `import uuid` async (para mantenerla función pura y testeable síncronamente sin mocks).
**Qué pasó**: Node.js 19+ expone `crypto.getRandomValues` en el global. Se implementó un `generateUuidV4()` inline usando `new Uint8Array(16)` + `crypto.getRandomValues` con fallback a `require('crypto').randomBytes(16)` para Node más antiguo. Esto permite que `buildDto` sea completamente síncrona y no requiera mocking de `uuid` en tests.
**Lección**: para funciones puras que necesiten UUID, el crypto global de Node 19+ elimina la necesidad del paquete `uuid`. La función `main()` puede usar el paquete `uuid` importado dinámicamente para producción, mientras `buildDto` usa el helper inline para tests unitarios simples.
**Cómo aplicar**: cuando una función pura de dominio necesite un ID único, usar `crypto.getRandomValues` con fallback a `require('crypto').randomBytes`. Reservar el paquete `uuid` para código de producción en `main()`.

---
date: 2026-06-03
agent: backend
category: setup
tags: [pnpm, devDependencies, workspace-root, scripts]
slug: devDependencies-en-workspace-root-para-scripts-de-desarrollo
---

**Contexto**: el directorio `scripts/` del monorepo necesita `kafkajs`, `uuid`, `eventsource`, `dotenv`, `tsx` para el script de inyección.
**Qué pasó**: estas dependencias se agregan al `package.json` raíz del monorepo (no a un workspace package específico) como `devDependencies`. `pnpm install` las hoistea y quedan disponibles tanto para el script como para los tests que usan `npx tsx --test`.
**Lección**: para scripts de tooling de desarrollo en el root del monorepo, agregar las deps al `package.json` raíz, no crear un workspace package separado. El comando `pnpm inject` en el root dispara `tsx scripts/inject-request.ts` directamente.
**Cómo aplicar**: al agregar scripts de desarrollo al directorio `scripts/`, sus dependencias van al root `package.json#devDependencies`. No crear un `scripts/package.json` separado — agrega complejidad innecesaria al workspace.

---
date: 2026-06-03
agent: frontend
category: setup
tags: [react-native, jest, pnpm, scaffold, EventSource, generic]
slug: react-native-sse-eventSource-generic-para-typecheck
---

**Contexto**: scaffold inicial de `apps/mobile/` — typecheck fallaba en `useSSERequests.ts` con TS2345 al llamar `addEventListener('authorization_request', ...)`.
**Qué pasó**: `react-native-sse`  expone `EventSource<T extends string = never>` donde `T` es el union de eventos custom. Sin el generic, TypeScript rechaza nombres de evento que no sean los built-in (`'open'`, `'error'`, `'close'`, `'message'`). La solución es declarar el nombre del evento custom en el generic: `new EventSource<'authorization_request'>(url, opts)`. Además, el tipo del `event.data` dentro del listener es `string | null` (no `string`), por lo que hay que hacer guard `if (event.data == null) return` antes de `JSON.parse`.
**Cómo aplicar**: al instanciar `EventSource` de `react-native-sse` con eventos custom, siempre pasar el union de nombres de evento como generic. Si se escuchan múltiples eventos custom: `new EventSource<'authorization_request' | 'physical_presence_dispatch'>(...)`. Y siempre nullcheck `event.data` antes de parsear.

---
date: 2026-06-03
agent: backend
category: setup
tags: [react-native, babel, runtime, metro, pnpm, setup]
slug: babel-runtime-necesario-para-rn-con-pnpm
---

**Contexto**: verificación de que la app mobile se ejecuta correctamente en el emulador Android. Al correr `pnpm android` con Metro, el bundler fallaba con `Unable to resolve module @babel/runtime/helpers/interopRequireDefault`.

**Qué pasó**: React Native 0.76.9 depende de `@babel/runtime` para las transformaciones de Babel, pero el scaffold generado por `npx @react-native-community/cli init` no lo incluye en `package.json`. En un monorepo pnpm, Metro no resuelve `@babel/runtime` desde el `node_modules` hoisted de la raíz porque la dependencia no está declarada en el `package.json` del workspace mobile.

**Lección**: al bootstrap o clonar la app mobile, instalar `@babel/runtime` explícitamente con `pnpm --filter @open-supervisor/mobile add @babel/runtime`. Sin esta dependencia, Metro falla al resolver `interopRequireDefault` aunque esté presente en `node_modules/.pnpm` del monorepo.

**Cómo aplicar**: después de `pnpm install` inicial del monorepo, verificar que `apps/mobile/package.json` contenga `@babel/runtime` como dependencia. Si no está, agregarlo antes de arrancar Metro. Si se regenera el scaffolding de la app mobile, incluir `@babel/runtime` como post-install step.

---

## 2026-06-03 — Asimetría snake_case/camelCase entre el DTO Kafka y el payload SSE

**Categoría**: api-gotcha / pattern

**Qué pasó**: El script `scripts/inject-request.ts` publica en Kafka con `correlation_id` (snake_case, contrato de `AuthorizationRequestDto` en `shared-types`). Sin embargo, al verificar la llegada vía SSE del BFF, el evento `authorization_request` lleva el payload en camelCase (`correlationId`, `storeId`, `posId`, etc.). El `authorization-service` re-mapea el DTO antes de publicar al canal Redis en `process-authorization-request.use-case.ts:41-51`.

**Lección**: Leer solo `shared-types` no es suficiente para conocer el contrato del evento SSE. El use-case transforma los campos antes de emitir. Cualquier herramienta, test o cliente que consuma el SSE debe matchear contra camelCase — no contra el DTO original.

**Cómo aplicar**: al escribir tests de integración o scripts que verifiquen el SSE, verificar siempre el payload emitido en `process-authorization-request.use-case.ts`, no solo el DTO de entrada. El guard explícito está en `scripts/inject-request.spec.ts` test #11 (verifica que `correlation_id` snake_case NO hace match).

---

## 2026-06-03 — Scripts standalone en monorepo pnpm: tsconfig con paths para shared-types

**Categoría**: tooling / typescript

**Qué pasó**: Al crear `scripts/inject-request.ts` como script standalone (fuera de los workspaces NestJS), los imports de `@open-supervisor/shared-types` fallaban porque `package.json` de shared-types apunta a `dist/index.js` y `dist/` puede no estar buildeado en un entorno de desarrollo fresco.

**Lección**: Para scripts standalone que usan paquetes del workspace, crear `scripts/tsconfig.json` con `paths` apuntando al `src/` del paquete directamente. Con `tsx` como runner, esto funciona sin necesidad de buildear primero. La alternativa de importar por path relativo (`../packages/shared-types/src/...`) también funciona pero pierde la resolución por alias.

**Cómo aplicar**: todo nuevo directorio `scripts/` o `tools/` que importe desde `packages/` debe incluir su propio `tsconfig.json` con `paths`. El patrón es el mismo que `moduleNameMapper` en Jest — mapear el alias al `src/` del paquete.

---

## 2026-06-04 — NestJS DI: token string vs. clase para HttpService

**Categoría**: bugfix / nestjs

**Qué pasó**: `authorization.module.ts` tenía `inject: ['HttpService', ConfigService]` (string literal como token). NestJS registra `HttpService` usando la clase como token, no un string. El servicio fallaba al arrancar con `Nest can't resolve dependencies of the ACTIVE_DIRECTORY`.

**Lección**: En NestJS, cuando se usa `HttpModule.registerAsync`, el token del `HttpService` es la clase `HttpService` de `@nestjs/axios`. Nunca usar strings para inyectar servicios de módulos de NestJS — siempre importar la clase y usarla directamente en `inject: [HttpService]`.

**Cómo aplicar**: al escribir `useFactory` con `inject`, revisar que cada token sea la clase o símbolo correcto, no un string derivado del nombre. El error `can't resolve dependencies` con `?` en la posición conflictiva indica exactamente qué token no se resuelve.

---

## 2026-06-04 — eventsource@2.x bajo CommonJS: default import falla en runtime

**Categoría**: bugfix / nodejs / interop

**Qué pasó**: `bff/stream.service.ts` usaba `import EventSource from 'eventsource'`. TypeScript compila esto a `eventsource_1.default` en CJS, pero `eventsource@2.x` no expone `.default` como constructor — resulta en `TypeError: eventsource_1.default is not a constructor`. El BFF arrancaba sin errores visibles pero nunca conectaba al sse-server, por lo que ningún evento SSE llegaba al script.

**Lección**: los paquetes npm que soportan tanto ESM como CJS no siempre tienen `.default` en la build CJS. Para `eventsource@2.x` en un proyecto NestJS (CommonJS), usar `const EventSource: any = require('eventsource')` en lugar de `import ... from`. Este patrón aplica a cualquier paquete que falle con `X.default is not a constructor`.

**Cómo aplicar**: si un default import falla en runtime con `X.default is not a constructor`, cambiar a `require()`. Al agregar nuevas dependencias a servicios NestJS, verificar si el paquete tiene build CJS correcta con `node -e "console.log(typeof require('pkg'))"` — si devuelve `function`, el require directo funciona.

---

---
date: 2026-06-03
agent: frontend
category: setup
tags: [react-native, gluestack, jest, transformIgnorePatterns, pnpm, ui-system]
slug: gluestack-v1-jest-transformIgnorePatterns-expo-html-elements
---

**Contexto**: migración de primitivos RN a Gluestack UI v1 (`@gluestack-ui/themed`) en `apps/mobile/`.
**Qué pasó**: (1) `@gluestack-ui/themed` tiene una dep transitiva sobre `@expo/html-elements` (vía el componente `Heading`). Este paquete publica ESM puro y Jest no lo transpila por defecto — los tests fallan con SyntaxError si `@expo` no está en el `transformIgnorePatterns`. (2) El peer `@legendapp/motion >=2.2` declara `nativewind: '*'` como peer opcional — pnpm warneará pero no bloqueará en un proyecto Android-only sin NativeWind. (3) Gluestack v1 NO requiere plugin de Babel ni cambios en metro.config.js — es runtime styling, no compilador.
**Lección**: al agregar cualquier paquete de la familia `@gluestack-*` al `transformIgnorePatterns`, incluir también `@expo` para cubrir deps transitivas como `@expo/html-elements`. El warning de `nativewind` se ignora.
**Cómo aplicar**: en `jest.config.js` de la app mobile, el patrón debe incluir `@gluestack-ui|@gluestack-style|@legendapp|@expo`. No modificar babel.config.js ni metro.config.js para Gluestack v1.

---

---
date: 2026-06-03
agent: architect
category: spec-process
tags: [spec, test-coverage, qa, tdd, mobile]
slug: spec-no-asumir-tests-que-no-existen
---

**Contexto**: spec de UI con Gluestack (US-03) declaró "actualizar test que verifica texto 'Cargando...'" como criterio de QA RED.
**Qué pasó**: el architect revisó `AuthorizationList.test.tsx` y confirmó que ningún test cubría el branch `isLoading=true`. El spec asumió cobertura inexistente. QA tuvo que crear el test desde cero en lugar de actualizarlo.
**Lección**: el spec writer no puede asumir cobertura de tests existente sin leer los archivos de test. Un criterio de "actualizar test X" implica que ese test existe — si no existe, el criterio debe ser "crear test X". El architect debe leer los test files en el paso 2 para detectar este tipo de divergencia antes de que QA comience.
**Cómo aplicar**: en el architect step, leer los archivos `__tests__/*.test.tsx` de los componentes que se van a migrar y comparar con el Plan de Tests del spec. Corregir divergencias antes de dar luz verde a QA RED.

---

## 2026-06-04 — Setup de infraestructura local: Podman + paquetes compartidos sin build

**Categoría**: tooling / devops

**Qué pasó**: Al intentar levantar el stack completo por primera vez:
1. `docker` no disponible en el PATH — el daemon era Podman, con socket en `~/.local/share/containers/podman/machine/podman.sock`
2. `shared-types` y `shared-messaging` nunca habían sido compilados (`dist/` ausente) — todos los servicios fallaban al importarlos
3. `tsc -p tsconfig.json` en servicios no emite a `./dist` en este entorno (bug quirk) — workaround: `--outDir /tmp/xxx && cp -r /tmp/xxx/* dist/`
4. pnpm v11 cambió `approvedBuilds` a `allowBuilds` y ya no lee el campo `"pnpm"` de `package.json` — la aprobación de `esbuild` requiere configuración diferente

**Cómo aplicar**: antes del primer `nest start` en un clon fresco:
```bash
cd packages/shared-types && node_modules/.bin/tsc && cd ../shared-messaging && node_modules/.bin/tsc
```
Para levantar la infra con Podman: `make infra` (el Makefile detecta el motor automáticamente)

---
date: 2026-06-03
agent: frontend
category: setup
tags: [react-native, metro, babel, gluestack, react-stately, static-class-block, hermes]
slug: react-stately-static-class-blocks-requiere-babel-plugin
---

**Contexto**: red screen en el emulador Android al lanzar el app mobile con Metro en modo dev.

**Qué pasó**: Metro fallaba con `TransformError: Static class blocks are not enabled` al procesar `react-stately@3.47.0/dist/private/color/Color.cjs`. Este archivo es una dependencia transitiva de `@gluestack-ui/menu` → `@gluestack-ui/themed` y usa **static class blocks** (ES2022). El `@react-native/babel-preset` v0.76.9 NO incluye `@babel/plugin-transform-class-static-block`, que es la transformación necesaria para que Hermes pueda ejecutar esa sintaxis.

**Lección**: Gluestack UI v1 trae transitivamente `react-stately` (vía `@gluestack-ui/menu`), cuya build CJS usa ES2022 `static {}` blocks. El preset de Babel de RN 0.76 no cubre esto. El fix es: (1) `pnpm --filter @open-supervisor/mobile add -D @babel/plugin-transform-class-static-block` y (2) agregar `plugins: ['@babel/plugin-transform-class-static-block']` en `babel.config.js`.

**Cómo aplicar**: si aparece `TransformError: Static class blocks are not enabled` en Metro, el fix es el plugin de Babel mencionado. No confundir con errores de `transformIgnorePatterns` — Metro sí transforma el archivo, pero el preset no tiene el plugin. Reiniciar Metro con `--reset-cache` después del cambio para que el nuevo config surta efecto.

---
date: 2026-06-04
agent: claude
category: setup
tags: [skills, portabilidad, podman, docker, adb, agnostico, opencode, qa]
slug: skills-infra-emulator-agnosticos-en-el-repo
---

**Contexto**: los skills `open-supervisor-infra` y `open-supervisor-emulator` vivían solo en `~/.claude/skills/` (config personal) y tenían rutas absolutas de la máquina del autor — incluido el socket Podman `unix://$HOME/.local/share/.../podman.sock`. Un dev que clonara el repo no los recibía y, si los recibía, no funcionaban.

**Qué pasó**: al verificar el bootstrap portable en este mismo entorno, `DOCKER_HOST` se resolvió dinámicamente a `unix:///tmp/claude-501/podman/podman-machine-default-api.sock` — **una ruta totalmente distinta** del socket hardcodeado que tenía el skill viejo. O sea, el hardcode estaba mal incluso en la máquina del autor bajo este runtime. Los nombres de contenedor tipo `open-supervisor-kafka-1` también son frágiles: el prefijo lo pone compose según el nombre del directorio de clonado.

**Lección**: un skill operativo es "agnóstico" solo si (1) vive en el repo git-trackeado (`.claude/skills/`, no `~/.claude/skills/`), y (2) no asume rutas ni nombres de máquina. Patrón portable: `REPO_ROOT="$(git rev-parse --show-toplevel)"`; detectar motor (`podman` preferido, `docker` fallback) y resolver el socket con `podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}'`; referenciar contenedores por **nombre de servicio** vía `$COMPOSE exec kafka`, no por nombre con prefijo; resolver el serial del emulador con `adb devices` (no asumir `emulator-5554`); el AVD `open_supervisor` lo crea `setup-android.sh`. Para que opencode también los vea sin duplicar, agregar `.claude/skills` a `skills.paths` en `opencode.json` (fuente única, sin symlinks ni drift).

**Cómo aplicar**: cualquier skill o script de tooling que vaya a usar otro desarrollador NO debe contener `/Users/<quien-sea>/...` ni nombres de contenedor con prefijo de proyecto. Verificar con `grep -rn "/Users/" .claude/skills/`. Para que el agente QA (y backend/frontend) los invoquen, agregar `Skill` a su línea `tools:` en `.claude/agents/*.md`.

---
date: 2026-06-04
agent: claude
category: setup
tags: [android, emulador, react-native, bff, url, conexion, 10.0.2.2]
slug: bff-base-url-android-emulator-10-0-2-2
---

**Contexto**: app mobile mostraba listado vacío en el emulador Android. El BFF devolvia datos correctamente desde curl en el host, pero la app no cargaba nada.

**Que paso**: el `.env` tenia `BFF_BASE_URL=http://localhost:3000`. En el emulador Android, `localhost` apunta al propio emulador, no al host. La app intentaba conectarse a si misma. La URL correcta desde el emulador es `http://10.0.2.2:3000` (IP especial que mapea al loopback del host).

**Leccion**: localhost en Android emulator != host machine. Usar 10.0.2.2 en su lugar. react-native-config compila las variables en build time. adb reverse se pierde al reiniciar el emulador.

**Como aplicar**: siempre verificar BFF_BASE_URL cuando se prueba en emulador. Si se reinicia el emulador, ejecutar adb reverse. Documentar esto en el .env.example.


---

## 2026-06-04 — Outbox pattern: setInterval programatico + OnModuleInit/OnModuleDestroy vs @nestjs/schedule

**Categoria**: pattern / nestjs / testing

**Que paso**: el spec original proponia @nestjs/schedule con @Cron para el emisor del outbox. La implementacion termino con setInterval programatico disparado en OnModuleInit y clearInterval en OnModuleDestroy, configurable por OUTBOX_TICK_INTERVAL_MS.

**Por que funciono mejor**:
- Cero dependencias nuevas (vs @nestjs/schedule que requiere imports en el modulo).
- Lifecycle de NestJS garantiza cleanup sin riesgo de intervals zombies.
- Tests con jest.useFakeTimers() + jest.advanceTimersByTime(...) son triviales — no hay que mockear el scheduler.
- start() y stop() idempotentes (guard con if (this.intervalHandle)) evitan registros duplicados si onModuleInit corre mas de una vez (e.g. en hot-reload de tests).

**Leccion**: para workers sencillos (tick periodico < 5 minutos) en NestJS, setInterval + OnModuleInit/OnModuleDestroy es preferible a @nestjs/schedule salvo que se necesite sintaxis cron declarativa. La simplicidad operativa y la testabilidad compensan la perdida de declaratividad.

**Como aplicar**: en cualquier servicio NestJS que necesite un worker recurrente de baja frecuencia (cleanup, polling, health-check, emisor de outbox), empezar con setInterval programatico. Migrar a @nestjs/schedule solo si se necesita sintaxis cron declarativa o multiples schedules heterogeneos.

---

## 2026-06-04 — Outbox + UnitOfWork: repositorios bound a tx, no a db

**Categoria**: pattern / drizzle / hexagonal / testing

**Que paso**: la TX atomica entre IAuthorizationRepository.save() y IOutboxRepository.save() requeria que ambos repositorios operaran en la misma conexion de Postgres dentro de db.transaction(async (tx) => { ... }). La implementacion del DrizzleUnitOfWork crea nuevas instancias de los repositorios pasandoles tx (no db) en el callback de la TX.

**Por que importa**: los repositorios son @Injectable() con @Inject(DRIZZLE) en su constructor. Si no se re-instancian dentro del db.transaction(...), todas las llamadas usan la conexion del pool principal — la TX atomica es decorativa, no real. Postgres hace COMMIT/ROLLBACK por conexion, no por query.

**Leccion**: en Drizzle/Prisma/Kysely con db.transaction, los repositorios DENTRO del callback de la TX deben recibir el tx (no el db global). El IUnitOfWork port abstrae esto del dominio: el use-case solo conoce ctx.authorizationRepository y ctx.outboxRepository, no Drizzle. Los tests pueden mockear IUnitOfWork.transaction con (work) => work(ctxMockeado) sin tocar Drizzle.

**Como aplicar**: para cualquier feature que requiera TX atomica entre dos repos, agregar un IUnitOfWork port + DrizzleUnitOfWork adapter (o equivalente). Nunca instanciar dos repositorios en el use-case y llamarlos secuencialmente — pierden la garantia de atomicidad.

---

## 2026-06-04 — Outbox: FOR UPDATE SKIP LOCKED solo tiene sentido dentro de una TX

**Categoria**: pattern / sql / postgres

**Que paso**: el spec original pedia SELECT ... WHERE status=PENDING ... FOR UPDATE SKIP LOCKED LIMIT N en findPending(limit) del DrizzleOutboxRepository. La implementacion MVP (single-instance) usa SELECT simple sin lock. Razon: FOR UPDATE SKIP LOCKED requiere que la query se ejecute DENTRO de una transaccion (BEGIN; SELECT ...; UPDATE ...; COMMIT;). Si se ejecuta sin TX (auto-commit), el lock se libera al final del statement y no protege nada.

**Leccion**: FOR UPDATE SKIP LOCKED no es una query bonita — es un lock transaccional. Si el emisor no envuelve findPending + markPublished/incrementAttempts en db.transaction(...), el lock no se sostiene.

**Como aplicar**: cualquier adapter con findPending para workers concurrentes debe documentar explicitamente si la query es lock-less (MVP) o con SKIP LOCKED dentro de TX (multi-instancia). El spec del outbox documenta la desviacion y deja un comentario en el adapter con la instruccion de migrar.

---

## 2026-06-04 — Test mock de ConfigService.get en NestJS: tipar defaultValue como unknown, no T

**Categoria**: api-gotcha / nestjs / typescript / testing

**Que paso**: al mockear ConfigService en un test, TypeScript rechaza pasar def: number porque la firma real de ConfigService.get es (propertyPath: never, defaultValue: unknown, options: ConfigGetOptions) => unknown.

**Leccion**: el overload de ConfigService.get esta tipado con defaultValue: unknown por diseno (NestJS no puede inferir el tipo del env var en compile-time). Los mocks deben respetar esa firma y castear dentro del body.

**Como aplicar**:
```typescript
config = { get: jest.fn() } as unknown as ConfigService;
config.get.mockImplementation((key: string, def?: unknown) => {
  if (key === 'OUTBOX_TICK_INTERVAL_MS') return 1000;
  return def as number;
});
```

---

## 2026-06-04 — NestJS DI: usar tokens del port (OUTBOX_REPOSITORY) en @Inject(), no strings

**Categoria**: bugfix / nestjs / typescript

**Que paso**: el OutboxPublisherService y OutboxStatsController usaban @Inject('IOutboxRepository') y @Inject('IMessagePublisher') (strings hardcodeados). Funcionaron solo porque el AuthorizationModule proveia esos strings literales, pero si el provider cambiaba su provide: a la constante del port, el @Inject del consumidor quedaba apuntando al string equivocado y la inyeccion fallaba silenciosamente en runtime.

**Leccion**: en arquitectura hexagonal con ports NestJS, los tokens de DI son constantes exportadas del port (export const OUTBOX_REPOSITORY = 'OUTBOX_REPOSITORY'). El consumidor hace @Inject(OUTBOX_REPOSITORY) y el provider hace provide: OUTBOX_REPOSITORY. Si los strings se hardcodean en el @Inject, se pierde la trazabilidad compile-time y cualquier refactor del provider rompe la inyeccion sin error de TypeScript.

**Como aplicar**: regla de oro — nunca escribir @Inject('NombreDeInterface') ni @Inject('NombreDeClase'). Siempre @Inject(TOKEN_CONSTANTE) donde TOKEN_CONSTANTE esta exportada del archivo del port.

---

## 2026-06-04 — Jest mockResolvedValue(undefined) requiere valor del tipo de retorno

**Categoria**: api-gotcha / jest / typescript

**Que paso**: jest.spyOn(service, 'tick').mockResolvedValue(undefined) fallaba con TS2345: Argument of type undefined is not assignable to parameter of type { pending, published, failed, durationMs } | Promise<...>. El metodo tick() retornaba un objeto de stats, no void.

**Leccion**: cuando se usa jest.spyOn(obj, 'method') y el metodo tiene un return type no-void, mockResolvedValue exige un valor que satisfaga ese return type. .mockResolvedValue(undefined) solo funciona para metodos void/Promise<void>.

**Como aplicar**:
- Si el metodo retorna void/Promise<void>: mockResolvedValue(undefined).
- Si retorna un objeto: mockResolvedValue({ ...mockshape }) o mockImplementation(() => Promise.resolve({ ... })).
- Si solo necesitamos evitar la llamada real: mockResolvedValue({} as ReturnType<typeof service.tick>) con cast.

---

---
date: 2026-06-04
agent: pipeline
category: setup
tags: [opencode, plugin, hooks, todo.updated, tool.execute.after, state-tracking]
slug: opencode-plugin-hook-todo-updated-no-existe-usar-tool-execute-after
---

**Contexto**: el plugin `pipeline-enforcer.js` registraba `"todo.updated"` como hook para actualizar `state.json` cuando el agente hace `todowrite`. En la versión actual de opencode, este hook nunca disparaba — el `tool.execute.before` sí funcionaba (bloqueaba ediciones), pero el tracking de scopes quedaba muerto y `pipeline_active` quedaba en `false` para siempre.

**Que paso**: investigación del bug reveló que los eventos válidos en opencode son `event`, `config`, `chat.*`, `tool.execute.*`, `tool.definition`, `command.execute.before`, `shell.env`, `permission.ask`, `experimental.*`. NO hay eventos `todo.*`. El plugin quedó inservible silenciosamente — la única forma de activarlo era manipular `state.json` a mano con `jq`.

**Fix**: reemplazar el hook `"todo.updated"` por `"tool.execute.after"` y leer los todos actualizados de `input.args.todos ?? input.output.todos ?? []` (defensivo porque la forma exacta del input no está 100% documentada). Después del fix + reinicio de opencode, el plugin actualiza `state.json` automáticamente en cada `todowrite`.

**Leccion**: en opencode, los nombres de eventos de plugin deben ser los de la lista oficial (`event`, `config`, `tool.execute.*`, etc.). `todo.updated` no existe aunque sea un nombre intuitivo. La forma del input de `tool.execute.after` para `todowrite` debe leerse defensivamente (múltiples paths) hasta confirmar la firma exacta de opencode.

**Como aplicar**: al escribir o debuggear plugins de opencode que necesiten tracking de cambios, usar `tool.execute.after` con check de `input.tool === "<nombre>"` en lugar de asumir eventos de dominio (`todo.*`, `file.*`, etc.). Verificar siempre contra la lista oficial de eventos del schema. Reiniciar opencode después de cambiar plugins — no hay hot-reload.

---

---
date: 2026-06-04
agent: pipeline
category: spec-process
tags: [scope-decomposition, parallelization, task-tool, multi-scope, topologico]
slug: descomposicion-multi-scope-y-paralelizacion-de-usts-independientes
---

**Contexto**: el pipeline trata un spec como una unidad atómica. Si el spec tiene 5 USTs, se procesan en un solo flujo continuo — contextos que se llenan, feedback loop lento, USTs independientes en serie.

**Directiva del usuario (Fabian, 2026-06-04)**: "Si una conversación o spec tiene muchas USTs, completarlas paso a paso, no un solo flujo. Si una UST no depende de otra, paralelizarla."

**Solución implementada**:
1. Regla de descomposición: ≥3 USTs independientes → N scopes via `todowrite` con prefijo `[scope:id]`. 1-2 USTs → un solo scope.
2. Análisis de dependencias: sección `## Dependencias entre USTs` en todo spec, con tabla `UST → Depende de → ¿Paralelizable?`.
3. Agrupamiento topológico: capa 1 = USTs sin deps; capa N = USTs cuyas deps están en capas <N.
4. Paralelización real: `task` tool de opencode invocado N veces en una sola respuesta (paralelismo a nivel de tool calls).
5. Skill `scope-orchestrator` codifica el patrón completo (5 pasos).

**Convención de nombres de scope**: el plugin regex `[\w.-]+` no soporta `/`. Usar `feature-nombre-corto` o `bugfix.nombre-corto`. `feature/nombre` falla silenciosamente (el scope cae al default `main`).

**Leccion**: el plugin multi-scope ya existía técnicamente, pero la documentación y el comportamiento del agente no lo aprovechaban. La mejora es 90% documentación + 10% tooling (skill + script de validación). La paralelización real entre scopes requiere que el `task` tool procese invocaciones concurrentes — esto se valida empíricamente en el primer uso real con N task tools.

**Como aplicar**: al recibir un spec o conversación con muchas tareas, primero contar USTs/tareas y detectar dependencias. Si ≥3 independientes, descomponer y procesar por capas. Si 1-2, mantener un solo scope. Para validar empíricamente, crear un spec de prueba controlado (4 USTs en 2 capas) y un script bash con `jq` que verifique timestamps de `state.json`.

---

---
date: 2026-06-04
agent: backend
category: api-gotcha
tags: [nestjs, drizzle, postgres, di, configmodule, useFactory]
slug: nestjs-usecases-de-drizzle-no-pueden-inyectar-configservice-via-isglobal
---
**Contexto**: al boot del `authorization-service` después del merge de `feature/outbox-pattern`, NestJS tiraba `Nest can't resolve dependencies of the DrizzleModule (?). Please make sure that the argument Object at index [0] is available in the DrizzleModule context` y la app no arrancaba.

**Que paso**: el `DrizzleProvider` declaraba `inject: [ConfigService]` y leía `DATABASE_URL` desde el `ConfigService`. El `AppModule` importaba `ConfigModule.forRoot({ isGlobal: true })`. La intuición decía que `isGlobal: true` exportaba `ConfigService` globalmente y el factory provider debería poder resolverlo. Pero NO: un `useFactory` provider solo resuelve sus `inject` desde los `imports` del módulo en el que está declarado. `DrizzleModule` no importaba `ConfigModule` explícitamente, y `imports: [ConfigModule]` (sin `forRoot`) tampoco funciona — la clase `ConfigModule` no tiene providers hasta que `forRoot` corre. `DRIZZLE` era además un `Object` (no un DI token de clase), así que ni siquiera `@Inject(DRIZZLE)` se había puesto en el constructor del `DrizzleModule`.

**Fix**: (a) leer `process.env['DATABASE_URL']` directamente en el factory — sin `inject`, sin `ConfigService`. Trade-off: ya no se puede sobreescribir la URL vía testing overrides sin re-deploy. (b) `DRIZZLE` ahora provee `{ db, pool }` para que `DrizzleModule.onModuleDestroy` pueda cerrar el pool. (c) Repositorios adaptados a la nueva firma `(@Inject(DRIZZLE) provider: { db, pool })`. (d) `@Inject(DRIZZLE)` agregado al constructor del `DrizzleModule`.

**Leccion**: en NestJS, `ConfigModule.forRoot({ isGlobal: true })` exporta los providers al scope global, pero un `useFactory` provider solo puede resolver sus `inject` desde los `imports` de su módulo. Si necesitás `ConfigService` en un factory provider dentro de un módulo sin `forRoot`, o importás `ConfigModule.forFeature()` (que solo funciona si ya hubo un `forRoot` previo) o leés `process.env` directamente. Además: cuando el token de DI es un string (no una clase), el consumer SIEMPRE necesita `@Inject(TOKEN)` en el constructor — el sistema de tipos no puede inferirlo.

**Como aplicar**: al crear adapters Drizzle/TypeORM/Prisma en NestJS con DSNs, leer `process.env` directamente en el factory o usar `@Inject(ConfigService) config: ConfigService` con `imports: [ConfigModule.forFeature()]` en el módulo. Auditar cualquier `useFactory` con `inject: [ConfigService]` que no tenga `ConfigModule` en los `imports` del módulo que lo declara.

---

---
date: 2026-06-04
agent: backend
category: pattern
tags: [redis, ioredis, pubsub, listener-leak, sse, nodejs]
slug: redis-pubsub-un-listener-global-mapea-canales-a-handlers
---
**Contexto**: el `RedisNotificationSubscriberAdapter` del sse-server tenía un patrón de subscribir-y-luego-`on('message')` por cada canal. Esto acumulaba un `on('message')` listener global en el cliente ioredis por cada llamada a `subscribe()` — leak garantizado en uso prolongado.

**Que paso**: ioredis mantiene UN solo cliente por instancia, y `client.on('message', ...)` agrega un listener al EventEmitter del cliente. Cada subscribes a un canal distinto (o al mismo) llamaba `client.subscribe(channel)` Y `client.on('message', ...)`. Los listeners se acumulaban incluso cuando el canal ya tenía handler (el check `if (ch === channel)` filtraba el mensaje pero el listener seguía vivo). Con 5 conexiones HTTP a 5 stores, se acumulaban 10 listeners.

**Fix**: un único `client.on('message', (ch, msg) => handler por channel desde Map)` registrado en el constructor. `subscribe(channel, handler)` agrega al `Map<channel, handler>` y llama `client.subscribe(channel)`. `unsubscribe(channel)` borra del Map y llama `client.unsubscribe(channel)`. El listener count se mantiene en 1 sin importar cuántos canales.

**Leccion**: para pub/sub de Redis con N canales, usar UN `client.on('message')` global que dispatcha al handler del Map. NUNCA hacer `client.on('message', ...)` por cada subscribe — es O(N) y leak garantizado. El mismo principio aplica a otros pub/sub (Kafka consumer para N topics con handlers distintos, MQTT, NATS, etc.) — registrar un solo handler global y mantener el dispatch en una estructura de datos.

**Como aplicar**: al implementar adapters de pub/sub en cualquier servicio, usar Map<topic, handler> + un solo listener global. Tests: verificar que N `subscribe()` no incrementen el count de listeners. Para testear sin Redis real, `jest.mock('ioredis', () => { const factory = jest.fn()...; return { default: factory, __esModule: true }; })` y exponer helpers `__emitMessage` / `__listenerCount` en el mock.

---

---
date: 2026-06-04
agent: backend
category: api-gotcha
tags: [sse, bff, proxy, dispatch, react-native-sse, snake-case]
slug: bff-sse-proxy-debe-reemitir-todos-los-tipos-de-eventos
---
**Contexto**: el BFF `StreamService` se suscribe al SSE del sse-server vía `eventsource`. El sse-server emite DOS tipos de eventos (`authorization_request` y `physical_presence_dispatch`). El BFF solo registraba `addEventListener('authorization_request', ...)` — los `physical_presence_dispatch` se perdían en el proxy.

**Que paso**: la app móvil solo recibía `authorization_request` events. Los `physical_presence_dispatch` (PRICE_CHANGE auto-rechazado por SYSTEM) nunca llegaban al supervisor, aunque el sse-server los emitía correctamente. El bug estaba en el BFF (capa de proxy), no en el sse-server ni en la lógica de negocio. Era invisible hasta que se ejecuta un e2e que genere ambos tipos de eventos.

**Fix**: agregar `source.addEventListener('physical_presence_dispatch', ...)` en `bff/src/stream/stream.service.ts` análogo al de `authorization_request`. Test: `stream.service.spec.ts` con `jest.mock('eventsource')` para verificar que ambos tipos se re-emiten al Subject del BFF.

**Leccion**: un proxy SSE/WebSocket es un transformer opaco — debe propagar TODOS los tipos de eventos que el upstream emite, no solo los que el cliente actual usa. La spec del upstream (sse-server CLAUDE.md, OpenAPI, AsyncAPI) debe listar TODOS los tipos y el proxy debe tener un test por cada uno. El sse-server ya tenía un test (`sse.service.spec.ts`) que verificaba AMBOS canales en su lado — el BFF no tenía tests, y por eso el bug entró.

**Como aplicar**: al escribir o auditar un proxy SSE/WebSocket/MQTT, leer la spec del upstream, listar TODOS los tipos de eventos, y agregar un test por cada uno que verifique el re-emit. Si agregás un nuevo tipo de evento al upstream, el proxy debe ser actualizado en el mismo PR — considerá un test que falle si el proxy no tiene `addEventListener` para un evento que el upstream emite.

---

---
date: 2026-06-04
agent: backend
category: setup
tags: [tsbuildinfo, nestjs-build, incremental, typescript]
slug: nestjs-build-puede-salir-0-sin-crear-dist-por-tsbuildinfo-stale
---
**Contexto**: `pnpm exec nest build` puede retornar exit code 0 y no crear `dist/main.js` cuando el archivo `tsconfig.build.tsbuildinfo` (o `tsconfig.tsbuildinfo`) está corrupto o stale. El síntoma: el comando no muestra errores, termina "exitosamente", y el siguiente `node dist/main` falla con "Cannot find module" o ejecuta una versión vieja del código.

**Que paso**: TypeScript con `incremental: true` (configurado en `tsconfig.base.json` del repo) usa el `*.tsbuildinfo` para cachear qué archivos ya emitió. Si ese cache se desincroniza con el filesystem (ej. se borraron `dist/` o se cambió el `tsconfig.build.json`), tsc decide que no hay nada que emitir y sale 0 sin tocar `dist/`. El `nest build` envuelve `tsc` y hereda este comportamiento silencioso. En el bugfix de e2e, perdí 10 minutos depurando "por qué el nuevo código no corre" hasta que borré el `tsbuildinfo` manualmente.

**Fix**: `rm -f tsconfig.tsbuildinfo tsconfig.build.tsbuildinfo && pnpm exec nest build`. Después de esto el build emite normalmente. Considerar agregar este paso al `build` script del package.json como prefijo: `"build": "rm -f tsconfig.build.tsbuildinfo && nest build"`.

**Leccion**: cuando un build de TypeScript sale 0 y no produce el output esperado, lo primero a sospechar es el `*.tsbuildinfo`. El skill `open-supervisor-infra` (sección E-1) ya documenta este caso pero solo lo cubre para borrar `tsconfig.tsbuildinfo` — también hay que borrar `tsconfig.build.tsbuildinfo` si existe.

**Como aplicar**: si `nest build` sale 0 y `dist/main.js` no existe o tiene fecha vieja, `rm -f tsconfig*.tsbuildinfo` antes de reintentar. Considerar agregar un script `clean` al package.json que borre los buildinfos y `dist/` para tener un build 100% reproducible.

---
date: 2026-06-04
agent: bugfix
category: pattern
tags: [react-native, state-management, sse, mobile]
slug: lista-solicitudes-no-se-actualiza-tras-decision
---

**Contexto**: Bug donde al presionar "Autorizar" o "Rechazar" en la app, se volvía al listado de solicitudes pero la solicitud resuelta seguía apareciendo como pendiente.

**Qué pasó**: `useSSERequests` no exponía ningún mecanismo para refrescar la lista tras una decisión exitosa. El flujo era: `DetailView` llama `onBack()` → `setSelectedId(null)` → vuelve a la lista sin tocar el estado `requests`. La lista solo se actualizaba vía SSE (cuando llegaba un nuevo request) o en la carga inicial. El backend filtraba correctamente (`WHERE status = 'PENDING'`), pero la app nunca pedía los datos actualizados al volver.

**Lección**: Cuando una pantalla de detalle modifica el estado del backend que alimenta una lista, esa lista debe refrescarse inmediatamente al volver — no depender de un evento externo futuro (SSE, polling). Exponer una función `refetch` desde el hook de datos y llamarla desde el callback post-decisión (no desde `onBack` genérico, que también se usa para el botón "Volver" sin cambios). Separar `onBack` (navegación simple) de `onDecisionComplete` (navegación + refetch).

**Cómo aplicar**: Todo hook que gestione una lista de entidades mutables debe exponer un `refetch()`. Toda pantalla de detalle con acciones que modifican la lista debe tener un callback `onDecisionComplete` separado de `onBack`.

---

date: 2026-06-05
agent: backend
category: spec-process
tags: [spec, cierre-documental, legado]
slug: specs-tempranos-pueden-carecer-de-cierre-formal
---

**Contexto**: Revisión de specs sin implementar en el proyecto. Se encontró que el spec `verificacion-trabajador-active-directory` (2026-06-02) tenía todo el código implementado y 94 tests pasando, pero nunca se marcó como `completed` ni tenía sección `## Resultado`.

**Qué pasó**: Los specs más antiguos del proyecto (anteriores a 2026-06-03) fueron creados antes de que existiera la convención de agregar `## Resultado` al cierre del pipeline. El spec quedó en estado "Activo" aunque la feature estaba completamente implementada.

**Lección**: Antes de asumir que un spec viejo está "sin implementar", verificar si el código correspondiente existe en el tree y los tests pasan. Hacer una auditoría completa (ports, adapters, use-cases, tests) antes de lanzar un nuevo pipeline.

**Cómo aplicar**: Al revisar specs legacy: (1) buscar el código correspondiente con grep de nombres de use-case/port/adapter, (2) correr los tests asociados, (3) si todo existe y pasa, hacer el cierre documental (agregar `## Resultado` y marcar `[x]`) en lugar de re-implementar.

---

date: 2026-06-05
agent: backend
category: spec-process
tags: [parallel, task-tool, multi-scope, solid, hexagonal]
slug: specs-independientes-paralelizables-con-task-tool
---

**Contexto**: Implementación simultánea de 3 specs no implementados: `cambio-precio-pos` (cierre documental, ya implementado), `authorization-service-solid` (SRP + @Interval) y `bff-hexagonal-ports` (HttpService + IEventSourceConnector).

**Qué pasó**: `cambio-precio-pos` estaba 100% implementado (94/94 tests) pero sin cierre formal — mismo patrón que `verificacion-trabajador-active-directory`. Los otros dos specs tocaban servicios completamente distintos (authorization-service vs BFF), sin overlap de archivos, lo que permitió ejecutarlos en paralelo con `task` tool.

**Lección**: Antes de lanzar sub-agentes en paralelo, verificar que no haya overlap de archivos entre los specs. Si dos specs modifican el mismo archivo (ej. `authorization.module.ts`), secuencializarlos. Si tocan servicios distintos, son perfectamente paralelizables. El patrón se reduce a: (1) auditar specs legacy → cierre documental rápido, (2) specs nuevos en servicios distintos → `task` tool paralelo.

**Cómo aplicar**: Al recibir múltiples specs: grepear los archivos que cada spec modificaría, construir una matriz de overlap, paralelizar solo specs con intersección vacía de archivos modificados.

---
date: 2026-06-05
agent: pipeline
category: setup
tags: [opencode, subagents, models, skills, harness]
slug: opencode-multi-model-subagents-go
---

**Contexto**: Consolidación del harness para que opencode pueda usar subagentes con modelos distintos por rol (spec, architect, qa, backend, frontend), espejando lo que Claude Code ya hacía con `.claude/agents/`.

**Qué pasó**: opencode soporta subagentes nativos con modelo propio via `.opencode/agents/*.md` con frontmatter YAML (`model`, `mode: subagent`, `permission`). Los modelos de suscripción Go usan el prefijo `opencode-go/<model-id>` (ej. `opencode-go/deepseek-v4-pro`). Las skills se consolidaron en `.claude/skills/` como fuente única. Los specs se migraron a XML con versionado (`<history>`, `<result>`, `spec@revision`).

**Lección**: Para configurar subagentes con modelos distintos en opencode:
- Crear `.opencode/agents/<nombre>.md` con frontmatter: `description`, `mode: subagent`, `model: opencode-go/<id>`, `permission`
- Agregar `agent.<primary>.permission.task` en `opencode.json` para que el agente primario pueda invocarlos
- Los modelos Go son flat-rate ($10/mes) — usar `deepseek-v4-flash` (31K req/5h) para agentes de alta frecuencia, `deepseek-v4-pro` (3.4K req/5h) para agentes de razonamiento
- No usar `/` en nombres de scope — el regex del plugin solo acepta `[\w.-]+`

**Cómo aplicar**: Al agregar un nuevo subagente a opencode, seguir el patrón de frontmatter YAML + task permissions. Al elegir modelo, priorizar Go (flat-rate) para uso frecuente.

---

---
date: 2026-06-08
agent: architect + backend + frontend
category: pattern
tags: [mobile, sse, physical-presence, gluestack-ui, animated-api]
slug: hamburger-menu-presencia-fisica
---

**Contexto**: implementando menú hamburguesa con badges de pendientes y presencia física en la app móvil React Native + Gluestack-UI.

**Qué pasó**: el evento SSE `physical_presence_dispatch` ya fluía por todo el backend (Redis → sse-server → BFF → SSE proxy) pero la app móvil lo ignoraba completamente porque `useSSERequests` solo registraba listener para `authorization_request`. El `PhysicalPresenceDispatchDto` existía en `shared-types` desde antes pero sin usar en mobile.

**Lección**: al agregar features que dependen de streams de eventos existentes, verificar primero si el dato ya está disponible en el pipeline. En este caso, solo se necesitó un hook nuevo (`usePhysicalPresenceDispatches`) que abre su propio EventSource y escucha `physical_presence_dispatch`, sin tocar el backend. Para `useLogout`, `multiRemove` no estaba tipado en la versión instalada de `@react-native-async-storage/async-storage` — usar `removeItem` individual en su lugar.

**Cómo aplicar**: antes de diseñar un endpoint o consumer nuevo, rastrear el evento desde origen (Redis channel → sse-server → BFF adapter → SSE endpoint). Si el BFF ya re-emite el evento, solo falta el listener en mobile. Para merges con conflictos en `pnpm-lock.yaml`, regenerar con `pnpm install --no-frozen-lockfile` en vez de resolver manualmente.

---
date: 2026-06-08
agent: principal
category: pipeline-gap
tags: [pipeline, validacion-empirica, automejora, accionables, retrospectiva]
slug: mejora-pipeline-validacion-empirica
---

**Contexto**: realizando una retrospectiva de la feature `hamburger-menu` donde 4 bugs sobrevivieron a QA GREEN (tests + typecheck): dependencia incompatible con Kotlin, endpoint 404 por dist desactualizado, servicio crasheó tras restart, ruta incorrecta en spec.

**Qué pasó**: el pipeline cerraba features en verde sin validar en entorno real. Se identificaron 22 accionables (A1-A22) asignados a 7 agentes. Se diseñó un paso 5b/6 Validación Empírica con 4 checklists (A: Mobile UI, B: Endpoints REST, C: SSE/Real-time, D: Infra/Dependencias) y un paso 7 Automejora que promueve lecciones recurrentes: nivel 1 → skill, nivel 2 → regla activa, nivel 3 → bloqueante del pipeline.

**Lección**: `pnpm test` + `pnpm typecheck` no detectan bugs de integración (build Android, runtime, rutas HTTP). La validación empírica (build real + curl + UIAutomator) debe ser parte del pipeline, no un paso manual opcional. La automejora debe ser automática: `extract-learnings.ts` → contar ocurrencias → promover a reglas.

**Cómo aplicar**: (1) cada feature que toca mobile ejecuta checks A.1-A.5 obligatoriamente, (2) cada feature que agrega endpoints ejecuta B.1-B.5, (3) si un check falla, el pipeline vuelve a RED con el output exacto del fallo, (4) el agente principal ejecuta el paso 7 tras cada cierre, (5) skills de agente se actualizan automáticamente con lecciones promovidas.


---
date: 2026-06-08
agent: claude
category: setup
tags: [coordinacion, claude-code, opencode, git, hooks, working-tree]
slug: coordinacion-sesiones-working-tree-compartido
---

**Contexto**: Claude Code y opencode comparten el mismo working tree. Durante una tarea, cambios de rama de la sesión concurrente descartaron trabajo sin commitear (tracked y untracked) dos veces.
**Qué pasó**: no había ningún mecanismo que avisara/bloqueara operaciones git destructivas (`checkout -f`, `reset --hard`, `clean -f`) cuando el árbol compartido tenía cambios pendientes.
**Lección**: la protección efectiva NO es un lock complejo entre herramientas, sino un guard tool-agnóstico que bloquea operaciones git destructivas **cuando `git status --porcelain` no está vacío**. Como el árbol es compartido, proteger "árbol sucio" protege a ambas sesiones por construcción. Implementado en `.opencode/pipeline/coordination.sh` (`guard-git`), cableado en Claude Code vía `PreToolUse(Bash)` y en opencode vía plugin. Estado compartido en `coordination.json` (gitignored).
**Cómo aplicar**: para detectar comandos en un string sin parser de shell, anclar el match a posición de comando (`(^|[;&|(])` + comando) para no matchear menciones en comillas; aun así quedan falsos positivos con separadores dentro de comillas → ofrecer override (`COORD_OVERRIDE=1`). Defensa de fondo > precisión perfecta: commitea o `git stash -u` antes de cambiar de contexto. La lección operativa más barata: **commitear temprano** protege contra clobbers de sesiones concurrentes (es lo que cortó la sangría aquí).

---
date: 2026-06-10
agent: orchestrator
category: spec-process
tags: [pipeline, pre-spec, xml, language-standardization]
slug: pipeline-improvements-2026-06-10
---

**Contexto**: Mejorando el pipeline para estandarizar procesos: evitar iniciar features cuando dev tiene trabajo pendiente, formalizar el formato XML de instrucciones a sub-agentes, y estandarizar el idioma de specs/instrucciones.

**Qué pasó**: Tres mejoras implementadas:
1. `pre-spec.sh` ahora clasifica commits huérfanos en dev: feature/fix → FAIL duro (deben tener PR a main), chore/learnings → WARN suave
2. Nuevo validador XML (`scripts/validate-agent-instructions.ts`) que chequea well-formedness, elementos requeridos (`<meta>`, `<context>`, `<tasks>`, `<constraints>`) y tags no vacíos antes de enviar instrucciones a backend/frontend
3. Todas las definiciones de agentes (.opencode y .claude) traducidas a inglés + política de idioma documentada en CLAUDE.md

**Lección**: 
- El pre-spec check debe bloquear proactivamente escenarios que causarán problemas más adelante (dev con feature work no mergeado a main = nueva feature desde main no incluye ese trabajo)
- La validación XML evita que sub-agentes reciban instrucciones mal formadas y tomen decisiones incorrectas
- La estandarización de idioma (specs y agentes en inglés, conversación con usuario en su idioma) reduce ambigüedad entre herramientas

**Cómo aplicar**:
1. Antes de iniciar cualquier feature, ejecutar `bash .opencode/pipeline/pre-spec.sh` — si falla por feature/fix commits en dev, abrir PR dev→main
2. Al preparar instrucciones para backend/frontend, validar con `npx tsx scripts/validate-agent-instructions.ts <archivo>` antes de enviar
3. Escribir specs y prompts de agentes en inglés; mantener conversación con el usuario en el idioma inicial

---
date: 2026-06-11
agent: architect
category: pattern
tags: [pre-commit, ci-cd, testing, github-actions]
slug: ci-cd-and-pre-commit-test-validation
---

**Contexto**: configurando CI/CD + pre-commit hook que ejecuta tests.

**Qué pasó**: un pre-commit que corre todos los tests es muy lento; en cambio, mapear staged files a packages del monorepo y ejecutar solo los tests afectados balancea velocidad y confianza. Para la CI (PR → dev), un job validate (tests unitarios + typecheck + lint) da feedback rápido, y un job e2e (Detox + emulador Android) da validación completa.

**Lección**: dividir en capas: pre-commit → tests solo de packages afectados; CI → validate (rápido, bloqueante) + e2e (lento, opcional). Usar `pnpm --filter` con mapeo explícito de paths a packages, e incluir `--passWithNoTests` para packages sin tests aún.

**Cómo aplicar**: al agregar validación de tests a hooks de git, nunca correr la suite completa. Mapear `git diff --cached --name-only` contra `pnpm-workspace.yaml` para determinar qué packages están afectados. Si `shared-types` cambia, correr tests en todos los consumers.

---
date: 2026-06-10
agent: architect
category: pattern
tags: [docker, arm64, sonarqube, apple-silicon, verification]
slug: verify-multiarch-docker-images-before-recommending
---

**Contexto**: validando viabilidad de SonarQube Community Edition para desarrollo en Apple Silicon. El spec asumía que sería necesario emular con `--platform linux/amd64` via Rosetta.

**Qué pasó**: la API de Docker Hub (`hub.docker.com/v2/repositories/library/sonarqube/tags`) confirmó que todas las versiones recientes de SonarQube Community Edition (9.x, 25.x, 26.x) tienen imágenes nativas `arm64` con variante `v8`. El workaround de emulación era innecesario. Por otro lado, `sonarsource/sonar-scanner-cli` SÍ es amd64-only — para ese hay que usar el wrapper npm.

**Lección**: antes de asumir que una imagen Docker no tiene soporte arm64, verificar con la API de Docker Hub. La mayoría de imágenes oficiales hoy son multi-arch. Consultar `https://hub.docker.com/v2/repositories/<namespace>/<repo>/tags?name=<filter>&page_size=20` y buscar `"architecture":"arm64"` en los resultados.

**Cómo aplicar**: en el paso de architect, para cualquier nueva dependencia Docker, hacer un `webfetch` a la API de tags de Docker Hub y verificar explícitamente qué arquitecturas están disponibles. Documentar en la sección de viabilidad del spec enriquecido. Si solo amd64 está disponible, especificar el workaround exacto (`--platform linux/amd64` para Docker, o wrapper alternativo como npm package para el scanner).

---
date: 2026-06-10
agent: backend
category: api-gotcha
tags: [jest, ts-jest, __dirname, path-resolution, sonarqube]
slug: ts-jest-dirname-resolution-for-fixture-files
---

**Contexto**: escribiendo tests que validaban la existencia de `sonar-project.properties` usando `fs.existsSync` y `fs.readFileSync` con `resolve(__dirname, '../../', ...)`.

**Qué pasó**: `__dirname` en ts-jest apunta al directorio del archivo fuente `.ts`, no a `dist/` ni a la raíz del proyecto. Usar `resolve(__dirname, '..', 'package.json')` desde `<service>/src/sonar-config.spec.ts` resuelve correctamente a `<service>/package.json`. Usar `resolve(__dirname, '../..', ...)` desde el mismo archivo sube de más (resuelve a `apps/` en lugar del service root).

**Lección**: en ts-jest (transpilación in-memory), `__dirname` siempre es el directorio del archivo `.ts` fuente. Para calcular la raíz de un servicio desde `src/`, usar `resolve(__dirname, '..')`. Un nivel extra de `..` rompe la ruta. Esto difiere de Jest con Babel, donde `__dirname` puede ser `dist/`.

**Cómo aplicar**: al leer archivos del service root desde tests en `src/`, usar `resolve(__dirname, '..', '<archivo>')` — no `resolve(__dirname, '../..', ...)`. Probar con un `existsSync` antes de asumir que la ruta es correcta.

---
date: 2026-06-10
agent: backend
category: pattern
tags: [sonarqube, quality-gate, spec, architect-contract]
slug: quality-gate-metric-names-match-architect-contract-over-criteria
---

**Contexto**: implementando US-03 (Quality Gate) del spec SonarQube. Las condiciones de aceptación en las historias de usuario mencionaban "Blocker Bugs > 0" y "Critical Bugs > 0" sin el prefijo `new_`.

**Qué pasó**: el contrato TypeScript detallado en el spec (sección "Archivos a crear/modificar") usaba `new_blocker_violations` y `new_critical_violations` — con prefijo `new_`. Seguir el contrato del arquitecto vs las criteria de las historias significaba elegir entre dos interpretaciones. El arquitecto tenía razón: en SonarQube, las quality gates operan sobre "New Code" por defecto, y los nombres `new_*` son los que aparecen en el API de quality gates.

**Lección**: cuando hay discrepancia entre las historias de usuario (que usan lenguaje funcional) y el contrato detallado del arquitecto (que especifica nombres de API exactos), el contrato del arquitecto es la fuente autoritativa. Los tests RED deben validar contra los nombres exactos del contrato, no contra la interpretación funcional de las criteria.

**Cómo aplicar**: al escribir tests RED para configuraciones de API (JSON, propiedades, endpoints), leer cuidadosamente la sección "Archivos a crear/modificar" del spec — ahí están los nombres exactos que el arquitecto validó. Actualizar los tests si la sección de criteria usa nombres genéricos que difieren del contrato detallado.

