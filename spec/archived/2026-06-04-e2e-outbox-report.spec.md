# Reporte de e2e post outbox-pattern — `debug-e2e-outbox`

**Fecha:** 2026-06-04
**Scope:** debug-e2e-outbox
**Status:** bloqueado (8 bugs encontrados, 2 resueltos en este scope, 6 requieren bugfix)

---

## TL;DR

Después del merge de `feature/outbox-pattern` a `main`, la aplicación no arranca en su
estado actual. Se detectaron **8 bugs** durante la prueba e2e. El servicio `authorization-service`
crashea al boot por un bug de DI del DrizzleModule. La app es **NO funcional** sin intervención.

---

## Setup ejecutado en este scope

1. ✅ Infra base (Kafka + Redis + Zookeeper) ya estaba `healthy`.
2. ✅ Levanté Postgres (servicio nuevo, no estaba corriendo).
3. ✅ Escribí `apps/authorization-service/.env` con `DATABASE_URL` y vars de outbox.
4. ✅ Generé y apliqué las migraciones de Drizzle (`drizzle/0000_dear_red_shift.sql`).
5. ✅ Compilé `sse-server` y `bff` (OK).
6. ⚠️  Compilé `authorization-service` después de borrar `tsconfig.build.tsbuildinfo` (E-1 del skill).
7. ✅ sse-server arrancó OK (puerto 3002, suscrito a Redis).
8. ❌ authorization-service crashea: Bug 7.
9. ❌ bff: EADDRINUSE en 3000 (proceso zombie de runs previos).

---

## Bugs encontrados

### Bloqueantes (impiden arrancar la app)

#### Bug 1 — `.env` incompleto en authorization-service
- **Archivo:** `apps/authorization-service/.env`, `.env.example`
- **Síntoma:** El servicio crashea al boot con `Error: DATABASE_URL is not set. Check .env`.
- **Causa:** Las vars requeridas por el outbox (`DATABASE_URL`, `OUTBOX_TICK_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`) no están ni en `.env` ni en `.env.example`, a pesar de que el spec `2026-06-04-outbox-pattern-fire-and-forget-kafka.spec.md` las declara como requeridas (sección "Archivos clave modificados" del spec).
- **Workaround aplicado en este scope:** Escribí un `.env` mínimo en `apps/authorization-service/`.
- **Resolución:** Agregar todas las vars a `.env.example` y documentar.

#### Bug 2 — Migraciones de Drizzle no estaban generadas (RESUELTO en este scope)
- **Archivo:** `apps/authorization-service/drizzle/` (no existía)
- **Síntoma:** El servicio no puede crear/leer el outbox porque las tablas no existen.
- **Causa:** El spec del outbox declaraba "Drizzle migrations se generan con `drizzle-kit generate` y se aplican con `pnpm db:migrate`" pero nunca se ejecutaron. El directorio `drizzle/` no estaba en el repo.
- **Resolución aplicada:** `pnpm db:generate && pnpm db:migrate`. Creó `drizzle/0000_dear_red_shift.sql` con tablas `auth.authorization_requests` y `auth.outbox`. Las migraciones ahora existen en el filesystem pero **no están commiteadas**.

#### Bug 7 — `DrizzleModule` no resuelve `ConfigService` en su `useFactory`
- **Archivo:** `apps/authorization-service/src/infrastructure/persistence/drizzle/drizzle.provider.ts`
- **Síntoma:** Al boot del servicio:
  ```
  Nest can't resolve dependencies of the DrizzleModule (?).
  Please make sure that the argument Object at index [0] is available in the DrizzleModule context.
  ```
- **Causa:** `DrizzleModule` declara `inject: [ConfigService]` en su `drizzleProvider` pero su `@Module({ imports: [] })` no importa `ConfigModule`. Aunque `ConfigModule.forRoot({ isGlobal: true })` registra `ConfigService` globalmente, los `imports` del módulo que lo consume deben incluir el módulo de origen para que la inyección de factory providers funcione.
- **Resolución:** Agregar `imports: [ConfigModule]` al `DrizzleModule`.

#### Bug 8 — BFF puerto 3000 ocupado por proceso zombie
- **Archivo:** N/A (infra)
- **Síntoma:** `EADDRINUSE: address :::3000` al boot del BFF.
- **Causa:** `kill -9 11114` no surtió efecto inicialmente; un nodo zombie retenía el puerto.
- **Resolución aplicada en este scope:** `pkill -9 -f "node dist/main"`.

### Funcionales (la app corre pero se rompe el flujo e2e)

