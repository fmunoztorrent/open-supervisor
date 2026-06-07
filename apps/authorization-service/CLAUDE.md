# authorization-service

Servicio central de lógica de negocio. Recibe solicitudes de autorización desde Kafka (`auth.requests`), las procesa según su tipo, y publica la respuesta al POS en Kafka (`auth.response.{store_id}`). También emite eventos de notificación en Redis para que el supervisor reciba actualizaciones en tiempo real.

## Flujo de trabajo obligatorio

Ver flujo completo en el CLAUDE.md raíz del repositorio. **No omitir ningún paso.**

## Responsabilidades

- Validar y enrutar solicitudes según `RequestType`
- Lógica de pre-aprobación automática (EMPLOYEE_BENEFIT, PRICE_CHANGE)
- Exponer endpoint REST para que el BFF resuelva solicitudes manualmente
- Persistir solicitudes en `IAuthorizationRepository`

## Arquitectura interna

```
domain/
  entities/
    authorization-request.entity.ts    # approve(), reject(), isPending(); factories fromDto() y fromRow()
    active-directory-user.entity.ts    # interface para resultado de AD lookup
  ports/
    authorization-repository.port.ts   # IAuthorizationRepository: save, findById, findByCorrelationId, findPendingByStore
    outbox-repository.port.ts          # IOutboxRepository: save, findPending, markPublished, incrementAttempts, getStats
    unit-of-work.port.ts               # IUnitOfWork: transaction<T>(work) — coordina TX entre auth + outbox
    active-directory.port.ts           # IActiveDirectoryPort: lookupByEmployeeId
    event-emitter.port.ts              # IEventEmitter: emit(channel, payload)
  use-cases/
    process-authorization-request.use-case.ts   # Router principal por RequestType
    verify-employee-benefit.use-case.ts         # AD lookup + pre-aprobación
    process-price-change.use-case.ts            # Clasificador de cambio de precio
    resolve-authorization.use-case.ts           # Decisión manual del supervisor (vía IUnitOfWork + outbox)
  services/
    price-change-classifier.ts         # Regla: ≤50% desviación Y precio ≥ 150 → WITHIN_LIMIT
  exceptions/
    active-directory.exceptions.ts
    price-change.exceptions.ts

infrastructure/
  persistence/
    drizzle/
      schema.ts                                # Schema 'auth' con tablas authorization_requests y outbox
      drizzle.provider.ts                      # Provider DRIZZLE (cliente pg + DrizzleDb), @Global
      drizzle-authorization.repository.ts     # Adapter IAuthorizationRepository (UPSERT)
      drizzle-outbox.repository.ts             # Adapter IOutboxRepository (findPending MVP single-instance)
      drizzle-unit-of-work.ts                  # DrizzleUnitOfWork con db.transaction
  outbox/
    outbox-publisher.service.ts                # Emisor asíncrono (setInterval + tick + onModuleInit/Destroy)
    outbox-stats.controller.ts                 # GET /outbox/stats con métricas en snake_case
  active-directory/
    http-active-directory.adapter.ts        # GET {AD_BASE_URL}/users/{employeeId}
  events/
    redis-publisher.adapter.ts              # IEventEmitter → Redis PUBLISH
  messaging/kafka/
    kafka-consumer.adapter.ts              # Suscribe auth.requests
    kafka-publisher.adapter.ts             # Publica auth.response.{store_id}
```

## Canales Redis que publica

| Canal | Evento SSE resultante |
|---|---|
| `store:{storeId}:requests` | `authorization_request` |
| `store:{storeId}:dispatches` | `physical_presence_dispatch` |

## Endpoints REST

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/authorization/store/:storeId/pending` | Lista solicitudes pendientes |
| POST | `/authorization/:id/resolve` | Resuelve con `{ decision, supervisor_id }` (id = correlationId de negocio) |
| GET | `/outbox/stats` | Métricas del outbox: `{ pending_count, published_count_last_hour, max_attempts, oldest_pending_age_seconds }` |

## Variables de entorno

| Variable | Descripción |
|---|---|
| `KAFKA_BROKER` | Host:puerto del broker Kafka |
| `REDIS_HOST` | Host de Redis |
| `REDIS_PORT` | Puerto de Redis |
| `AD_BASE_URL` | URL base del servicio de Active Directory |
| `DATABASE_URL` | URL de Postgres (formato `postgresql://user:pass@host:5432/db`) |
| `DATABASE_URL_TEST` | URL de Postgres para tests (DB separada) |
| `OUTBOX_TICK_INTERVAL_MS` | Intervalo del emisor del outbox (default: 1000ms) |
| `OUTBOX_BATCH_SIZE` | Cantidad máxima de entries a procesar por tick (default: 50) |

## Reglas de dominio clave

