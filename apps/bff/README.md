# bff (Backend for Frontend)

Single HTTP interface for the mobile app. Proxies the SSE stream from `sse-server` and exposes REST endpoints to `authorization-service`. No business logic.

## Stack

| Component | Technology |
|---|---|
| Runtime | NestJS + TypeScript |
| Upstream HTTP | `@nestjs/axios` (`HttpService`) |
| SSE proxy | Port `IEventSourceConnector` + EventSource adapter |
| Auth | Keycloak (OIDC ROPC grant via `passport-jwt`) |
| Testing | Jest + Supertest + Stryker Mutator |

## Architecture

```
stream/
  stream.service.ts       # EventSource → RxJS Subject; auto-reconnect
  stream.controller.ts    # GET /stream/store/:storeId → @Sse()

authorization/
  authorization.service.ts    # HTTP to authorization-service
  authorization.controller.ts # GET pending + POST resolve

auth/
  auth.service.ts             # Delegates to IAuthenticationPort
  auth.controller.ts          # POST /auth/login
```

## Endpoints exposed to mobile app

| Method | Path | Upstream |
|---|---|---|
| GET | `/stream/store/:storeId` | `{SSE_SERVER_URL}/events/store/:storeId` |
| GET | `/authorization/store/:storeId/pending` | `{AUTH_SERVICE_URL}/authorization/store/:storeId/pending` |
| POST | `/authorization/:id/resolve` | `{AUTH_SERVICE_URL}/authorization/:id/resolve` |
| POST | `/auth/login` | `{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token` |

## Environment variables

| Variable | Description |
|---|---|
| `SSE_SERVER_URL` | sse-server base URL (e.g. `http://sse-server:3002`) |
| `AUTH_SERVICE_URL` | authorization-service base URL (e.g. `http://authorization-service:3001`) |
| `KEYCLOAK_URL` | Keycloak base URL |
| `KEYCLOAK_REALM` | Keycloak realm (e.g. `open-supervisor`) |
| `KEYCLOAK_CLIENT_ID` | OIDC client ID |
| `KEYCLOAK_CLIENT_SECRET` | OIDC client secret |
| `KEYCLOAK_TIMEOUT_MS` | HTTP timeout for ROPC grant (default: 5000) |

## Running

```bash
# Development (default port: 3000)
pnpm --filter bff dev

# Tests
pnpm --filter bff test

# Type check
pnpm --filter bff typecheck

# Mutation testing
pnpm --filter bff test:mutation
```

## Conventions

- No business validation here — delegate to `authorization-service`.
- Use `HttpService` from `@nestjs/axios` for upstream HTTP calls (not raw `fetch()`).
- Use `IEventSourceConnector` (port) + adapter for SSE proxy (not raw `EventSource`).
- CORS enabled for mobile clients.
