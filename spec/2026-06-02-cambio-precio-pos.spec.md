# Spec: Solicitud de cambio de precio en POS

**Fecha:** 2026-06-02  
**Stack inferido:** Node.js / TypeScript — NestJS (backend)  
**Status del spec:** completed  

> **Scope de esta feature:** backend únicamente (`shared-types`, `authorization-service`, `sse-server`, `bff`).  
> La app móvil (`apps/mobile`) no existe aún; los componentes UI (`PriceChangeCard`, `PhysicalPresenceAlert`) y los tests RNTL/Detox se difieren a un spec separado de bootstrap mobile.

---

## Contexto

Actualmente el sistema maneja cuatro tipos de autorización: `DISCOUNT`, `CANCEL`, `EMPLOYEE_BENEFIT` y `SUSPEND`. Se agrega `PRICE_CHANGE`: el cajero solicita vender un producto a un precio diferente al marcado. El motivo es operacional y queda fuera del scope del sistema.

El flujo se bifurca según la magnitud del cambio:

- **`requested_price == original_price`** → auto-aprobación silenciosa. El POS recibe `APPROVED` inmediatamente sin notificar al supervisor.
- **`requested_price < 150`** → `MinimumPriceViolationError`. No se persiste ni se emite respuesta.
- **Diferencia `|original_price − requested_price| / original_price ≤ 0.50`** → flujo normal: persiste `PENDING`, supervisor decide (vía BFF REST cuando mobile exista).
- **Diferencia > 50 %** → `REJECTED` inmediato al POS + evento SSE `physical_presence_dispatch` al supervisor (el supervisor va personalmente a la caja).

**Orden de validación en el dominio (load-bearing):**
1. Igualdad de precios → auto-APPROVED (sale antes de validar mínimo)
2. Precio mínimo (`< 150`) → `MinimumPriceViolationError`
3. Regla del 50 % → WITHIN_LIMIT o EXCEEDS_LIMIT
4. Guardia `original_price == 0` → `InvalidPriceError` (división por cero; no debe ocurrir, el POS lo garantiza, pero el dominio se defiende)

---

## REASONS Canvas

```xml
<reasons>
  <role>Supervisor de supermercado</role>
  <environment>App móvil Android en tiempo real, red interna de tienda + cloud</environment>
  <aim>Autorizar cambios de precio menores; ser notificado para ir en persona en cambios mayores</aim>
  <situation>El cajero encuentra precio erróneo o pacta excepción con el cliente; el flujo debe resolverse en segundos</situation>
  <outcome>
    POS recibe APPROVED/REJECTED vía Kafka.
    Cambios ≤ 50%: supervisor decide remotamente (flujo existente).
    Cambios > 50%: supervisor recibe evento physical_presence_dispatch y va a la caja.
  </outcome>
  <novelty>
    Nuevo valor PRICE_CHANGE en RequestType enum.
    Campos opcionales en DTO/entidad plana existente (patrón vigente, sin discriminated union).
    Domain service PriceChangeClassifier con MIN_PRICE=150 y regla del 50%.
    Segundo canal Redis para physical_presence_dispatch (tipo SSE separado).
  </novelty>
  <stakeholders>Cajero (POS), Supervisor (mobile app — futuro), Jefe de tienda (auditoría)</stakeholders>
</reasons>
```

---

## Diseño de Contratos

### Patrón adoptado: campos opcionales (consistente con el código existente)

El DTO y la entidad usan campos opcionales, igual que `amount?` y `employee_id?` ya presentes.  
No se migra a discriminated union en esta feature (refactor separado si se decide en el futuro).

### Cambios en `shared-types`