#### Bug 3 — `RedisNotificationSubscriberAdapter.subscribe()` acumula listeners
- **Archivo:** `apps/sse-server/src/infrastructure/redis-notification-subscriber.adapter.ts`
- **Síntoma:** Cada llamada a `subscribe()` agrega un nuevo `this.subscriber.on('message', ...)` listener que queda vivo para siempre.
- **Causa:** El listener es global al cliente ioredis (no se desuscribe al `unsubscribe`). En uso normal con 1-2 canales por tienda el impacto es bajo, pero el patrón es propenso a leaks y crecimiento O(N) del listener stack si `subscribe()` se invoca muchas veces.
- **Resolución:** Reemplazar el patrón `subscribe + on('message')` por una sola subscripción al cliente con un `Map<channel, handler>` y dispatch interno. O usar `psubscribe`/`subscribe` y mantener los handlers en un Map.

#### Bug 4 — BFF `StreamService` no escucha `physical_presence_dispatch`
- **Archivo:** `apps/bff/src/stream/stream.service.ts`
- **Síntoma:** Los eventos `physical_presence_dispatch` publicados en Redis por el `authorization-service` nunca llegan a la app móvil.
- **Causa:** El método `connectToSseServer()` solo hace `addEventListener('authorization_request', ...)`. El sse-server emite dos tipos de eventos (per sse-server CLAUDE.md), pero el BFF los descarta.
- **Resolución:** Agregar `source.addEventListener('physical_presence_dispatch', ...)` análogo al de `authorization_request`.

#### Bug 5 — `waitForSseEvent` usa camelCase en wire format
- **Archivo:** `scripts/inject-request.ts` (línea 232-238)
- **Síntoma:** `pnpm inject --verify` siempre termina en timeout. El comentario en el código es engañoso: dice "Must use camelCase correlationId — NOT snake_case correlation_id", pero el wire format real es snake_case.
- **Causa:** `waitForSseEvent` parsea el JSON del evento y busca `parsed.correlationId === correlationId`. Pero el evento publicado por el `authorization-service` en Redis tiene `correlation_id` (ver `process-authorization-request.use-case.ts:45` y CLAUDE.md de shared-types: "Todos los campos DTO son snake_case").
- **Resolución:** Cambiar el check a `parsed.correlation_id === correlationId`.

#### Bug 6 — `POST /resolve` retorna camelCase en el response
- **Archivo:** `apps/authorization-service/src/authorization/authorization.controller.ts` (líneas 40-45)
- **Síntoma:** El response del endpoint usa `resolvedBy` y `resolvedAt` (camelCase), inconsistente con el resto de la API que es snake_case.
- **Causa:** El controller retorna el shape de la entidad interna (`AuthorizationRequest`) sin mapear al DTO compartido `AuthorizationResponseDto`.
- **Resolución:** Mapear el response al shape de `AuthorizationResponseDto` (snake_case) consistente con el spec del outbox.

### Build

#### E-1 (conocido) — `nest build` sale 0 pero no crea `dist/`
- **Síntoma:** Build "pasa" silenciosamente sin crear archivos en `dist/`.
- **Causa:** `tsconfig.build.tsbuildinfo` cacheaba el resultado incremental; el archivo se queda aunque `tsconfig.tsbuildinfo` se borre.
- **Resolución aplicada:** `rm -f tsconfig.build.tsbuildinfo && pnpm exec nest build`.

---

## Próximos pasos

1. Crear un **scope bugfix unificado** que arregle los 6 bugs restantes (1, 3, 4, 5, 6, 7).
2. Bug 2 ya está resuelto a nivel filesystem — falta commitear las migraciones y `.env` en el scope bugfix.
3. Después del fix, re-correr este mismo flujo e2e:
   - Levantar auth-service (debe bootear OK)
   - `pnpm inject --type DISCOUNT --store-id store-1 --pos-id pos-1 --verify`
   - Verificar que el evento llega a Redis → SSE → BFF → (opcionalmente) app
   - Verificar que `POST /resolve` encola al outbox y `OutboxPublisherService.tick()` publica a Kafka
   - Inspeccionar el topic `auth.response.store-1` en Kafka para confirmar el flow end-to-end

---

## Resultado

**Fecha de finalización:** 2026-06-04
**Status del spec:** completed (post-bugfix)

### Resumen

El scope de bugfix `bugfix.e2e-outbox-fixes` arregló los **6 bugs bloqueantes y funcionales** identificados durante la prueba e2e. La aplicación quedó **100% funcional** y se validó el flujo end-to-end completo (inyect → Kafka → outbox → SSE → BFF → Kafka response) con latencia < 50ms en el SSE.

### Bugs arreglados

