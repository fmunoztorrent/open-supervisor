# shared-messaging

Defines messaging ports (TypeScript interfaces) so backend services depend on abstractions without importing `kafkajs` or `ioredis` directly.

## Stack

| Component | Technology |
|---|---|
| Language | TypeScript (pure, no runtime dependencies) |
| Consumers | `authorization-service`, `sse-server` |

## Ports

| DI Token | Interface | Active implementation |
|---|---|---|
| `MESSAGE_PUBLISHER` | `IMessagePublisher` | `KafkaPublisherAdapter` (authorization-service) |
| `MESSAGE_CONSUMER` | `IMessageConsumer` | `KafkaConsumerAdapter` (authorization-service) |
| `NOTIFICATION_SUBSCRIBER` | `INotificationSubscriber` | `RedisNotificationSubscriberAdapter` (sse-server) |

## Contracts

```typescript
// IMessagePublisher
publish(topic: string, message: unknown): Promise<void>

// IMessageConsumer
subscribe(
  topics: string[],
  groupId: string,
  handler: (topic: string, message: unknown) => Promise<void>
): Promise<void>
disconnect(): Promise<void>

// INotificationSubscriber
subscribe(channel: string, handler: (message: string) => void): Promise<void>
unsubscribe(channel: string): Promise<void>
```

## Adding a new broker

1. Create adapter in the service under `infrastructure/messaging/<broker>/`
2. Implement the corresponding port
3. Change 1 line in the service module: `{ provide: TOKEN, useClass: NewAdapter }`

This package stays untouched — domain and adapters are decoupled by design.

## Building

```bash
# Required before first nest start
cd packages/shared-messaging && npx tsc

# Type check
pnpm --filter shared-messaging typecheck
```
