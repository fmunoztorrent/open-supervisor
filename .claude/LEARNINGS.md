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
agent: qa
category: test-strategy
tags: [jest, ts-jest, tsconfig, workspace, sse-server]
slug: sse-server-necesita-tsconfig-spec-para-jest
---

**Contexto**: al agregar el primer spec al `sse-server`, ts-jest seguía lanzando `TS2307: Cannot find module '@open-supervisor/shared-messaging'` aunque el `moduleNameMapper` estaba correctamente configurado en `package.json#jest`.
**Qué pasó**: ts-jest resuelve los tipos en tiempo de compilación usando el tsconfig — no el `moduleNameMapper` de Jest. Sin un `tsconfig.spec.json` con `paths` apuntando a `node_modules/@open-supervisor/shared-messaging/src`, TypeScript no encontraba el módulo aunque Jest sí podía resolverlo en runtime.
**Lección**: cualquier servicio que agregue tests con workspace packages necesita dos cosas: (1) `moduleNameMapper` en jest config para la resolución en runtime, y (2) `tsconfig.spec.json` con `baseUrl: "."` y `paths` apuntando a `node_modules/.../src` para la resolución en compilación. Seguir el patrón de `authorization-service/tsconfig.spec.json` como referencia.
**Cómo aplicar**: al configurar Jest en un servicio NestJS nuevo que importe workspace packages, copiar tanto el `moduleNameMapper` como el `tsconfig.spec.json` del `authorization-service`. Actualizar `transform` en jest config para que ts-jest use `tsconfig.spec.json` explícitamente.

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
agent: qa
category: test-strategy
tags: [tsc, typecheck, workspace, paths, baseUrl, pre-existing]
slug: typecheck-tsc-falla-sin-baseurl-en-tsconfig-json
---

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
agent: qa
category: test-strategy
tags: [react-native, jest, tsconfig, testing-library, types, rntl]
slug: rntl-matchers-requieren-types-en-tsconfig-y-global-d-ts
---

**Contexto**: FASE GREEN mobile — `pnpm typecheck` fallaba con TS2339 en `toBeOnTheScreen`, `toBeDisabled`, `toBeEnabled` y TS2304 en `global`.
**Qué pasó**: (1) Las RNTL v12 extended matchers están declaradas en `@testing-library/react-native/build/matchers/types.d.ts` dentro de un `declare global { namespace jest {} }` block — se cargan solo si la entrada `types` del tsconfig las incluye. Sin esa entrada, `jest.Matchers` no extiende `JestNativeMatchers` y los matchers son invisibles para tsc. (2) La `lib: ["es2019"]` no incluye el global `NodeJS.Global`, así que `global.fetch` en los tests lanzaba TS2304. Solución: añadir `"types": ["jest", "@testing-library/react-native/extend-expect"]` en `tsconfig.json` y un archivo `src/global.d.ts` con `declare var global: typeof globalThis`.
**Lección**: en proyectos React Native, el tsconfig de la app móvil necesita declarar explícitamente los tipos de test runner. Cuando se especifica `types: [...]`, TypeScript deja de incluir automáticamente los `@types/*` del `node_modules` — hay que listar `jest` además de RNTL. El `global` de Node.js no forma parte de las libs ES ni de las libs de React Native: requiere un `declare var global` o `@types/node`.
**Cómo aplicar**: al configurar tsconfig para una app React Native con Jest + RNTL, incluir siempre `"types": ["jest", "@testing-library/react-native/extend-expect"]` y crear `src/global.d.ts` con `declare var global: typeof globalThis` antes de correr typecheck.

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
agent: frontend
category: setup
tags: [react-native, jest, pnpm, scaffold, EventSource, generic]
slug: react-native-sse-eventSource-generic-para-typecheck
---

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
agent: architect
category: setup
tags: [lsp, typescript, opencode, claude-code, config, plugin]
slug: lsp-built-in-opencode-plugin-oficial-claude-code
---

