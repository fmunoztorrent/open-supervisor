---
name: kafka-topic
description: Use when adding a new Kafka topic, modifying existing topic contracts, or troubleshooting Kafka message flow in open-supervisor. Covers topic naming, payload contracts, and service wiring. Do NOT use for general Kafka administration or cluster management.
---

# Kafka Topics (open-supervisor)

## Topics existentes

| Topic | Dirección | Descripción |
|---|---|---|
| `auth.requests` | tienda → cloud | Todas las tiendas publican solicitudes aquí |
| `auth.response.{store_id}` | cloud → tienda | Topic dedicado por tienda para respuestas |

## Reglas de contrato

1. **Payload siempre incluye**: `store_id`, `pos_id`, `correlation_id`, `type` (DISCOUNT / CANCEL / EMPLOYEE_BENEFIT / SUSPEND / PRICE_CHANGE).
2. **Campos opcionales**: `amount?`, `employee_id?`, `product_id?`, `original_price?`, `requested_price?` — NO discriminated unions (patrón vigente).
3. **DTOs en `packages/shared-types/`**: `AuthorizationRequestDto`, `AuthorizationResponseDto`.
4. **Routing**: el `internal-server` de cada tienda suscribe solo `auth.response.{store_id}` y enruta al POS por `correlation_id`.

## Flujo al agregar un nuevo tipo de solicitud

1. Agregar el nuevo valor al enum `RequestType` en `packages/shared-types/src/`
2. Si el payload requiere campos nuevos, agregarlos como opcionales en `AuthorizationRequestDto`
3. Crear use-case delegado (ej. `VerifyNewTypeUseCase`) en `domain/use-cases/`
4. Delegar desde `ProcessAuthorizationRequestUseCase` (dispatcher por tipo)
5. El `type` en `AuthorizationResponseDto` permite al `internal-server` discriminar

## Consideraciones

- No cambiar el nombre de campos existentes — rompe contrato Kafka con internal-server de tienda
- Nuevos temas requieren actualizar consumer groups en `docker-compose.yml` y Kubernetes
- Usar `@nestjs/microservices` + `kafkajs` para la integración
