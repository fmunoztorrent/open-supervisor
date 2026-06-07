# bff (Backend for Frontend)

Única interfaz HTTP de la app móvil. Proxea el stream SSE desde `sse-server` y expone endpoints REST hacia `authorization-service`. No contiene lógica de negocio.

## Flujo de trabajo obligatorio

Ver flujo completo en el CLAUDE.md raíz del repositorio. **No omitir ningún paso.**

## Responsabilidades

- Proxy SSE: conectar a `sse-server` con `EventSource` y re-emitir al cliente móvil
- Proxy REST: `GET /authorization/store/:storeId/pending` y `POST /authorization/:id/resolve`
- CORS habilitado (clientes móviles)

## Arquitectura interna

```
stream/
  stream.service.ts       # EventSource → RxJS Subject; reconexión automática
  stream.controller.ts    # GET /stream/store/:storeId → @Sse()

authorization/
  authorization.service.ts    # fetch() HTTP a authorization-service
  authorization.controller.ts # GET pending + POST resolve
```

## Endpoints expuestos a la app móvil

| Método | Ruta | Upstream |
|---|---|---|
| GET | `/stream/store/:storeId` | `{SSE_SERVER_URL}/events/store/:storeId` |
| GET | `/authorization/store/:storeId/pending` | `{AUTH_SERVICE_URL}/authorization/store/:storeId/pending` |
| POST | `/authorization/:id/resolve` | `{AUTH_SERVICE_URL}/authorization/:id/resolve` |

## Variables de entorno

| Variable | Descripción |
|---|---|
| `SSE_SERVER_URL` | URL base del sse-server (ej. `http://sse-server:3002`) |
| `AUTH_SERVICE_URL` | URL base del authorization-service (ej. `http://authorization-service:3001`) |

## Convenciones

- No agregar validación de negocio aquí; delegar a `authorization-service`.
- Usar `HttpService` de `@nestjs/axios` para llamadas HTTP upstream (no `fetch()` crudo).
- Usar `IEventSourceConnector` (port) + `EventSourceAdapter` para el proxy SSE (no `new EventSource()` directo).
- Puerto HTTP por defecto: **3000**.

## Estado SOLID — Deuda técnica documentada

> ⚠️ El BFF tiene violaciones de DIP y OCP documentadas en `spec/2026-06-05-bff-hexagonal-ports.spec.md`. No agregar código que incremente esta deuda antes de que el spec sea implementado.

### El punto dulce: BFF como thin proxy

El BFF no tiene lógica de dominio — es un proxy puro. El balance SOLID + NestJS para este servicio:

| Situación | Solución elegida | Razón |
|---|---|---|
| HTTP a servicios upstream | `HttpService` de `@nestjs/axios` (no port custom) | Módulo oficial NestJS; testeable con `HttpClientTestingModule`; no reinventar |
| EventSource hacia `sse-server` | Port `IEventSourceConnector` + adapter | No hay built-in NestJS para SSE; el port justifica la abstracción |

### Violaciones actuales (pendientes de corrección)

| Archivo | Violación | Principio |
|---|---|---|
| `authorization/authorization.service.ts` | `fetch()` directo en lugar de `HttpService` | DIP |
| `stream/stream.service.ts` | `new EventSource()` directo sin abstracción | DIP, OCP |

### Arquitectura objetivo (post-spec `2026-06-05-bff-hexagonal-ports`)

```
domain/ports/
  event-source-connector.port.ts    # IEventSourceConnector: connect(url): Observable<SseEvent>

infrastructure/
  event-source/
    event-source.adapter.ts         # EventSourceAdapter implements IEventSourceConnector

authorization/
  authorization.module.ts           # imports: [HttpModule]  ← @nestjs/axios

stream/
  stream.module.ts                  # { provide: EVENT_SOURCE_CONNECTOR, useClass: EventSourceAdapter }
```
