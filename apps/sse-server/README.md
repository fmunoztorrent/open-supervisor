# sse-server

Bridge between Redis pub/sub and SSE clients. Subscribes to Redis channels published by `authorization-service` and re-emits them as Server-Sent Events over HTTP. No business logic.

## Stack

| Component | Technology |
|---|---|
| Runtime | NestJS + TypeScript |
| Pub/Sub | Redis (`ioredis` subscriber) |
| Client protocol | SSE (Server-Sent Events) |
| Testing | Jest + Stryker Mutator |

## Architecture

```
sse/
  sse.service.ts       # Map<storeId, Subject<SseEvent>>; subscribes 2 channels per store
  sse.controller.ts    # GET /events/store/:storeId → @Sse() Observable

infrastructure/
  redis-notification-subscriber.adapter.ts   # INotificationSubscriber → ioredis
```

**Thin adapter** — no domain layer. Any routing or transformation logic belongs to `authorization-service`.

## Redis channels consumed

| Channel | SSE `type` field |
|---|---|
| `store:{storeId}:requests` | `authorization_request` |
| `store:{storeId}:dispatches` | `physical_presence_dispatch` |

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/events/store/:storeId` | SSE stream for a store |

## Environment variables

| Variable | Description |
|---|---|
| `REDIS_HOST` | Redis host |
| `REDIS_PORT` | Redis port |

## Running

```bash
# Development (default port: 3002)
pnpm --filter sse-server dev

# Tests
pnpm --filter sse-server test

# Mutation testing
pnpm --filter sse-server test:mutation
```

## SOLID principles

This service is a **thin adapter** with no domain logic:

| Principle | Implementation |
|---|---|
| **D** | `SseService` depends on `INotificationSubscriber` (port from `@open-supervisor/shared-messaging`), not on `ioredis` directly |
| **S** | `SseService` manages subscription + SSE Observable. If it exceeds ~60 lines, evaluate splitting into `RedisStreamConnector` + `SseEmitter` |
