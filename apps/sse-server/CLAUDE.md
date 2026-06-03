# sse-server

Puente entre Redis pub/sub y clientes SSE. Suscribe canales Redis publicados por `authorization-service` y los re-emite como Server-Sent Events HTTP. No contiene lógica de negocio.

## Flujo de trabajo obligatorio

Ver flujo completo en el CLAUDE.md raíz del repositorio. **No omitir ningún paso.**

## Responsabilidades

- Suscribir canales Redis por `storeId`
- Mantener un `Subject<SseEvent>` RxJS por tienda activa
- Exponer endpoint SSE consumido por el BFF

## Arquitectura interna

```
sse/
  sse.service.ts       # Map<storeId, Subject<SseEvent>>; suscribe 2 canales por tienda
  sse.controller.ts    # GET /events/store/:storeId → @Sse() Observable

infrastructure/
  redis-notification-subscriber.adapter.ts   # INotificationSubscriber → ioredis subscriber
```

## Canales Redis que consume

| Canal | `type` en SseEvent |
|---|---|
| `store:{storeId}:requests` | `authorization_request` |
| `store:{storeId}:dispatches` | `physical_presence_dispatch` |

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/events/store/:storeId` | Stream SSE para una tienda |

## Variables de entorno

| Variable | Descripción |
|---|---|
| `REDIS_HOST` | Host de Redis |
| `REDIS_PORT` | Puerto de Redis |

## Convenciones

- El servicio no tiene dominio propio — cualquier lógica de enrutamiento o transformación pertenece a `authorization-service`.
- El binding `NOTIFICATION_SUBSCRIBER` → `RedisNotificationSubscriberAdapter` está en `sse.module.ts`.
- Puerto HTTP por defecto: **3002**.
