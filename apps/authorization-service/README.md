# authorization-service

Core business logic service. Receives authorization requests from Kafka (`auth.requests`), processes them by type, and publishes responses back to the POS via Kafka (`auth.response.{store_id}`). Also emits notification events to Redis for real-time supervisor updates.

## Stack

| Component | Technology |
|---|---|
| Runtime | NestJS + TypeScript |
| Messaging | Kafka (`kafkajs`) |
| Notifications | Redis pub/sub (`ioredis`) |
| Database | PostgreSQL 16 + Drizzle ORM (schema `auth`) |
| Testing | Jest + Supertest + Stryker Mutator |

## Architecture

Hexagonal (Ports & Adapters): domain defines ports, infrastructure implements adapters. No use-case imports `kafkajs`, `ioredis`, or `drizzle-orm` directly.

```
domain/
  entities/        # authorization-request.entity.ts, active-directory-user.entity.ts
  ports/           # IAuthorizationRepository, IOutboxRepository, IUnitOfWork,
                   # IActiveDirectoryPort, IEventEmitter
  use-cases/       # process-authorization-request, verify-employee-benefit,
                   # process-price-change, resolve-authorization
  services/        # price-change-classifier

infrastructure/
  persistence/drizzle/    # Drizzle repositories + unit of work
  outbox/                 # OutboxPublisherService (async Kafka delivery)
  active-directory/       # HTTP lookup adapter
  events/                 # RedisPublisherAdapter
  messaging/kafka/        # KafkaConsumerAdapter, KafkaPublisherAdapter
```

## Use cases

| Use case | Responsibility |
|---|---|
| `ProcessAuthorizationRequestUseCase` | Router by `RequestType` |
| `VerifyEmployeeBenefitUseCase` | Active Directory lookup + pre-approval |
| `ProcessPriceChangeUseCase` | Classify price change (WITHIN_LIMIT / EXCEEDS_LIMIT / EQUAL) |
| `ResolveAuthorizationUseCase` | Manual supervisor decision via atomic transaction + outbox |

## Domain rules

- **EMPLOYEE_BENEFIT:** pre-rejected if employee is not an associate, account disabled, not found, or AD lookup fails. If valid → saved + emitted to Redis for supervisor decision.
- **PRICE_CHANGE:** `EQUAL` → auto-approve; `WITHIN_LIMIT` → save + emit Redis; `EXCEEDS_LIMIT` → auto-reject + dispatch physical presence.
- **Other types** (DISCOUNT, CANCEL, SUSPEND) → save + emit Redis directly.

## Redis channels published

| Channel | SSE event |
|---|---|
| `store:{storeId}:requests` | `authorization_request` |
| `store:{storeId}:dispatches` | `physical_presence_dispatch` |

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/authorization/store/:storeId/pending` | List pending requests |
| POST | `/authorization/:id/resolve` | Resolve with `{ decision, supervisor_id }` (id = business correlationId) |
| GET | `/outbox/stats` | Outbox metrics: `pending_count`, `published_count_last_hour`, `max_attempts`, `oldest_pending_age_seconds` |

## Environment variables

| Variable | Description |
|---|---|
| `KAFKA_BROKER` | Kafka broker host:port |
| `REDIS_HOST` | Redis host |
| `REDIS_PORT` | Redis port |
| `AD_BASE_URL` | Active Directory service base URL |
| `DATABASE_URL` | PostgreSQL URL (`postgresql://user:pass@host:5432/db`) |
| `DATABASE_URL_TEST` | PostgreSQL URL for tests (separate DB) |
| `OUTBOX_TICK_INTERVAL_MS` | Outbox publisher interval (default: 1000ms) |
| `OUTBOX_BATCH_SIZE` | Max entries per tick (default: 50) |

## Running

```bash
# Development
pnpm --filter authorization-service dev

# Tests
pnpm --filter authorization-service test
pnpm --filter authorization-service test:e2e

# Database migrations (after schema changes)
pnpm --filter authorization-service db:generate
pnpm --filter authorization-service db:migrate

# Mutation testing
pnpm --filter authorization-service test:mutation
```

## SOLID principles

| Principle | Implementation |
|---|---|
| **S** | Each use case has exactly one reason to change |
| **O** | New broker/repository = new folder in `infrastructure/` + 1 line in module |
| **L** | Adapters substitute ports without observable side effects |
| **I** | Ports intentionally minimal: `IEventEmitter` = 1 method, `IUnitOfWork` = 1 method |
| **D** | Domain depends on ports, never on SDKs. Binding in `authorization.module.ts` only |