| # | Componente | Fix |
|---|---|---|
| 1 | `auth-service/.env.example` | Agregadas vars `DATABASE_URL`, `OUTBOX_TICK_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`, `AD_BASE_URL`, `AD_LOOKUP_TIMEOUT_MS` |
| 3 | `sse-server/.../redis-notification-subscriber.adapter.ts` | Refactor: UN listener global que despacha a un `Map<channel, handler>`; `unsubscribe` limpia el Map. Tests con `jest.mock('ioredis')` |
| 4 | `bff/.../stream.service.ts` | Agregado `addEventListener('physical_presence_dispatch', ...)`. Spec nuevo `stream.service.spec.ts` con `jest.mock('eventsource')` |
| 5 | `scripts/inject-request.ts` | `waitForSseEvent` ahora matchea `correlation_id` snake_case (era camelCase). Spec actualizado |
| 6 | `auth-service/.../authorization.controller.ts` | `POST /resolve` retorna response snake_case (`resolved_by`, `resolved_at`, `store_id`, `pos_id`, `correlation_id`, `type`). Spec actualizado |
| 7 | `auth-service/.../drizzle.provider.ts` | `drizzleProvider` lee `process.env.DATABASE_URL` directamente. Token `DRIZZLE` provee `{ db, pool }`. `DrizzleModule` usa `@Inject(DRIZZLE)` en el constructor. Repositorios adaptados a la nueva firma |

### Archivos modificados (fix)

- `apps/authorization-service/.env.example` (Bug 1)
- `apps/authorization-service/src/infrastructure/persistence/drizzle/drizzle.provider.ts` (Bug 7)
- `apps/authorization-service/src/infrastructure/persistence/drizzle/drizzle-authorization.repository.ts` (Bug 7)
- `apps/authorization-service/src/infrastructure/persistence/drizzle/drizzle-outbox.repository.ts` (Bug 7)
- `apps/authorization-service/src/infrastructure/persistence/drizzle/drizzle-unit-of-work.ts` (Bug 7)
- `apps/authorization-service/src/authorization/authorization.controller.ts` (Bug 6)
- `apps/sse-server/src/infrastructure/redis-notification-subscriber.adapter.ts` (Bug 3)
- `apps/bff/src/stream/stream.service.ts` (Bug 4)
- `scripts/inject-request.ts` (Bug 5)

### Archivos nuevos (tests)

- `apps/sse-server/src/infrastructure/redis-notification-subscriber.adapter.spec.ts` (4 tests — Bug 3)
- `apps/bff/src/stream/stream.service.spec.ts` (3 tests — Bug 4)

### Tests

- **Unitarios:**
  - `authorization-service`: 94/94 ✅ (+1 test nuevo para Bug 6)
  - `sse-server`: 8/8 ✅ (+4 tests nuevos para Bug 3)
  - `bff`: 7/7 ✅ (+3 tests nuevos para Bug 4)
  - `inject script`: 14/14 ✅ (cambiados para Bug 5)
- **E2E real con servicios:**
  - `pnpm inject --type DISCOUNT --store-id store-1 --pos-id pos-1 --verify` → `✓ Verificado: solicitud recibida en SSE (latencia: 13ms)`
  - `POST /authorization/{corr}/resolve` → 201 con response snake_case
  - `auth.outbox` row con `status=PUBLISHED` después del tick
  - Mensaje publicado a Kafka `auth.response.store-1` con `correlation_id` y `resolved_at` correctos

### No implementado / Fuera de scope

- **Bug 2 (migraciones no generadas)**: resuelto en el scope debug (archivos `drizzle/0000_dear_red_shift.sql` y `meta/*.json` generados). **No commiteados todavía** — quedan en `.gitignore` del branch o se commitean como parte de este cierre.
- **Bug 7 desviación documentada**: el `drizzleProvider` ahora lee `process.env` directamente, evitando la fragilidad de `ConfigModule.forRoot({isGlobal:true})` con `useFactory` providers. Trade-off: ya no se puede sobreescribir `DATABASE_URL` por config externa sin re-deploy.

### Archivos modificados en este scope (sin commitear)

- `apps/authorization-service/.env` (nuevo, con DATABASE_URL y vars de outbox)
- `apps/authorization-service/.env.example` (actualizado)
- `apps/authorization-service/drizzle/0000_dear_red_shift.sql` (generado)
- `apps/authorization-service/drizzle/meta/*.json` (generado)
- 9 archivos de código de la fix
- 2 archivos de tests nuevos
- 2 archivos de tests actualizados
- `spec/2026-06-04-e2e-outbox-report.spec.md` (reporte inicial)