```typescript
// packages/shared-types/src/enums/request-type.enum.ts
// Añadir:
PRICE_CHANGE = 'PRICE_CHANGE'

// packages/shared-types/src/dtos/authorization-request.dto.ts
// Añadir tres campos opcionales a la interfaz existente:
interface AuthorizationRequestDto {
  // ... campos existentes (store_id, pos_id, correlation_id, type, created_at, amount?, employee_id?)
  product_id?: string;       // nuevo — obligatorio cuando type === PRICE_CHANGE
  original_price?: number;   // nuevo — obligatorio cuando type === PRICE_CHANGE
  requested_price?: number;  // nuevo — obligatorio cuando type === PRICE_CHANGE
}

// packages/shared-types/src/dtos/authorization-response.dto.ts
// Añadir:
type?: RequestType;  // nuevo — permite al internal-server discriminar por tipo en la respuesta

// packages/shared-types/src/dtos/physical-presence-dispatch.dto.ts  (archivo nuevo)
interface PhysicalPresenceDispatchDto {
  store_id: string;
  pos_id: string;
  correlation_id: string;
  product_id: string;
  original_price: number;
  requested_price: number;
}
```

### Cambios en la entidad de dominio

```typescript
// apps/authorization-service/src/domain/entities/authorization-request.entity.ts
// Añadir campos opcionales + mapeo en fromDto():
productId?: string;
originalPrice?: number;
requestedPrice?: number;

// fromDto() mapea los tres campos cuando type === PRICE_CHANGE
```

### Domain service nuevo: `PriceChangeClassifier`

```typescript
// apps/authorization-service/src/domain/services/price-change-classifier.ts
// Constante en el dominio:
const MIN_PRICE = 150;

// Retorna una de estas clasificaciones (string literal union o enum interno):
type PriceChangeClassification = 'EQUAL' | 'WITHIN_LIMIT' | 'EXCEEDS_LIMIT';

// Lanza MinimumPriceViolationError si requested_price < MIN_PRICE
// Lanza InvalidPriceError si original_price === 0
// Nunca lanza si requested_price === original_price (EQUAL sale primero)
```

### Reutilización de use-cases existentes

- **`ResolveAuthorizationUseCase`** cubre `APPROVED`/`REJECTED` para PRICE_CHANGE ≤50% — **no se crea** `ResolvePriceChangeUseCase`.
- El controller debe mapear el error de estado ya resuelto (`assertPending`) a HTTP 409 (hoy devuelve 500 — se corrige en este ciclo).
- **`ProcessAuthorizationRequestUseCase`** (orquestador) agrega un branch `PRICE_CHANGE` que delega a `ProcessPriceChangeUseCase`, igual que el branch `EMPLOYEE_BENEFIT` → `VerifyEmployeeBenefitUseCase`.

### Segundo canal Redis para presencia física

El doble evento SSE se implementa con un **segundo canal Redis** (no con un campo discriminador en el payload):

```
Canal existente:  store:{store_id}:requests    → SSE type: 'authorization_request'
Canal nuevo:      store:{store_id}:dispatches  → SSE type: 'physical_presence_dispatch'
```

El `IEventEmitter` port ya soporta publicar en cualquier canal; **no cambia la firma del port**.

---

## Historias de Usuario

### US-01: Clasificación y enrutamiento de solicitudes PRICE_CHANGE `[Must]`

> Como **sistema**, quiero clasificar automáticamente las solicitudes `PRICE_CHANGE` según la magnitud del cambio, para enrutar al flujo correcto sin intervención manual.

**Criterios de aceptación:**
- [x] `requested_price == original_price` → responde `APPROVED` al POS antes de emitir cualquier evento; no persiste `PENDING`.
- [x] `requested_price < 150` → `MinimumPriceViolationError`; no se persiste ni se emite respuesta al POS ni al supervisor.
- [x] `original_price == 0` → `InvalidPriceError`; no se procesa.
- [x] Diferencia ≤ 50 % → persiste `PriceChangeRequest` con estado `PENDING`; publica en canal `store:{id}:requests`.
- [x] Diferencia > 50 % → responde `REJECTED` al POS; publica en canal `store:{id}:dispatches` un `PhysicalPresenceDispatchDto`.
- [x] `PriceChangeClassifier` encapsula `MIN_PRICE` y regla del 50 %; ningún adapter conoce estas constantes.

**Notas:** Orden de validación load-bearing: igualdad → mínimo → porcentaje. El orquestador (`ProcessAuthorizationRequestUseCase`) delega a `ProcessPriceChangeUseCase` para el branch `PRICE_CHANGE`.

---

### US-02: Emisión SSE de evento de presencia física `[Must]`

