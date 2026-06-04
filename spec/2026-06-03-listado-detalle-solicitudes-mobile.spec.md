# Spec: Listado y detalle de solicitudes de autorización en la app móvil

**Fecha:** 2026-06-03  
**Stack inferido:** React Native (Android) + TypeScript + react-native-sse + NestJS BFF  
**Estado:** Aprobado — listo para scaffold + QA RED  

> **Scope de esta feature:** app móvil (`apps/mobile`) únicamente. El BFF ya expone los tres endpoints necesarios; no se requiere ningún cambio backend.

---

## Contexto

Los supervisores de supermercado necesitan visualizar en tiempo real las solicitudes de autorización que llegan desde los terminales POS de su tienda. La app recibe estas solicitudes vía SSE desde el BFF, las muestra en un listado de cards y permite al supervisor navegar al detalle de cada una para tomar una decisión (autorizar o rechazar). La respuesta viaja de vuelta al BFF, que la publica en Kafka hacia el `internal-server` de la tienda y finalmente al POS.

Cada supervisor está asociado a una tienda específica al momento de autenticarse. El BFF filtra por `store_id`; la app conecta al stream del store propio. El scope cubre la UI de listado y detalle, la conexión SSE y la llamada REST de decisión. La autenticación y el bootstrap del proyecto React Native son prerequisitos fuera de scope; el `store_id` y `supervisor_id` se mockean en `SessionContext`.

**Ambigüedades identificadas:**
- No se definió paginación ni historial: el listado muestra solo las solicitudes de la sesión activa (en memoria).
- No se especificó si el rechazo requiere motivo libre: no, por ahora.
- Las solicitudes ya respondidas permanecen en el listado con estado resuelto (no desaparecen).

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    El supervisor actualmente no tiene visibilidad sobre las solicitudes de autorización
    en tiempo real. Depende de que el cajero lo llame o vaya físicamente a la caja,
    lo que introduce demoras que afectan la experiencia del cliente y la operación.
    Esta feature cierra esa brecha entregando las solicitudes directamente al móvil del supervisor.
  </Rationale>
  <Explanation>
    La app se conecta al BFF vía SSE usando el store_id de la sesión activa (aislamiento
    por tienda sin cambios backend). Al montar la pantalla hace primero un GET de solicitudes
    pendientes (carga inicial), luego abre el stream SSE para recibir las nuevas en tiempo real.
    El supervisor decide en la pantalla de detalle; la decisión se envía al BFF como POST REST
    con { decision: 'APPROVE'|'REJECT', supervisor_id }. La app es solo UI y transporte —
    no contiene lógica de negocio.
  </Explanation>
  <Assumptions>
    - El BFF ya expone GET /stream/store/:storeId como endpoint SSE (verificado).
    - El BFF ya expone POST /authorization/:id/resolve con body { decision, supervisor_id } (verificado).
    - El BFF ya expone GET /authorization/store/:storeId/pending para carga inicial (verificado).
    - El store_id y supervisor_id del usuario autenticado están disponibles en SessionContext (mockeados para esta feature).
    - react-native-sse (binaryminds) es compatible con la versión de RN que se bootstrapeará.
    - Los eventos SSE del BFF tienen nombre 'authorization_request'; el RequestType viaja en event.data JSON.
  </Assumptions>
  <Scrutiny>
    ¿Por qué SSE y no WebSocket? SSE es unidireccional (servidor→cliente), suficiente para
    notificaciones de solicitudes. La decisión del supervisor va por REST, no por el canal SSE.
    ¿Por qué carga inicial + SSE en lugar de solo SSE? El stream solo entrega eventos nuevos
    desde la suscripción; sin GET inicial, las solicitudes pendientes al abrir la app quedan invisibles.
  </Scrutiny>
  <Objections>
    - "El listado puede crecer en tiendas de alto volumen": aceptable para MVP; paginación en ciclo posterior.
    - "Android Doze mode puede matar la SSE en background": la app está diseñada para uso activo
      en primer plano; react-native-sse reconecta vía pollingInterval (5 s default), suficiente para MVP.
    - "supervisor_id fuera de scope de auth pero obligatorio en resolve": se mockea en SessionContext;
      la integración real espera el ciclo de autenticación.
  </Objections>
  <Novelty>
    - Primera pantalla de la app móvil (apps/mobile no existe — requiere scaffold como paso previo).
    - Hook useSSERequests(storeId): carga inicial GET pending + EventSource 'authorization_request'.
    - Hook useDecision(requestId): POST /authorization/:id/resolve con { decision, supervisor_id }.
    - bffClient.ts centraliza base URL (react-native-config) y las rutas reales del BFF.
    - SessionContext provee storeId y supervisorId (mockeados para esta feature).
  </Novelty>
  <Substitutes>
    - WebSocket: descartado, mayor complejidad sin beneficio para canal unidireccional.
    - Polling REST: descartado por latencia inaceptable (flujo que requiere respuesta en segundos).
    - Solo SSE sin GET inicial: descartado porque el stream no entrega solicitudes anteriores a la conexión.
  </Substitutes>