- `EMPLOYEE_BENEFIT`: Se pre-rechaza si el empleado no es associate, tiene cuenta deshabilitada, no se encuentra o falla el lookup AD. Si es válido, se guarda y emite en Redis para que el supervisor decida.
- `PRICE_CHANGE`: EQUAL → auto-aprueba; WITHIN_LIMIT → guarda + emite Redis; EXCEEDS_LIMIT → auto-rechaza + emite dispatch físico.
- Todos los demás tipos (DISCOUNT, CANCEL, SUSPEND) → guarda + emite Redis directamente.

## Convenciones

- Ningún use-case importa `kafkajs`, `ioredis` ni `drizzle-orm` directamente — solo ports.
- El binding port → adapter está exclusivamente en `authorization.module.ts`.
- La persistencia es **PostgreSQL 16 + Drizzle ORM** (schema `auth`). Toda TX atómica entre repositorios pasa por `IUnitOfWork.transaction([authSave, outboxSave])`. Los adapters Drizzle-bound al `tx` se instancian dentro del callback de la TX.
- El `ResolveAuthorizationUseCase` ya NO llama `IMessagePublisher.publish()` directamente. En su lugar, persiste la decisión y encola la respuesta al outbox en la misma TX. La publicación a Kafka la hace el `OutboxPublisherService` de forma asíncrona (fire-and-forget).
- Los DTOs vienen de `@open-supervisor/shared-types`; los ports de mensajería de `@open-supervisor/shared-messaging`.
- Para correr migraciones: `pnpm --filter authorization-service db:migrate` (después de `pnpm db:generate` cuando se modifica el schema).
- Para tests con DB real: `pnpm --filter authorization-service db:test:setup && DATABASE_URL_TEST=... pnpm test`. Por defecto los tests usan mocks puros.

## Principios SOLID en este servicio

### El punto dulce: SOLID + NestJS

Este servicio es el que más se acerca al hexagonal ideal. Las concesiones al framework son intencionadas:

| Concesión | Razón |
|---|---|
| `OnModuleDestroy` en adapters Kafka/Redis | NestJS lo diseñó así. TypeScript aísla el lifecycle del contrato del port — un cliente tipado como `IMessagePublisher` no puede llamar `onModuleDestroy()`. |
| `@Inject()` y tokens de DI en use-cases | El decorador es metadata de DI, no lógica de dominio. El use-case no importa NestJS en su lógica. |
| `@Interval()` en `OutboxPublisherService` | El framework maneja el scheduling; el servicio se enfoca en la lógica del tick. |

---

### S — Single Responsibility

Cada use-case tiene una razón para cambiar:

| Use-case | Responsabilidad única |
|---|---|
| `ProcessAuthorizationRequestUseCase` | Router por `RequestType` |
| `VerifyEmployeeBenefitUseCase` | Validar empleado en AD + delegar rechazo a `IAuthorizationResponsePublisher` |
| `ProcessPriceChangeUseCase` | Clasificar cambio de precio |
| `ResolveAuthorizationUseCase` | Persistir decisión + encolar en outbox (TX atómica) |

**Anti-patrón — NO hacer esto:**
```typescript
// ❌ Use-case con múltiples paths de publicación directa al mismo broker
await this.publisher.publish(`auth.response.${dto.store_id}`, rejectPayload); // camino A
await this.publisher.publish(`auth.response.${dto.store_id}`, rejectPayload); // camino B
await this.publisher.publish(`auth.response.${dto.store_id}`, rejectPayload); // camino C
```

**Patrón correcto — delegar al port especializado:**
```typescript
// ✅ Una sola línea; el port encapsula el camino correcto
await this.responsePublisher.reject(dto, RejectionReason.EMPLOYEE_NOT_FOUND);
```

---

### O — Open/Closed

Agregar un nuevo proveedor (base de datos, broker, directorio externo):
1. Nueva carpeta en `infrastructure/`
2. Implementar el port correspondiente
3. Cambiar 1 línea en `authorization.module.ts`: `{ provide: TOKEN, useClass: NuevaImpl }`
4. El dominio y los use-cases **no se modifican**.

---

### I — Interface Segregation

Ports intencionalmente mínimos:
- `IEventEmitter` → 1 método: `emit()`
- `IUnitOfWork` → 1 método: `transaction<T>()`
- `IActiveDirectoryPort` → 1 método: `lookupByEmployeeId()`

Si un use-case solo necesita leer datos, definir un port de lectura en lugar de inyectar el repositorio completo.

---

### D — Dependency Inversion

Verificación rápida — debe retornar vacío antes de mergear:
```bash
grep -r "import.*kafkajs\|import.*ioredis\|import.*drizzle-orm" src/domain --include="*.ts"
```

El binding port → adapter vive **exclusivamente** en `authorization.module.ts`. Ningún otro archivo del servicio instancia adapters directamente.