**Contexto**: cierre del spec `mejora-agentes` (US-04 LSP). El spec original asumía que LSP requería un "plugin de code intelligence externo" y quedó bloqueado.
**Qué pasó**: (1) opencode v1.15+ tiene LSP built-in para TypeScript vía tsserver — solo requiere `"lsp": true` en `opencode.json`. No necesita plugins externos. (2) Claude Code tiene un plugin oficial de Anthropic (`typescript-lsp@claude-plugins-official`) activado vía feature flag `ENABLE_LSP_TOOL` en `~/.claude/settings.json`. Requiere `typescript-language-server` y `typescript` instalados globalmente. (3) El feature flag está documentado en GitHub issue #15619, no en docs oficiales.
**Lección**: LSP no requiere plugin externo en opencode — es built-in. En Claude Code, el setup es: (a) `npm install -g typescript-language-server typescript`, (b) agregar `"env": { "ENABLE_LSP_TOOL": "1" }` y `"enabledPlugins": { "typescript-lsp@claude-plugins-official": true }` a `~/.claude/settings.json`. El `ENABLE_LSP_TOOL` puede generar warnings de schema (no está en el schema oficial) pero funciona.
**Cómo aplicar**: en cualquier proyecto TypeScript con opencode, activar LSP con `"lsp": true`. Para Claude Code, seguir los 2 pasos de instalación + config. Si se agrega un nuevo LSP para otro lenguaje (Python, Go), verificar si opencode ya lo soporta built-in antes de buscar plugins externos.

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
Para levantar la infra con Podman: `DOCKER_HOST=unix:///Users/fabianmunoz/.local/share/containers/podman/machine/podman.sock podman compose up -d`

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
agent: frontend
category: pattern
tags: [react-native, hooks, useRef, debounce, sse]
slug: debounce-async-refetch-useref

**Contexto**: implementando background refresh automático al recibir SSE en useSSERequests hook.

**Qué pasó**: al reemplazar prepend directo por refetch completo en el listener SSE, necesitábamos:
1. Debounce de 2s para evitar múltiples refetches por ráfagas de SSE
2. Un flag `isRefreshingBackground` para el indicador UI
3. Cleanup correcto del timeout al desmontar

**Lección**: el patrón `useRef<setTimeout>` es la forma correcta de manejar debounce dentro de hooks React que usan `useEffect` con SSE listeners. Tres cosas críticas:
- El timeout se limpia en el `cancelled` flag del return del useEffect
- El `setIsRefreshingBackground(true)` se dispara **sincrónicamente** en el listener (no dentro del setTimeout) para feedback inmediato
- Para guards de "initial load complete" no se puede usar la variable `isLoading` del closure (siempre captura el valor inicial). Usar `useRef<boolean>` en su lugar.

**Cómo aplicar**: cuando un hook necesite disparar refetches asíncronos con debounce desde un listener (SSE, WebSocket, polling), usar `useRef` para el timeout y `useRef` para flags de estado que necesitan ser leídos desde closures. No confiar en state variables de `useState` dentro de closures de useEffect.

---
date: 2026-06-04
agent: claude
category: pattern
tags: [react-native, testID, uiautomator, accesibilidad, prop-wiring, state-empty]
slug: indicador-background-refresh-wiring-y-accesibilidad
---

**Contexto**: depurando por qué el indicador "Sincronizando..." del background refresh nunca aparecía en UIAutomator, a pesar de que los logs y tests confirmaban que la lógica funcionaba.

**Qué pasó**: dos problemas encadenados:
1. **Prop no conectado**: `App.tsx` destructureaba `isRefreshingBackground` del hook pero no lo pasaba a `AuthorizationList`. El componente usaba el default `false`.
2. **Estado vacío oculta el indicador**: `AuthorizationList` retorna temprano cuando `requests.length === 0`, antes del JSX condicional del indicador. Para ver el indicador deben existir cards previas.
3. **testID invisible**: React Native `testID` no expone `resource-id` a UIAutomator sin `accessible={true}`.

**Lección**: 
- En React Native, `testID` no es suficiente para UIAutomator — agregar `accessible={true}` y `accessibilityLabel` si se necesita detección por accesibilidad.
- Cuando un componente tiene layout condicional (estado vacío vs con datos), el indicador de "cargando en background" debe renderizarse en AMBAS ramas, no solo en la rama con datos.
- Los tests de integración (App.test.tsx con mocks de hooks) son esenciales para detectar prop-wiring olvidado.

**Cómo aplicar**: 
- Siempre agregar un test de integración que verifique que los props se pasan de padre a hijo.
- Para indicadores/estados que deben persistir entre layouts, renderizarlos fuera del condicional `requests.length === 0`.
- Para E2E con UIAutomator, usar `accessible={true}` en elementos que necesitan ser detectados por resource-id.

---
date: 2026-06-04
agent: claude
category: setup
tags: [skills, portabilidad, podman, docker, adb, agnostico, opencode, qa]
slug: skills-infra-emulator-agnosticos-en-el-repo
---

**Contexto**: los skills `open-supervisor-infra` y `open-supervisor-emulator` vivían solo en `~/.claude/skills/` (config personal) y tenían rutas absolutas de la máquina del autor — incluido el socket Podman `unix:///Users/fabianmunoz/.local/share/.../podman.sock`. Un dev que clonara el repo no los recibía y, si los recibía, no funcionaban.

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