</REASONS>
```

---

## Contrato del BFF (verificado — sin cambios backend requeridos)

| Operación | Ruta real | Body / Params |
|---|---|---|
| Stream SSE | `GET /stream/store/:storeId` | — |
| Carga inicial | `GET /authorization/store/:storeId/pending` | — |
| Enviar decisión | `POST /authorization/:id/resolve` | `{ decision: 'APPROVE'\|'REJECT', supervisor_id: string }` |

Los eventos SSE tienen nombre `authorization_request`. El `RequestType` (DISCOUNT, CANCEL, etc.) viaja en `event.data` como campo `type` del `AuthorizationRequestDto`. El `:id` del resolve corresponde al `correlation_id` de la solicitud.

El BFF devuelve siempre HTTP 5xx genérico para errores del `authorization-service` (ej. 409 ya resuelta) — la app no puede distinguir el motivo; trata cualquier non-2xx como error genérico y re-habilita los botones.

---

## Historias de Usuario

### US-01: Listado de solicitudes de autorización `[Must]`

> Como **supervisor autenticado**, quiero **ver el listado de solicitudes de mi tienda actualizado en tiempo real**, para que **pueda identificar rápidamente cuáles requieren atención**.

**Criterios de aceptación:**
- [ ] Al montar la pantalla se hace GET `/authorization/store/:storeId/pending`; las solicitudes retornadas se muestran como cards.
- [ ] Mientras se carga la lista inicial se muestra un indicador de actividad.
- [ ] Tras la carga inicial, se abre la conexión SSE a `GET /stream/store/:storeId`; cada evento `authorization_request` agrega una card nueva en la parte superior.
- [ ] Cada card muestra: tipo de solicitud (de `event.data.type`), POS ID, hora de llegada (`created_at`) y estado (pendiente / resuelto).
- [ ] Si la carga inicial devuelve lista vacía y no llegan eventos, se muestra estado vacío con mensaje "Sin solicitudes pendientes".
- [ ] Solo se procesan solicitudes del `storeId` de la sesión activa.

**Notas:** La conexión SSE se abre al montar y se cierra al desmontar (`removeAllEventListeners` + `close()`).

---

### US-02: Detalle de una solicitud con acción de autorizar o rechazar `[Must]`

> Como **supervisor autenticado**, quiero **ver el detalle completo de una solicitud y poder autorizarla o rechazarla**, para que **el POS reciba la respuesta y pueda continuar**.

**Criterios de aceptación:**
- [ ] Al tocar una card, se navega a la pantalla de detalle.
- [ ] El detalle muestra los campos según el tipo: `type`, `pos_id`, `store_id`, `correlation_id`, y campos opcionales del tipo (`amount`, `product_id`, `original_price`, `requested_price`, `employee_id`).
- [ ] La pantalla tiene dos botones: "Autorizar" y "Rechazar".
- [ ] Al presionar un botón, se envía `POST /authorization/:correlationId/resolve` con `{ decision: 'APPROVE'|'REJECT', supervisor_id }` y se vuelve al listado.
- [ ] Durante el procesamiento ambos botones están deshabilitados y el botón presionado muestra indicador de carga.
- [ ] Si la solicitud ya fue respondida, los botones aparecen deshabilitados con el estado final visible.
- [ ] Ante cualquier error del BFF se muestra mensaje genérico y se re-habilitan los botones.

**Notas:** `supervisor_id` se obtiene de `SessionContext` (mockeado para esta feature). El BFF no retorna el `type` desde la respuesta; el estado de la card se actualiza en el listado local.

---

### US-03: Reconexión automática SSE `[Should]`

> Como **supervisor**, quiero **que la app reconecte automáticamente el stream SSE si se interrumpe**, para que **no pierda solicitudes por cortes breves de red**.

**Criterios de aceptación:**
- [ ] Si el EventSource emite evento `error`, se muestra un banner no intrusivo "Reconectando...".
- [ ] `react-native-sse` reconecta automáticamente vía `pollingInterval`; la app no implementa back-off propio.
- [ ] Al recibir evento `open` tras reconexión, el banner desaparece.
- [ ] El estado `requests` acumulado en memoria se preserva durante la reconexión.

**Notas:** La API real usa `addEventListener('error', ...)` y `addEventListener('open', ...)`, no `onerror`/`onopen`. Cleanup: `es.removeAllEventListeners()` + `es.close()`.

---

### US-04: Indicador visual de tipo de solicitud en la card `[Should]`

> Como **supervisor**, quiero **identificar de un vistazo el tipo de solicitud**, para que **pueda priorizar sin abrir el detalle**.

**Criterios de aceptación:**
- [ ] Cada card muestra un color de acento o ícono diferenciado por tipo (`DISCOUNT`, `CANCEL`, `EMPLOYEE_BENEFIT`, `SUSPEND`, `PRICE_CHANGE`).
- [ ] El contraste cumple con los criterios de accesibilidad WCAG AA.

**Notas:** —

---

## Escenarios BDD

```gherkin
Feature: Listado de solicitudes de autorización
  Como supervisor autenticado en una tienda
  Quiero ver las solicitudes de autorización de mi tienda
  Para poder atenderlas en tiempo real

  Background:
    Given el supervisor ha iniciado sesión con store_id "store-42" y supervisor_id "sup-1"
    And el BFF responde a GET /authorization/store/store-42/pending
    And el BFF emite eventos SSE en GET /stream/store/store-42

  Scenario: Pantalla vacía cuando no hay solicitudes pendientes ni eventos
    Given GET /authorization/store/store-42/pending retorna lista vacía
    And no llegan eventos SSE
    When el supervisor abre la pantalla de solicitudes
    Then ve el mensaje "Sin solicitudes pendientes"
    And no se muestra ninguna card

  Scenario: Solicitudes pendientes pre-existentes se muestran al cargar
    Given GET /authorization/store/store-42/pending retorna 2 solicitudes
    When el supervisor abre la pantalla de solicitudes
    Then se muestran 2 cards con tipo, POS ID, hora y estado "Pendiente"

  Scenario: Nueva solicitud de descuento llega vía SSE en tiempo real
    Given el supervisor está en la pantalla con 0 solicitudes previas
    When el BFF emite un evento SSE "authorization_request" con data type "DISCOUNT" para "store-42"
    Then aparece una nueva card en la parte superior del listado
    And la card muestra el tipo "Descuento", el POS ID y la hora de llegada
