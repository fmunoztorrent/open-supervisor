# shared-types

Single source of truth for DTOs and enums shared across all backend services and the mobile app. Changing this package impacts multiple consumers.

## Stack

| Component | Technology |
|---|---|
| Language | TypeScript (pure, no runtime dependencies) |
| Consumers | `authorization-service`, `sse-server`, `bff`, `apps/mobile` |

## Exports

### Enums

| Enum | Values |
|---|---|
| `RequestType` | `DISCOUNT`, `CANCEL`, `EMPLOYEE_BENEFIT`, `SUSPEND`, `PRICE_CHANGE` |
| `AuthorizationStatus` | `PENDING`, `APPROVED`, `REJECTED` |
| `RejectionReason` | `EMPLOYEE_NOT_ACTIVE`, `ACCOUNT_DISABLED`, `EMPLOYEE_NOT_FOUND`, `AD_LOOKUP_FAILED` |

### DTOs

| DTO | Key fields |
|---|---|
| `AuthorizationRequestDto` | `store_id`, `pos_id`, `correlation_id`, `type`, `amount?`, `employee_id?`, `product_id?`, `original_price?`, `requested_price?` |
| `AuthorizationResponseDto` | `store_id`, `pos_id`, `correlation_id`, `status`, `resolved_by`, `resolved_at`, `rejection_reason?`, `type?` |
| `PhysicalPresenceDispatchDto` | `store_id`, `pos_id`, `correlation_id`, `product_id`, `original_price`, `requested_price` |

## Conventions

- **All DTO fields are `snake_case`** (e.g. `store_id`, `correlation_id`, `created_at`). The wire format in REST, Redis, and Kafka must match exactly.
- Optional fields use `?` (e.g. `amount?`). No discriminated unions.
- Any contract change must be coordinated with all consumers.
- Pure TypeScript — no runtime dependencies.

## Building

```bash
# Required before first nest start
cd packages/shared-types && npx tsc

# Type check
pnpm --filter shared-types typecheck
```
