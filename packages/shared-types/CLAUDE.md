# shared-types

Fuente única de verdad para DTOs y enums compartidos entre todos los servicios backend y la app móvil. Cambiar este package impacta múltiples consumidores.

## Flujo de trabajo obligatorio

Ver flujo completo en el CLAUDE.md raíz del repositorio. **No omitir ningún paso.**

## Exports principales

### Enums

| Enum | Valores |
|---|---|
| `RequestType` | `DISCOUNT`, `CANCEL`, `EMPLOYEE_BENEFIT`, `SUSPEND`, `PRICE_CHANGE` |
| `AuthorizationStatus` | `PENDING`, `APPROVED`, `REJECTED` |
| `RejectionReason` | `EMPLOYEE_NOT_ACTIVE`, `ACCOUNT_DISABLED`, `EMPLOYEE_NOT_FOUND`, `AD_LOOKUP_FAILED` |

### DTOs

| DTO | Campos clave |
|---|---|
| `AuthorizationRequestDto` | `store_id`, `pos_id`, `correlation_id`, `type`, `amount?`, `employee_id?`, `product_id?`, `original_price?`, `requested_price?` |
| `AuthorizationResponseDto` | `store_id`, `pos_id`, `correlation_id`, `status`, `resolved_by`, `resolved_at`, `rejection_reason?`, `type?` |
| `PhysicalPresenceDispatchDto` | `store_id`, `pos_id`, `correlation_id`, `product_id`, `original_price`, `requested_price` |

## Convenciones críticas

- **Todos los campos DTO son `snake_case`** (e.g. `store_id`, `correlation_id`, `created_at`). El wire format en REST, Redis y Kafka DEBE coincidir exactamente con esta nomenclatura. Las entidades internas de cada servicio pueden usar camelCase (estilo TypeScript), pero la capa que toca el wire (controllers, adapters de event emitter, publishers) **debe mapear explícitamente** al shape del DTO. Ver LEARNINGS `wire-format-debe-coincidir-con-dto-compartido` (2026-06-04).
- Los campos opcionales usan `?` (e.g. `amount?`). **No usar discriminated unions** hasta que exista un spec de refactor aprobado.
- Cualquier cambio de contrato debe ser coordinado con todos los consumidores: `authorization-service`, `sse-server`, `bff`, `apps/mobile`.
- Este package es TypeScript puro — sin dependencias de runtime.