> Como **sistema**, quiero emitir un evento SSE de tipo `physical_presence_dispatch` cuando el cambio supera el 50 %, para que el supervisor sepa a qué caja debe ir.

**Criterios de aceptación:**
- [x] El `sse-server` suscribe el canal `store:{store_id}:dispatches` en Redis.
- [x] Los mensajes de ese canal se emiten como `MessageEvent` con `type: 'physical_presence_dispatch'` (distinto de `'authorization_request'`).
- [x] El BFF escucha el tipo `physical_presence_dispatch` y lo reenvía al cliente móvil (cuando exista).
- [x] Un evento `authorization_request` nunca llega por el canal de dispatches ni viceversa.

**Notas:** El `IEventEmitter` port no cambia. El `sse-server` agrega suscripción al canal nuevo; el `SseService` mapea el tipo correctamente.

---

### US-03: Decisión del supervisor para cambios ≤ 50 % `[Must]`

> Como **supervisor**, quiero que el sistema acepte mi decisión de aprobar o rechazar un cambio de precio (cuando sea ≤ 50 %) y la publique al POS.

**Criterios de aceptación:**
- [x] El BFF REST acepta `APPROVED` o `REJECTED` para solicitudes `PRICE_CHANGE` con estado `PENDING`.
- [x] `ResolveAuthorizationUseCase` resuelve la solicitud y publica en `auth.response.{store_id}` incluyendo `type: PRICE_CHANGE` en el payload.
- [x] Una solicitud ya resuelta devuelve HTTP 409 (el controller mapea el error de `assertPending`).
- [x] El estado de la solicitud queda persistido con `resolved_at`.

**Notas:** No se crea un use-case nuevo; se reutiliza `ResolveAuthorizationUseCase`. La corrección del 500→409 aplica para todos los tipos (mejora transversal).

---

### US-04: Trazabilidad de cambios de precio `[Should]`

> Como **jefe de tienda**, quiero que cada solicitud de cambio de precio quede registrada con su resultado, para poder auditarla posteriormente.

**Criterios de aceptación:**
- [x] La entidad `AuthorizationRequest` persiste `productId`, `originalPrice`, `requestedPrice` cuando `type === PRICE_CHANGE`.
- [x] El estado final y `resolved_at` quedan persistidos.
- [x] Los campos de precio son `undefined` para los demás tipos; los tests existentes de `DISCOUNT/CANCEL/SUSPEND/EMPLOYEE_BENEFIT` siguen en verde.

**Notas:** —

---

## Escenarios BDD

```gherkin
Feature: Clasificación de solicitudes PRICE_CHANGE
  Como sistema
  Quiero clasificar automáticamente cada solicitud según la magnitud del cambio
  Para enrutar al flujo correcto

  Background:
    Given el authorization-service está activo y suscrito a auth.requests

  Scenario: Precios iguales — auto-aprobación silenciosa
    Given un mensaje PRICE_CHANGE con original_price 1000 y requested_price 1000
    When el authorization-service procesa el mensaje
    Then publica APPROVED en auth.response.{store_id} con type PRICE_CHANGE
    And no se persiste ninguna solicitud PENDING
    And no se emite evento SSE al supervisor

  Scenario: Precio por debajo del mínimo
    Given un mensaje PRICE_CHANGE con original_price 1000 y requested_price 100
    When el authorization-service procesa el mensaje
    Then lanza MinimumPriceViolationError
    And no se emite ningún mensaje de respuesta al POS
    And no se emite ningún evento SSE

  Scenario: Precio exactamente en el mínimo, diferencia dentro del límite
    Given un mensaje PRICE_CHANGE con original_price 200 y requested_price 150
    When el authorization-service procesa el mensaje
    Then persiste la solicitud con estado PENDING
    And publica en store:{id}:requests un evento authorization_request

  Scenario: Diferencia dentro del límite — flujo de autorización
    Given un mensaje PRICE_CHANGE con original_price 1000 y requested_price 600
    When el authorization-service procesa el mensaje
    Then persiste la solicitud con estado PENDING
    And publica en store:{id}:requests un evento authorization_request con type PRICE_CHANGE

  Scenario: Diferencia sobre el límite — presencia física
    Given un mensaje PRICE_CHANGE con original_price 1000 y requested_price 400
    When el authorization-service procesa el mensaje
    Then publica REJECTED en auth.response.{store_id} con type PRICE_CHANGE
    And publica en store:{id}:dispatches un evento physical_presence_dispatch con pos_id y precios
    And no se persiste ninguna solicitud PENDING

  Scenario: original_price cero — guardia defensiva
    Given un mensaje PRICE_CHANGE con original_price 0 y requested_price 500
    When el authorization-service procesa el mensaje
    Then lanza InvalidPriceError
    And no se emite ningún mensaje de respuesta
```