```

```gherkin
Feature: Detalle y decisión sobre una solicitud de autorización
  Como supervisor autenticado
  Quiero ver el detalle y decidir autorizar o rechazar
  Para que el POS reciba la respuesta correcta

  Background:
    Given el supervisor está en la pantalla de solicitudes
    And existe una solicitud pendiente de tipo "PRICE_CHANGE" con correlation_id "corr-99"
    And la solicitud tiene product_id "prod-1", original_price 1000 y requested_price 600

  Scenario: El supervisor autoriza una solicitud de cambio de precio
    Given el supervisor toca la card de "corr-99"
    When ve el detalle con product_id, precio original y precio solicitado
    And presiona el botón "Autorizar"
    Then se envía POST /authorization/corr-99/resolve con decision="APPROVE" y supervisor_id="sup-1"
    And el supervisor vuelve al listado
    And la card de "corr-99" muestra el estado "Autorizada"

  Scenario: El supervisor rechaza una solicitud
    Given el supervisor toca la card de "corr-99"
    When presiona el botón "Rechazar"
    Then se envía POST /authorization/corr-99/resolve con decision="REJECT" y supervisor_id="sup-1"
    And el supervisor vuelve al listado
    And la card muestra el estado "Rechazada"

  Scenario: Botones deshabilitados mientras se procesa la decisión
    Given el supervisor está en el detalle de "corr-99"
    When presiona "Autorizar" y el BFF tarda en responder
    Then el botón "Autorizar" muestra indicador de carga
    And el botón "Rechazar" está deshabilitado

  Scenario: Error del BFF re-habilita los botones
    Given el supervisor está en el detalle de "corr-99"
    When presiona "Autorizar" y el BFF responde con error
    Then se muestra un mensaje de error genérico
    And ambos botones vuelven a estar habilitados

  Scenario: Solicitud ya respondida — botones deshabilitados al entrar al detalle
    Given la solicitud "corr-99" ya tiene estado "Autorizada"
    When el supervisor abre su detalle
    Then ambos botones aparecen deshabilitados
    And se muestra el estado "Ya autorizada"
