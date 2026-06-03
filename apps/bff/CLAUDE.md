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
- Usar `undici` (fetch nativo) para llamadas HTTP; `eventsource` para el proxy SSE.
- Puerto HTTP por defecto: **3000**.