```gherkin
Feature: Emisión SSE de presencia física
  Como sistema
  Quiero que el sse-server emita eventos physical_presence_dispatch en un stream SSE separado
  Para que el cliente los distinga sin ambigüedad

  Background:
    Given el sse-server está suscrito a store:{store_id}:requests y store:{store_id}:dispatches

  Scenario: Evento de presencia física llega por el canal correcto
    Given el authorization-service publicó en store:42:dispatches un PhysicalPresenceDispatch
    When el sse-server recibe el mensaje de Redis
    Then emite un MessageEvent con type "physical_presence_dispatch" hacia el BFF

  Scenario: Evento de autorización no contamina el canal de dispatches
    Given el authorization-service publicó en store:42:requests un authorization_request
    When el sse-server recibe el mensaje
    Then emite un MessageEvent con type "authorization_request"
    And no emite nada por el canal dispatches
```

```gherkin
Feature: Decisión del supervisor para cambios dentro del límite
  Como supervisor
  Quiero que el sistema acepte mi decisión y la publique al POS
  Para que el cajero pueda proceder

  Background:
    Given existe una solicitud PRICE_CHANGE PENDING con correlation_id "corr-123" y store_id "store-42"

  Scenario: Supervisor aprueba
    When el BFF recibe APPROVED para correlation_id "corr-123"
    Then el authorization-service publica en auth.response.store-42 con decision APPROVED y type PRICE_CHANGE
    And la solicitud queda persistida con status APPROVED y resolved_at

  Scenario: Supervisor rechaza
    When el BFF recibe REJECTED para correlation_id "corr-123"
    Then el authorization-service publica en auth.response.store-42 con decision REJECTED y type PRICE_CHANGE

  Scenario: Doble respuesta devuelve 409
    Given la solicitud "corr-123" ya está en estado APPROVED
    When el BFF intenta enviar una segunda decisión
    Then el BFF recibe HTTP 409
    And el estado de la solicitud no cambia
```

---

## Plan de Tests TDD

### US-01 — PriceChangeClassifier (domain service)

**Archivo:** `apps/authorization-service/src/domain/services/price-change-classifier.spec.ts`

- [x] [RED]   Retorna `EQUAL` cuando `requested_price === original_price`
- [x] [GREEN] Condición de igualdad
- [x] [RED]   Lanza `MinimumPriceViolationError` cuando `requested_price = 149`
- [x] [GREEN] Guardia de precio mínimo (`MIN_PRICE = 150`)
- [x] [RED]   `requested_price = 150` pasa la guardia y continúa
- [x] [RED]   Retorna `WITHIN_LIMIT` cuando diferencia ≤ 50 % (ej: 1000→600)
- [x] [GREEN] Cálculo porcentual
- [x] [RED]   Retorna `EXCEEDS_LIMIT` cuando diferencia > 50 % (ej: 1000→400)
- [x] [GREEN] Rama de exceso
- [x] [RED]   Lanza `InvalidPriceError` cuando `original_price === 0`
- [x] [GREEN] Guardia de división por cero
- [x] [RED]   `requested_price = 150`, `original_price = 200` → `WITHIN_LIMIT` (25 % diferencia)
- [x] [RED]   `requested_price = 150`, `original_price = 1000` → `EXCEEDS_LIMIT` (85 % diferencia)

---

### US-01 — ProcessPriceChangeUseCase

**Archivo:** `apps/authorization-service/src/domain/use-cases/process-price-change.use-case.spec.ts`