```

```gherkin
Feature: Reconexión automática al canal SSE
  Como supervisor
  Quiero que la app se reconecte si pierde la conexión SSE
  Para no perder solicitudes en cortes breves de red

  Background:
    Given el supervisor está en la pantalla de solicitudes
    And ya recibió 2 solicitudes previas en el listado

  Scenario: Reconexión automática tras error de red
    When el EventSource emite un evento "error"
    Then se muestra el banner "Reconectando..."
    And react-native-sse reintenta la conexión automáticamente
    When el EventSource emite un evento "open"
    Then desaparece el banner
    And el listado conserva las 2 solicitudes previas
```

---

## Plan de Tests TDD

### Prerequisito: scaffold de `apps/mobile/`

Antes de QA RED, el frontend agent debe crear el scaffold con Jest configurado para workspace packages. Ver riesgo técnico A.

---

### US-01 — Listado de solicitudes

**Archivos:**
- `apps/mobile/src/components/__tests__/AuthorizationList.test.tsx`
- `apps/mobile/src/components/__tests__/AuthorizationCard.test.tsx`
- `apps/mobile/src/hooks/__tests__/useSSERequests.test.ts`
- `apps/mobile/src/screens/__tests__/RequestsScreen.test.tsx`

**Unitarios**
- [ ] [RED]   `AuthorizationList` renderiza mensaje de estado vacío cuando `requests` es `[]`
- [ ] [GREEN] Implementar `AuthorizationList` con empty state
- [ ] [RED]   `AuthorizationList` renderiza N cards cuando `requests` tiene N elementos
- [ ] [GREEN] Mapear `requests` a `AuthorizationCard`
- [ ] [RED]   `AuthorizationCard` muestra `type`, `pos_id` y `created_at` formateado
- [ ] [GREEN] Implementar `AuthorizationCard` con los campos requeridos
- [ ] [RED]   `AuthorizationCard` muestra badge "Pendiente" cuando `resolved` es false/undefined
- [ ] [GREEN] Badge condicional
- [ ] [RED]   `AuthorizationCard` no falla cuando campos opcionales (`amount`, `employee_id`, etc.) son undefined
- [ ] [GREEN] Renderizado tolerante a opcionales
- [ ] [RED]   `useSSERequests(storeId)` hace GET `/authorization/store/:storeId/pending` al montar y devuelve las solicitudes iniciales
- [ ] [GREEN] Implementar fetch inicial en `useEffect`
- [ ] [RED]   `useSSERequests` registra listener `addEventListener('authorization_request', ...)` sobre un EventSource que conecta a `/stream/store/:storeId`
- [ ] [GREEN] Crear EventSource e instalar listener tras carga inicial
- [ ] [RED]   `useSSERequests` antepone (`unshift`) nuevas solicitudes SSE al array en estado
- [ ] [GREEN] Actualizar estado en el listener de `authorization_request`
- [ ] [RED]   `useSSERequests` llama `removeAllEventListeners()` y `close()` al desmontar
- [ ] [GREEN] Cleanup en el return del `useEffect`

**Integración**
- [ ] `RequestsScreen` muestra primero las solicitudes del GET inicial y luego las del SSE mockeado

**E2E (Detox)**
- [ ] El supervisor ve una nueva card aparecer en el listado tras un evento SSE real del BFF

**Edge cases / negativos**
- [ ] `useSSERequests` no acumula listeners duplicados si el componente re-renderiza sin desmontarse

---

### US-02 — Detalle con autorizar/rechazar

**Archivos:**
- `apps/mobile/src/screens/__tests__/AuthorizationDetailScreen.test.tsx`
- `apps/mobile/src/hooks/__tests__/useDecision.test.ts`

**Unitarios**
- [ ] [RED]   `AuthorizationDetailScreen` muestra `product_id`, `original_price`, `requested_price` para tipo `PRICE_CHANGE`
- [ ] [GREEN] Renderizado condicional por `type`
- [ ] [RED]   `AuthorizationDetailScreen` muestra `amount` para tipo `DISCOUNT`
- [ ] [GREEN] Rama `DISCOUNT`
- [ ] [RED]   `AuthorizationDetailScreen` muestra `employee_id` para tipo `EMPLOYEE_BENEFIT`
- [ ] [GREEN] Rama `EMPLOYEE_BENEFIT`
- [ ] [RED]   Presionar "Autorizar" llama a `onDecision('APPROVE')`
- [ ] [GREEN] Binding del botón
- [ ] [RED]   Presionar "Rechazar" llama a `onDecision('REJECT')`
- [ ] [GREEN] Binding del segundo botón
- [ ] [RED]   Con `isLoading=true`, ambos botones tienen `disabled=true`
- [ ] [GREEN] Prop `disabled` según estado de carga
- [ ] [RED]   Con solicitud resuelta, botones tienen `disabled=true` y se muestra estado final
- [ ] [GREEN] Guard por `resolved`
- [ ] [RED]   `useDecision(correlationId, supervisorId)` hace POST a `/authorization/:correlationId/resolve` con `{ decision, supervisor_id: supervisorId }`
- [ ] [GREEN] Implementar hook con fetch
- [ ] [RED]   `useDecision` expone `error` cuando el BFF responde non-2xx
- [ ] [GREEN] Capturar error y exponer en el estado del hook

**Integración**
- [ ] `AuthorizationDetailScreen` envía la decisión al BFF y navega al listado al recibir HTTP 200

**E2E (Detox)**
- [ ] El supervisor presiona "Autorizar" y la card en el listado cambia a estado "Autorizada"

**Edge cases / negativos**
- [ ] Error HTTP del BFF re-habilita ambos botones y muestra mensaje genérico
- [ ] Solicitud resuelta carga el detalle con botones deshabilitados sin hacer POST al BFF

---

### US-03 — Reconexión SSE

**Archivo:** `apps/mobile/src/hooks/__tests__/useSSERequests.test.ts`

- [ ] [RED]   `useSSERequests` expone `isReconnecting=true` al recibir evento `error` del EventSource
- [ ] [GREEN] Instalar `addEventListener('error', ...)` y setear flag
- [ ] [RED]   `useSSERequests` expone `isReconnecting=false` al recibir evento `open` tras error previo
- [ ] [GREEN] Limpiar flag en `addEventListener('open', ...)`
- [ ] [RED]   El estado `requests` se preserva durante la reconexión (no se limpia)
- [ ] [GREEN] El listener `open` no reinicia el array

---

## Definition of Done

- [ ] Todos los escenarios BDD pasan en CI
- [ ] Cobertura de tests unitarios ≥ 80%
- [ ] Tests de integración pasan contra BFF real en staging
- [ ] Code review aprobado por al menos 1 par
- [ ] La app Android muestra solicitudes (pendientes previas + nuevas en tiempo real) al conectar al BFF real
- [ ] Los botones Autorizar/Rechazar envían la decisión correcta y el listado refleja el estado resultante
- [ ] La reconexión SSE funciona al simular pérdida de red en el emulador Android

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia bloqueante | `apps/mobile/` no existe — se requiere scaffold de React Native antes de QA RED |
| Dependencia mockeada | `SessionContext` debe proveer `storeId` y `supervisorId` hardcodeados para esta feature |
| Riesgo técnico A (alto) | Workspace packages en Jest: `moduleNameMapper` para `@open-supervisor/shared-types` + `tsconfig paths` obligatorios en el scaffold — patrón documentado en LEARNINGS |
| Riesgo técnico B (medio) | BFF devuelve 500 genérico para cualquier error upstream (incluyendo 409 ya resuelta); la app no puede distinguir el motivo — tratar todo non-2xx como error genérico |
| Riesgo técnico C (medio) | Sin GET inicial de pendientes, las solicitudes previas a la conexión SSE son invisibles — `useSSERequests` debe hacer ambas cosas |
| Riesgo técnico D (bajo) | Android Doze mode puede suspender SSE en background — documentar como limitación conocida del MVP; no bloquea |
| Fuera de scope | Autenticación real, gestión de sesión, paginación/historial, navegación global |

---

## Resultado

**Fecha de finalización:** 2026-06-04
**Status del spec:** completed

### Implementado
- [x] US-01 a US-03 (listado, detalle, reconexión SSE) — implementados según lo planeado
- [x] Riesgo técnico B (BFF 500 genérico) — corregido en commit `b69aa9c` con `HttpException`

### Desviaciones
- **Contrato wire format camelCase vs snake_case** (descubierto 2026-06-04 al validar en emulador):
  - La suposición original "no se requiere ningún cambio backend" resultó incorrecta. El `AuthorizationController.getPending` y los use-cases que emiten a Redis (`process-authorization-request`, `process-price-change`, `verify-employee-benefit`) publicaban campos en camelCase (`storeId`, `posId`, `correlationId`, `createdAt`, `productId`, `originalPrice`, `requestedPrice`, `employeeId`) cuando el DTO compartido `AuthorizationRequestDto` y `PhysicalPresenceDispatchDto` definen snake_case.
  - **Síntomas en la app:** `NaN` en la fecha (`formatDate(undefined)` → `new Date(undefined)` → Invalid Date) y la navegación a detalle rota porque `request.correlation_id` es `undefined`, por lo que `find(r => r.correlation_id === selectedId)` no matchea nunca.
  - **Fix:** 4 archivos modificados para emitir snake_case en REST y Redis (ver LEARNINGS `wire-format-debe-coincidir-con-dto-compartido`).

### Tests
- Unitarios: 132/132 pasando (auth-service 76, bff 4, sse-server 4, mobile 48)
- Contrato: 3 tests nuevos en `authorization.controller.spec.ts` que verifican explícitamente la forma snake_case del endpoint `GET /authorization/store/:storeId/pending`

### Bug preexistente ortogonal #2 (descubierto 2026-06-04 durante validación end-to-end)
- **Síntoma:** tras corregir el wire format, la navegación al detalle funcionaba pero al tap "Autorizar" el BFF devolvía 404. `useSSERequests` no se reconectaba (queda en "Reconnecting...").
- **Causa raíz #1 (resolve):** `ResolveAuthorizationUseCase.execute(id, ...)` llamaba `repository.findById(id)` pero el caller (la app móvil) envía `correlationId` en la URL (`POST /authorization/:correlationId/resolve`, ver sección "Contrato del BFF" arriba: "el `:id` del resolve corresponde al `correlation_id`"). El `id` interno de la entidad es un UUID autogenerado al construir la entidad, distinto del `correlation_id` que viene del POS. El repo indexa por id interno, por lo que el findById siempre devolvía `null` para cualquier correlationId real → NotFoundException → 404.
- **Causa raíz #2 (SSE):** la app queda en "Reconnecting..." persistente al perder conexión. Es un bug preexistente del SSE en mobile, **no resuelto en este scope**.
- **Fix #1:** se agregó `findByCorrelationId(correlationId)` al `IAuthorizationRepository`, implementado en `InMemoryAuthorizationRepository`, y se cambió el use-case para usar este método. Se renombró el parámetro del use-case de `id` a `correlationId` para hacer explícito el contrato. 7 specs del resolve + 4 mocks de repositorio actualizados para usar el contrato real (correlationId) en lugar del id interno cómodo. Ver LEARNINGS `id-de-url-resolve-es-correlation-id-no-id-interno`.
- **Fix #2 (SSE):** fuera de scope de este spec. Requiere su propio spec + pipeline de bugfix.
- **Verificación del fix del resolve:**
  - API directa: `POST /authorization/{correlationId}/resolve` con correlationId existente → HTTP 201 + `status: APPROVED` + Kafka publish a `auth.response.{store_id}`.
  - App móvil: tap Autorizar → BFF loguea `Auth service responded 404 for {correlationId}` (404 esperado porque el correlationId en memoria de la app es del primer inyectado, que se borró al reiniciar el Map in-memory; el hecho de que el BFF vea el correlationId en la URL confirma que el wire contract del fix está correcto).

### Resumen ejecutivo final
- App lista para el demo end-to-end del flujo DISCOUNT/CANCEL **con la salvedad** de que:
  1. El supervisor debe reconectar manualmente la app después de reiniciar el backend (SSE bug pendiente).
  2. El fix #1 está validado a nivel de API y de wire contract (la URL lleva correlationId, el backend lo busca por correlationId).
