# shared-messaging

Define los ports (interfaces TypeScript) de mensajería. Permite que cualquier servicio backend dependa de abstracciones sin importar `kafkajs` ni `ioredis` directamente.

## Flujo de trabajo obligatorio

Ver flujo completo en el CLAUDE.md raíz del repositorio. **No omitir ningún paso.**

## Ports definidos

| Token DI | Interface | Implementación activa |
|---|---|---|
| `MESSAGE_PUBLISHER` | `IMessagePublisher` | `KafkaPublisherAdapter` (authorization-service) |
| `MESSAGE_CONSUMER` | `IMessageConsumer` | `KafkaConsumerAdapter` (authorization-service) |
| `NOTIFICATION_SUBSCRIBER` | `INotificationSubscriber` | `RedisNotificationSubscriberAdapter` (sse-server) |

### Contratos

```typescript
// IMessagePublisher
publish(topic: string, message: unknown): Promise<void>

// IMessageConsumer
subscribe(topics: string[], groupId: string, handler: (topic: string, message: unknown) => Promise<void>): Promise<void>
disconnect(): Promise<void>

// INotificationSubscriber
subscribe(channel: string, handler: (message: string) => void): Promise<void>
unsubscribe(channel: string): Promise<void>
```

## Convenciones

- Este package es TypeScript puro — sin dependencias de runtime.
- Para agregar un nuevo broker (RabbitMQ, Google Pub/Sub): crear un adapter en el servicio correspondiente bajo `infrastructure/messaging/<broker>/` e inyectarlo en el módulo. Este package no se toca.
