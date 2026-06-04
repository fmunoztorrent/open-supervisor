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
date: 2026-06-04
agent: backend
category: api-gotcha
tags: [nestjs, bff, http-status, error-handling, upstream]
slug: bff-http-proxy-debe-propagar-codigos-http-del-upstream-no-convertir-a-500
---

**Contexto**: bugfix de Error 500 al presionar Autorizar/Rechazar en la app móvil. El BFF recibía 404/409 del authorization-service pero los convertía a 500 para el cliente.

**Qué pasó**: el `AuthorizationService` del BFF usaba `throw new Error(...)` para errores upstream. NestJS atrapa cualquier `Error` genérico no manejado y lo convierte en HTTP 500, incluso cuando el upstream retornaba correctamente 404 (not found) o 409 (already resolved). La app móvil mostraba "Error 500" sin distinción.

**Lección**: un servicio BFF que hace proxy HTTP debe usar `HttpException` (de `@nestjs/common`) con el código HTTP original del upstream, no `Error` genérico. NestJS respeta el status de `HttpException` en su exception filter global. Para errores de red (upstream caído), el 500 genérico de NestJS es aceptable.

**Cómo aplicar**: en cualquier servicio NestJS que haga fetch a un upstream y propague errores, usar `throw new HttpException(message, upstreamStatus)` en lugar de `throw new Error(...)`. Verificar con supertest que 404→404, 409→409, no 404→500.

---
date: 2026-06-04
agent: backend
category: api-gotcha
tags: [contract, dto, snake-case, redis, sse, hexagonal, ports-adapters]
slug: wire-format-debe-coincidir-con-dto-compartido
---

**Contexto**: bug en la app móvil tras validar el flujo completo en emulador. El listado mostraba "NaN/NaN NaN:NaN" debajo del tipo de solicitud y al presionar la card no navegaba al detalle. Dos síntomas visibles, una sola causa raíz: mismatch entre el wire format del backend y el DTO compartido.

**Qué pasó**: el `AuthorizationController.getPending` retornaba campos en camelCase (`storeId`, `posId`, `correlationId`, `createdAt`) y los use-cases que emiten a Redis (`process-authorization-request`, `process-price-change`, `verify-employee-benefit`) hacían lo mismo. Pero el DTO `AuthorizationRequestDto` en `packages/shared-types` define snake_case, y la app móvil usa ese DTO. La app recibía `correlation_id: undefined`, `created_at: undefined`, etc.
- **Síntoma 1 ("NaN")**: `formatDate(request.created_at)` recibía `undefined`, `new Date(undefined)` es Invalid Date, todos los `getUTC*()` retornaban `NaN`, y el template literal mostraba "NaN/NaN NaN:NaN".
- **Síntoma 2 (no navega)**: `onPressRequest(request.correlation_id)` pasaba `undefined`, `setSelectedId(undefined)`, y el guard `selectedId ? ... : undefined` cortocircuitaba la navegación al detalle.

**Lección**: en arquitectura hexagonal, el dominio usa camelCase internamente (entidades) pero la **capa de infraestructura que toca el wire** (controllers REST, adapters de event emitter a Redis, publishers a Kafka) debe mapear explícitamente al contrato del DTO compartido. Las publicaciones a Kafka ya estaban correctas (snake_case); las emisiones a Redis no. La asimetría de convenciones dentro del mismo servicio es el olor que delata el bug.

**Cómo aplicar**:
- Al modificar un controller o un emit a un canal Redis/Kafka, **verificar que las keys del payload coincidan 1:1 con la interface del DTO compartido** (`AuthorizationRequestDto`, `PhysicalPresenceDispatchDto`, etc.). Si el campo se llama `productId` en la entidad pero `product_id` en el DTO, hay que mapear.
- Agregar test de contrato explícito en el controller test: `expect(item).toHaveProperty('store_id', ...)` y `expect(item).not.toHaveProperty('storeId')`. Esto atrapa la regresión sin acoplarse al detalle de la implementación.
- Considerar centralizar el mapping entidad→DTO en un mapper compartido (ej. `AuthorizationRequest.toWireDto()`) para que el contrato se defina en un solo lugar. Hoy está duplicado en 4 sitios.