- [x] [RED]   Para `EQUAL`: invoca publisher con `APPROVED` + `type: PRICE_CHANGE`; no llama a repository.save ni eventEmitter
- [x] [GREEN] Rama EQUAL
- [x] [RED]   Para `WITHIN_LIMIT`: llama a repository.save con estado `PENDING` y campos de precio; luego emite al canal `store:{id}:requests`
- [x] [GREEN] Rama WITHIN_LIMIT
- [x] [RED]   Para `EXCEEDS_LIMIT`: invoca publisher con `REJECTED`; emite al canal `store:{id}:dispatches` con `PhysicalPresenceDispatchDto`; no llama a repository.save
- [x] [GREEN] Rama EXCEEDS_LIMIT
- [x] [RED]   Propaga `MinimumPriceViolationError` sin llamar a nada más
- [x] [RED]   Propaga `InvalidPriceError` sin llamar a nada más

**Integración** (`apps/authorization-service/test/`)
- [x] El consumer Kafka enruta mensajes `PRICE_CHANGE` al use-case delegado (no al orquestador directo)
- [x] `ProcessAuthorizationRequestUseCase` sigue procesando `DISCOUNT/CANCEL/SUSPEND/EMPLOYEE_BENEFIT` sin regresiones

---

### US-01 — Orquestador ProcessAuthorizationRequestUseCase

**Archivo:** `apps/authorization-service/src/domain/use-cases/process-authorization-request.use-case.spec.ts`  
*(modificar suite existente)*

- [x] [RED]   Branch `PRICE_CHANGE` delega a `ProcessPriceChangeUseCase` (spy/mock del use-case)
- [x] [GREEN] Branch añadido al switch/if del orquestador
- [x] Los `describe.each` de `DISCOUNT/CANCEL/SUSPEND/EMPLOYEE_BENEFIT` siguen en verde sin cambios

---

### US-02 — Segundo canal SSE

**Archivos:**
- `apps/sse-server/src/sse/sse.service.spec.ts`
- `apps/bff/src/stream/stream.service.spec.ts`

**sse-server**
- [x] [RED]   `SseService` suscribe `store:{id}:dispatches` además de `store:{id}:requests`
- [x] [GREEN] Suscripción al segundo canal en `onModuleInit` o equivalente
- [x] [RED]   Mensaje en `:dispatches` genera `MessageEvent` con `type: 'physical_presence_dispatch'`
- [x] [GREEN] Mapper del segundo canal
- [x] [RED]   Mensaje en `:requests` sigue generando `type: 'authorization_request'` (no regresión)

**bff**
- [x] [RED]   `StreamService` escucha `addEventListener('physical_presence_dispatch')` y lo reenvía
- [x] [GREEN] Listener añadido

---

### US-03 — Resolución y mapeo 409

**Archivos:**
- `apps/authorization-service/src/domain/use-cases/resolve-authorization.use-case.spec.ts` *(modificar)*
- `apps/authorization-service/src/authorization/authorization.controller.spec.ts` *(modificar)*

- [x] [RED]   `ResolveAuthorizationUseCase` incluye `type: PRICE_CHANGE` en el mensaje Kafka de respuesta
- [x] [GREEN] Campo `type` añadido al publisher call
- [x] [RED]   Controller mapea `Error('already APPROVED')` → HTTP 409
- [x] [GREEN] Guard/filter en el controller
- [x] [RED]   Controller mapea `Error('already REJECTED')` → HTTP 409

---

### US-04 — Entidad y trazabilidad

**Archivo:** `apps/authorization-service/src/domain/entities/authorization-request.entity.spec.ts` *(modificar)*

- [x] [RED]   `fromDto()` mapea `product_id`, `original_price`, `requested_price` cuando `type === PRICE_CHANGE`
- [x] [GREEN] Mapeo en `fromDto()`
- [x] [RED]   `fromDto()` deja `productId/originalPrice/requestedPrice` como `undefined` para `DISCOUNT`
- [x] Tests existentes de `fromDto()` siguen en verde

---

## Definition of Done

