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
    authorization-request.entity.ts    # approve(), reject(), isPending(); factory fromDto()
    active-directory-user.entity.ts    # interface para resultado de AD lookup
  ports/
    authorization-repository.port.ts   # IAuthorizationRepository: save, findById, findPendingByStore
    active-directory.port.ts           # IActiveDirectoryPort: lookupByEmployeeId
    event-emitter.port.ts              # IEventEmitter: emit(channel, payload)
  use-cases/
    process-authorization-request.use-case.ts   # Router principal por RequestType
    verify-employee-benefit.use-case.ts         # AD lookup + pre-aprobación
    process-price-change.use-case.ts            # Clasificador de cambio de precio
    resolve-authorization.use-case.ts           # Decisión manual del supervisor
  services/
    price-change-classifier.ts         # Regla: ≤50% desviación Y precio ≥ 150 → WITHIN_LIMIT
  exceptions/
    active-directory.exceptions.ts
    price-change.exceptions.ts

infrastructure/
  persistence/
    in-memory-authorization.repository.ts   # Map en memoria; pendiente migrar a DB
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
| POST | `/authorization/:id/resolve` | Resuelve con `{ decision, supervisor_id }` |

## Variables de entorno

| Variable | Descripción |
|---|---|
| `KAFKA_BROKER` | Host:puerto del broker Kafka |
| `REDIS_HOST` | Host de Redis |
| `REDIS_PORT` | Puerto de Redis |
| `AD_BASE_URL` | URL base del servicio de Active Directory |

## Reglas de dominio clave

- `EMPLOYEE_BENEFIT`: Se pre-rechaza si el empleado no es associate, tiene cuenta deshabilitada, no se encuentra o falla el lookup AD. Si es válido, se guarda y emite en Redis para que el supervisor decida.
- `PRICE_CHANGE`: EQUAL → auto-aprueba; WITHIN_LIMIT → guarda + emite Redis; EXCEEDS_LIMIT → auto-rechaza + emite dispatch físico.
- Todos los demás tipos (DISCOUNT, CANCEL, SUSPEND) → guarda + emite Redis directamente.

## Convenciones

- Ningún use-case importa `kafkajs` ni `ioredis` directamente — solo ports.
- El binding port → adapter está exclusivamente en `authorization.module.ts`.
- El repositorio actual es in-memory (`Map`); usar `IAuthorizationRepository` para cualquier operación de persistencia.
- Los DTOs vienen de `@open-supervisor/shared-types`; los ports de mensajería de `@open-supervisor/shared-messaging`.