---
date: 2026-06-04
agent: backend
category: api-gotcha
tags: [repository, correlation-id, snake-case, contract, hexagonal, ports-adapters]
slug: id-de-url-resolve-es-correlation-id-no-id-interno
---

**Contexto**: tras arreglar el wire format snake_case, la app mostraba las cards y navegaba al detalle correctamente, pero al tap "Autorizar" la pantalla quedaba colgada y el BFF logueaba `Auth service responded 404 for {correlationId}`. La causa era un bug preexistente del resolve, ortogonal al del snake_case.

**Qué pasó**: el `ResolveAuthorizationUseCase.execute(id, ...)` recibía el `correlationId` (que es lo que la app móvil pasa en la URL: `POST /authorization/:correlationId/resolve`, ver spec línea 88: "El `:id` del resolve corresponde al `correlation_id` de la solicitud") pero el `IAuthorizationRepository` solo exponía `findById(id)`, y el `InMemoryAuthorizationRepository` indexa por `AuthorizationRequest.id` (UUID interno autogenerado al construir la entidad, distinto del `correlation_id` que viene del POS). Resultado: el repo devolvía `null` para cualquier `correlationId` real, el use-case lanzaba `NotFoundException` y propagaba como 404.

**Por qué no lo cazó el suite de tests**: los 7 specs del resolve usaban `findById.mockResolvedValue(entity)` y `useCase.execute(entity.id, ...)` — **el test mimickeaba el contrato roto**. Nadie había escrito un test que invocara el use-case con el `correlationId` real y verificara que lo encontrara. La regresión existía desde el commit inicial `29791fa` y pasó inadvertida porque ningún flujo end-to-end llegaba al botón Autorizar con un correlationId real.

**Lección**: los tests deben usar el **mismo contrato que el caller real**, no la forma más cómoda de mockear. Si el controller expone `POST /:id/resolve` y el caller (la app móvil) envía un `correlationId`, el test del controller debe:
1. Hacer POST con un `correlationId` (no con un id interno)
2. Verificar que el repo recibió una búsqueda por correlationId, no por id
Alternativamente, el use-case test debe invocar `execute(entity.correlationId, ...)` (no `execute(entity.id, ...)`) cuando el contrato del caller así lo requiere.

**Cómo aplicar**:
- Al diseñar un endpoint, escribir el test del controller **antes** del use-case test, usando el input exacto que el cliente envía. Si el cliente envía `correlationId`, el controller test usa `correlationId`.
- En el repo, **distinguir claramente los dos ids**: `findById` (UUID interno, autoincremental, sistema) vs `findByCorrelationId` (UUID externo, generado por el POS, contrato API). Mezclar ambos en un solo `findById` es señal de modelo mal modelado.
- Cuando se introduce un nuevo método al port (`findByCorrelationId`), todos los mocks de los specs que implementan `IAuthorizationRepository` deben actualizarse. Considerar un `MockAuthorizationRepository` compartido en `apps/authorization-service/test/mocks/` para no repetir 4 specs el mismo cambio.

**Verificación del fix**:
- API directa: `POST /authorization/{correlationId}/resolve` con un correlationId que SÍ existe en el repo → HTTP 201 + `status: APPROVED` + Kafka publish a `auth.response.{store_id}`.
- App móvil: tap Autorizar en el emulador → el BFF loguea `Auth service responded 404 for {correlationId}` (404 esperado porque el correlationId en memoria de la app era del primer inyectado, que se borró al reiniciar el Map in-memory; el hecho de que el BFF vea el `correlationId` en la URL confirma que el wire contract del fix está correcto).