- [x] Todos los escenarios BDD pasan en CI
- [x] Cobertura de tests unitarios ≥ 90 % en `authorization-service`
- [x] Tests de integración pasan con Kafka y Redis reales
- [x] Code review aprobado por al menos 1 par
- [x] `PRICE_CHANGE` añadido al enum `RequestType` en `shared-types`
- [x] `AuthorizationResponseDto` incluye `type?: RequestType`
- [x] `PhysicalPresenceDispatchDto` exportado desde `shared-types`
- [x] `PriceChangeClassifier` vive en `domain/services/` sin imports de infra
- [x] El canal `store:{id}:dispatches` emite `physical_presence_dispatch`; el canal `store:{id}:requests` no cambia
- [x] El controller devuelve 409 (no 500) para solicitudes ya resueltas
- [x] Los tests existentes de `DISCOUNT/CANCEL/SUSPEND/EMPLOYEE_BENEFIT` siguen en verde sin modificación

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | `internal-server` debe soportar el campo `type` en `AuthorizationResponseDto` para discriminar PRICE_CHANGE |
| Dependencia externa | El POS debe enviar `product_id`, `original_price`, `requested_price` en el payload Kafka |
| Riesgo técnico | El doble canal Redis toca 3 servicios coordinados (authorization-service + sse-server + bff); deben desplegarse juntos |
| Regla de negocio | `MIN_PRICE = 150`; constante en el dominio, no en adapters ni en shared-types |
| Fuera de scope | `original_price < 150` no se valida aquí; es responsabilidad del POS antes de publicar |
| Fuera de scope | UI mobile (`PriceChangeCard`, `PhysicalPresenceAlert`, Detox E2E) — spec separado de bootstrap RN |
| Retry Kafka | `kafkajs` ya reintenta a nivel de producer por config; no se agrega retry manual acoplado a PRICE_CHANGE |

---

## Orden de implementación

```
1. shared-types          → enum PRICE_CHANGE, campos opcionales DTO, type? en response, PhysicalPresenceDispatchDto
   (todos los servicios dependen de este paso)

2a. PriceChangeClassifier  → domain service puro, spec unitario
2b. Entidad + fromDto()    → campos opcionales + mapeo
   (2a y 2b en paralelo)

3. ProcessPriceChangeUseCase + branch en orquestador + módulo binding
   (depende de 2a y 2b)

4. Segundo canal Redis (authorization-service emit → sse-server subscribe → bff listener)
   (depende de 3; los 3 servicios se despliegan juntos)

5. Corrección 500→409 en controller + type en ResolveAuthorizationUseCase
    (puede ir en paralelo a 4)

---

## Resultado

**Fecha de finalización:** 2026-06-05 (cierre documental; código implementado ~2026-06-02)
**Status del spec:** completed

### Implementado
- [x] US-01: `PriceChangeClassifier` (domain service) con orden de validación load-bearing: EQUAL → mínimo → 50% → división por cero. `ProcessPriceChangeUseCase` con 3 branches. `ProcessAuthorizationRequestUseCase` delega branch `PRICE_CHANGE`.
- [x] US-02: Segundo canal Redis `store:{id}:dispatches` → `physical_presence_dispatch`. `sse-server` suscribe ambos canales. `bff` escucha `physical_presence_dispatch` y lo reenvía.
- [x] US-03: `ResolveAuthorizationUseCase` reutilizado para PRICE_CHANGE. Controller mapea `assertPending` → HTTP 409. `type: PRICE_CHANGE` en respuesta Kafka.
- [x] US-04: `productId`, `originalPrice`, `requestedPrice` en entidad `AuthorizationRequest` con mapeo condicional desde `fromDto()`.

### No implementado / Desviaciones
- UI mobile (`PriceChangeCard`, `PhysicalPresenceAlert`): diferido intencionalmente en el spec original — `apps/mobile` no existía al momento del spec.
- `PhysicalPresenceDispatchDto` enviado en snake_case como el resto de DTOs compartidos.

### Tests
- authorization-service: **94/94 tests pasando** (10 suites) — `PriceChangeClassifier` (12 tests), `ProcessPriceChangeUseCase` (14 tests), orchestrator branch, controller 409
- sse-server: **8/8 tests pasando** — suscripción dual canal, mapping de tipo, no contaminación entre canales
- bff: **7/7 tests pasando** — `physical_presence_dispatch` re-emitido correctamente
```
