---
name: nestjs-hexagonal
description: Use when creating a new use-case, port, adapter, or NestJS module in open-supervisor. Covers hexagonal architecture conventions: domain ports, infrastructure adapters, binding in module. Do NOT use for general NestJS questions unrelated to this project's patterns.
---

# NestJS Hexagonal Architecture (open-supervisor)

## Estructura por feature

```
domain/
  entities/        # Entidades puras de dominio
  ports/           # Interfaces: IMessagePublisher, IAuthorizationRepository, etc.
  use-cases/       # Lógica de negocio — depende solo de ports

application/       # Orquesta use-cases

infrastructure/
  messaging/
    kafka/         # KafkaConsumer, KafkaPublisher
  persistence/     # Implementación de IAuthorizationRepository
  events/          # RedisPublisher

<module>.module.ts  # Binding port → adapter
```

## Reglas no negociables

1. **Ningún use-case importa `kafkajs`, `ioredis`, ni SDKs de infra.** Solo importa interfaces de `packages/shared-messaging/` o `packages/shared-types/`.
2. **El binding port → adapter va exclusivamente en `app.module.ts`** o en el módulo de feature, nunca en el use-case ni en el controller.
3. **DTOs compartidos** viven en `packages/shared-types/`. DTOs de APIs externas van locales al adapter.
4. **Variables de entorno**: siempre via `ConfigModule` (`@nestjs/config`), nunca `process.env` directo.

## Reglas activas

### Accionables

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A4** | Para dependencias nativas nuevas en mobile, verificar compatibilidad con kotlinVersion del proyecto | **ALTA** |
| **A5** | Validar rutas de endpoints contra `@Controller()` prefixes reales | **ALTA** |
| **A11** | Tras modificar .ts en NestJS: `nest build` + restart + verify con lsof | **ALTA** |

## Orden de implementación

1. DTOs y tipos compartidos (`packages/shared-types/`)
2. Ports si faltan (`packages/shared-messaging/`)
3. Entidades de dominio (`domain/entities/`)
4. Use-cases (`domain/use-cases/`)
5. Adapters (`infrastructure/`)
6. Módulo NestJS (binding port → adapter)
7. Controller / Kafka consumer handler

## Patrón de use-case

```typescript
import { Injectable } from '@nestjs/common';
import { IMessagePublisher } from '@open-supervisor/shared-messaging';

@Injectable()
export class ProcessXUseCase {
  constructor(
    private readonly publisher: IMessagePublisher,
    // solo ports, nunca infra concreta
  ) {}

  async execute(dto: XDto): Promise<void> {
    // lógica de negocio pura
  }
}
```

## Patrón de binding en módulo

```typescript
@Module({
  providers: [
    { provide: 'IMessagePublisher', useClass: KafkaPublisher },
    ProcessXUseCase,
  ],
})
export class FeatureModule {}
```
