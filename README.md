# open-supervisor

Mobile app (Android) for supermarket supervisors. Receives authorization requests from POS terminals in real time, displays them, and sends the supervisor's decision back to the POS.

## Architecture

```
POS → internal-server (store) ──kafka:auth.requests──► authorization-service
  authorization-service → Redis PUBLISH → sse-server → SSE → bff → mobile app
  supervisor decides → bff REST → authorization-service
  authorization-service ──kafka:auth.response.{store_id}──► internal-server → POS
```

## Monorepo structure

```
apps/
  authorization-service/   # NestJS — business logic, Kafka consumer, Redis publisher
  sse-server/              # NestJS — Redis pub/sub → SSE bridge
  bff/                     # NestJS — Backend for Frontend (SSE proxy + REST API)
  mobile/                  # React Native (Android) — supervisor app

packages/
  shared-types/            # DTOs, interfaces, enums shared across services
  shared-messaging/        # Messaging ports (IMessagePublisher, IMessageConsumer, INotificationSubscriber)
```

## Stack

| Layer | Technology |
|---|---|
| Mobile app | React Native (Android) + TypeScript |
| UI system | `@gluestack-ui/themed` v1 |
| Backend services | NestJS + TypeScript |
| Messaging | Kafka (`kafkajs`) |
| Realtime notifications | Redis pub/sub → SSE → `react-native-sse` |
| Database | PostgreSQL 16 + Drizzle ORM |
| Monorepo | pnpm workspaces |
| Orchestration | Kubernetes |

## Principles

- **Hexagonal Architecture (Ports & Adapters):** domain defines ports (TypeScript interfaces); infrastructure implements adapters. No use-case imports SDKs directly.
- **SOLID:** single responsibility per use-case, dependency inversion enforced by ports.
- **TDD:** QA writes failing tests before implementation begins.
- **English:** all code, comments, commit messages, specs, and READMEs in English.

## Quick start

### Prerequisites

- pnpm ≥ 9
- Node.js ≥ 20
- Podman or Docker
- Android Studio (for mobile)

### First-time setup

```bash
# 1. Install system dependencies and configure Android environment
./setup-android.sh

# 2. Reload shell to activate ANDROID_HOME and platform-tools
source ~/.zshrc

# 3. Build shared packages (required before first nest start)
pnpm install
cd packages/shared-types && npx tsc && cd ../shared-messaging && npx tsc && cd ../..
```

### Start the full stack

```bash
# Infrastructure + backend services
make dev

# In another terminal: emulator + Metro + app
make emulator

# Or everything at once
make all

# Stop everything
make down

# Check status
make status
```

### Running services individually

```bash
# Infrastructure
make infra

# Backend services
pnpm --filter authorization-service dev
pnpm --filter sse-server dev
pnpm --filter bff dev

# Mobile (two terminals)
cd apps/mobile && pnpm start          # Terminal 1: Metro bundler
cd apps/mobile && pnpm android        # Terminal 2: build & launch
```

### Inject test requests

```bash
pnpm inject --type DISCOUNT --store-id store-1 --pos-id pos-1
pnpm inject --type PRICE_CHANGE --product-id P42 --original-price 100 --requested-price 80
pnpm inject --type DISCOUNT --verify  # verify SSE delivery
```

## Commands

```bash
pnpm test                # all backend tests
pnpm lint                # all linting
pnpm typecheck           # all type checks
pnpm test:mutation       # Stryker mutation testing (all services)
pnpm inject --type DISCOUNT  # inject a test authorization request
```

## Request types

| Type | Description |
|---|---|
| `DISCOUNT` | Special discount authorization |
| `CANCEL` | Purchase cancellation |
| `EMPLOYEE_BENEFIT` | Employee discount (Active Directory lookup) |
| `SUSPEND` | Purchase suspension |
| `PRICE_CHANGE` | Manual price change (auto-classified) |

## Kafka topics

| Topic | Direction | Description |
|---|---|---|
| `auth.requests` | store → cloud | All stores publish here |
| `auth.response.{store_id}` | cloud → store | Dedicated topic per store |

## Services

| Service | Port | Description |
|---|---|---|
| authorization-service | 3001 | Business logic, Kafka consumer, REST endpoints |
| sse-server | 3002 | Redis pub/sub → SSE bridge |
| bff | 3000 | SSE proxy + REST API for mobile app |
