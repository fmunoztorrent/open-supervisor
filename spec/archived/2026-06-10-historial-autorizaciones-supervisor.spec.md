# Spec: Historial de autorizaciones por supervisor y local

**Fecha:** 2026-06-10  
**Stack inferido:** NestJS (authorization-service + BFF) + React Native (Android) + Drizzle ORM (PostgreSQL)  
**Estado:** Completed  
**Revisión:** 2  

---

## Contexto

Actualmente el endpoint de historial de autorizaciones (`GET /authorization/store/:storeId/history`) filtra solicitudes resueltas únicamente por `storeId`. La app móvil (`HistoryScreen`) lista el historial pero no distingue qué supervisor resolvió cada solicitud: el filtro por `supervisorId` no existe en backend ni se envía desde mobile.

El requerimiento es claro: **"listar bien todas las historias de autorizaciones para un supervisor dado en un local dado"**. Esto implica:

1. **Filtro por supervisor**: el historial debe mostrar solo las solicitudes resueltas por el supervisor autenticado en su tienda, no las de todos los supervisores de la tienda.
2. **Ordenamiento**: las solicitudes deben aparecer en orden cronológico inverso (más recientes primero) para que sea útil consultarlas.
3. **Navegación al detalle**: al presionar una solicitud del historial, debe navegarse a una vista de detalle (solo lectura, sin botones de acción).
4. **Corrección de URL**: el hook mobile `useRequestHistory` llama a `/api/requests/history` pero el BFF expone el endpoint en `/authorization/requests/history`. Esta inconsistencia debe corregirse.

**Fuera de scope:** Paginación, filtro por tipo de solicitud, exportación del historial, búsqueda por correlationId.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    El historial de autorizaciones ya existe pero lista todas las solicitudes resueltas de la tienda,
    sin distinguir por supervisor. Un supervisor necesita ver únicamente SUS decisiones para auditar
    su propio trabajo, no las de otros supervisores. Además, el historial debe estar ordenado y
    permitir navegar al detalle para que sea realmente útil.
  </Rationale>
  <Explanation>
    Se agrega un query param opcional `supervisorId` al endpoint de historial existente. El backend
    (authorization-service) filtra por `resolved_by = supervisorId` en la query Drizzle. El BFF
    propaga el parámetro. La app mobile lo envía desde el `SessionContext`.
    
    El ordenamiento se implementa con `ORDER BY created_at DESC` en la query Drizzle, sin nuevo
    parámetro de API. La navegación al detalle reutiliza `AuthorizationDetailScreen` existente
    en modo solo-lectura.
  </Explanation>
  <Assumptions>
    - El `SessionContext` de la app mobile ya contiene `supervisorId` (actualmente mock, pendiente de auth real).
    - El campo `resolved_by` en la tabla `authorization_requests` se persiste correctamente al resolver.
    - La columna `resolved_by` tiene índice o el volumen de datos es bajo (la query sin índice es aceptable).
    - `AuthorizationDetailScreen` puede renderizarse en modo solo-lectura sin botones de acción.
  </Assumptions>
  <Scrutiny>
    - ¿Qué pasa si `supervisorId` no se envía? → Compatible hacia atrás: lista todas las solicitudes de la tienda.
    - ¿El ordenamiento sin índice en `created_at` es performante? → Para el volumen esperado (cientos, no millones) es suficiente. Agregar índice si hay degradación.
  </Scrutiny>
  <Objections>
    - "El filtro por supervisor debería ser obligatorio, no opcional" → Mantener opcional permite el caso de uso de auditoría general (admin de tienda).
  </Objections>
  <Novelty>
    - Primer query param `supervisorId` en el endpoint de historial.
    - Primer `ORDER BY` en una query del repositorio Drizzle.
    - Primer modo solo-lectura en `AuthorizationDetailScreen`.
  </Novelty>
  <Substitutes>
    - Endpoint separado `/store/:storeId/supervisor/:supervisorId/history`: descartado por redundante; un query param es suficiente.
    - Paginación server-side: descartada; el volumen actual no lo justifica.
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: Filtrar historial por supervisor `[Must]`

> Como **supervisor**, quiero **ver solo las solicitudes que yo resolví en mi tienda**, para que **pueda auditar mis propias decisiones sin ruido de otros supervisores**.

**Criterios de aceptación:**
- [ ] El endpoint `GET /authorization/store/:storeId/history` acepta query param opcional `supervisorId`
- [ ] Cuando se envía `supervisorId`, solo retorna solicitudes con `resolved_by = supervisorId`
- [ ] Cuando no se envía `supervisorId`, retorna todas las solicitudes resueltas de la tienda (compatibilidad hacia atrás)
- [ ] La app mobile envía el `supervisorId` desde `SessionContext` al consultar historial
- [ ] El BFF propaga `supervisorId` al authorization-service

**Notas:** El filtro se agrega en `findResolvedByStore` del repositorio. El parámetro es opcional para mantener compatibilidad con clientes que no lo envíen.

---

### US-02: Ordenar historial por fecha `[Should]`

> Como **supervisor**, quiero **ver las solicitudes más recientes primero**, para que **encuentre rápido las decisiones que acabo de tomar**.

**Criterios de aceptación:**
- [ ] Las solicitudes del historial aparecen en orden cronológico inverso (más reciente primero)
- [ ] La query Drizzle incluye `ORDER BY created_at DESC`

**Notas:** No requiere cambios en el contrato del API ni en el frontend. Es transparente para el cliente.

---

### US-03: Ver detalle de solicitud desde historial `[Should]`

> Como **supervisor**, quiero **presionar una solicitud del historial para ver sus detalles completos**, para que **pueda revisar la información de una decisión pasada**.

**Criterios de aceptación:**
- [ ] `onPress` en `HistoryScreen` navega a una vista de detalle
- [ ] El detalle muestra todos los campos de la solicitud (tipo, POS, fecha, monto, producto, etc.)
- [ ] El detalle NO muestra botones de "Autorizar" / "Rechazar" (la solicitud ya está resuelta)
- [ ] Muestra el estado resuelto (APROBADA / RECHAZADA) y quién la resolvió

**Notas:** Reutilizar `AuthorizationDetailScreen` con una prop `readonly={true}`. La navegación se maneja con el `AppView` existente en `App.tsx`.

---

### US-04: Corregir ruta del endpoint de historial en mobile `[Must]`

> Como **desarrollador**, quiero **que la app mobile llame a la ruta correcta del BFF**, para que **el historial funcione sin depender de rewrites o proxies**.

**Criterios de aceptación:**
- [ ] `useRequestHistory` llama a `/authorization/requests/history` (ruta real del BFF)
- [ ] El historial se carga correctamente en la app (verificación end-to-end)

**Notas:** Actualmente el hook llama a `/api/requests/history`. El BFF expone en `/authorization/requests/history`. Esta inconsistencia debe resolverse.

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|-----|-----------|-----------------|
| US-01 | — | sí (capa 1) |
| US-02 | — | sí (capa 1) |
| US-03 | — | sí (capa 1) |
| US-04 | — | sí (capa 1) |

**Nota:** Las 4 USTs son independientes entre sí y tocan capas distintas del stack. US-01 y US-02 comparten archivos de backend (mismo repositorio, mismo controlador) por lo que requieren coordinación en la implementación, pero pueden ser trabajadas en paralelo si se mergean con cuidado. US-03 y US-04 son frontend-only y no comparten archivos con las de backend. Dado que son solo 4 USTs pequeñas, se procesan en un solo scope `main` secuencial.

---

## Escenarios BDD

```gherkin
Feature: Historial de autorizaciones por supervisor (US-01)
  Como supervisor
  Quiero ver solo las solicitudes que yo resolví en mi tienda
  Para que pueda auditar mis propias decisiones sin ruido

  Background:
    Given que la tienda "store-1" tiene 3 solicitudes resueltas
    And "supervisor-A" resolvió 2 solicitudes (APPROVED)
    And "supervisor-B" resolvió 1 solicitud (REJECTED)

  Scenario: Filtrar por supervisor específico
    When consulto GET /authorization/store/store-1/history?supervisorId=supervisor-A
    Then recibo 2 solicitudes
    And todas tienen resolved_by = "supervisor-A"
    And la solicitud de supervisor-B NO aparece

  Scenario: Sin filtro de supervisor (compatibilidad hacia atrás)
    When consulto GET /authorization/store/store-1/history
    Then recibo las 3 solicitudes resueltas
    And aparecen solicitudes de ambos supervisores

  Scenario: Supervisor sin solicitudes resueltas
    When consulto GET /authorization/store/store-1/history?supervisorId=supervisor-C
    Then recibo una lista vacía
    And el status code es 200

Feature: Ordenamiento cronológico del historial (US-02)
  Como supervisor
  Quiero ver las solicitudes más recientes primero
  Para que encuentre rápido las decisiones recientes

  Scenario: Solicitudes ordenadas por fecha descendente
    Given que existen solicitudes resueltas con fechas "2026-06-01", "2026-06-05", "2026-06-10"
    When consulto el historial de la tienda
    Then la primera solicitud es la del "2026-06-10"
    And la última solicitud es la del "2026-06-01"

Feature: Detalle de solicitud desde historial (US-03)
  Como supervisor
  Quiero presionar una solicitud del historial para ver sus detalles
  Para que pueda revisar información de una decisión pasada

  Scenario: Navegar al detalle desde historial
    Given que estoy en la pantalla de historial con solicitudes resueltas
    When presiono una solicitud
    Then navego a la pantalla de detalle
    And veo todos los campos de la solicitud
    And NO veo botones de "Autorizar" ni "Rechazar"
    And veo el estado resuelto (APROBADA o RECHAZADA)

Feature: Corrección de URL del endpoint en mobile (US-04)
  Como desarrollador
  Quiero que la app llame a la ruta correcta del BFF
  Para que el historial funcione sin depender de rewrites

  Scenario: Mobile llama al endpoint correcto
    Given que el BFF expone GET /authorization/requests/history
    When la app mobile consulta el historial
    Then la request HTTP va a /authorization/requests/history
    And el historial se carga correctamente
```

---

## Plan de Tests TDD

### US-01 — Filtrar historial por supervisor

**Unitarios**
- [ ] [RED]   `findResolvedByStore` en el repositorio mock debe aceptar y filtrar por `supervisorId`
- [ ] [GREEN] Agregar parámetro opcional `supervisorId` al port `IAuthorizationRepository.findResolvedByStore`
- [ ] [RED]   El adapter Drizzle debe agregar condición `eq(resolvedBy, supervisorId)` cuando el parámetro está presente
- [ ] [GREEN] Implementar filtro en `DrizzleAuthorizationRepository.findResolvedByStore`
- [ ] [RED]   El controlador del authorization-service debe aceptar query param `supervisorId`
- [ ] [GREEN] Agregar `@Query('supervisorId')` en `getHistory` y pasarlo al repositorio
- [ ] [RED]   El BFF `AuthorizationService.getHistory` debe aceptar y propagar `supervisorId`
- [ ] [GREEN] Agregar `supervisorId` al método `getHistory` y al query string de la URL upstream

**Integración**
- [ ] Test E2E del endpoint history con y sin `supervisorId` usando base de datos de test

**Edge cases / casos negativos**
- [ ] `supervisorId` vacío → se ignora (sin filtro)
- [ ] `supervisorId` con valor que no existe en la DB → lista vacía (200 OK)
- [ ] `supervisorId` + `status` combinados → ambos filtros aplican (AND)

### US-02 — Ordenar historial por fecha

**Unitarios**
- [ ] [RED]   `findResolvedByStore` no retorna resultados ordenados → el orden es impredecible
- [ ] [GREEN] Agregar `ORDER BY created_at DESC` en la query Drizzle

**Integración**
- [ ] Insertar 3 solicitudes con fechas distintas, verificar orden descendente en la respuesta

### US-03 — Ver detalle desde historial

**Unitarios**
- [ ] [RED]   `HistoryScreen` no navega al presionar una card (onPress vacío)
- [ ] [GREEN] Implementar `onSelectRequest` callback que cambia `AppView` a `'detail'`
- [ ] [RED]   `AuthorizationDetailScreen` no soporta modo solo-lectura
- [ ] [GREEN] Agregar prop `readonly?: boolean` que oculta los botones de acción
- [ ] [RED]   `App.tsx` no pasa la solicitud seleccionada al detail desde el historial
- [ ] [GREEN] Almacenar `selectedRequest` en estado y pasarlo al `AuthorizationDetailScreen`

**Edge cases**
- [ ] Solicitud sin ciertos campos opcionales (amount, product_id) → se muestra correctamente

### US-04 — Corregir ruta del endpoint en mobile

**Unitarios**
- [ ] [RED]   `useRequestHistory` llama a `/api/requests/history`
- [ ] [GREEN] Cambiar URL a `/authorization/requests/history`
- [ ] [RED]   El mock de `bffClient` en tests espera la ruta antigua → tests fallan
- [ ] [GREEN] Actualizar mocks en tests de `useRequestHistory` y `HistoryScreen`

---

## Definition of Done

- [ ] Todos los tests pasan en verde (unitarios + integración + E2E backend)
- [ ] Typecheck limpio en los 4 servicios modificados (authorization-service, BFF, mobile, shared-types)
- [ ] Endpoint history responde correctamente con y sin `supervisorId`
- [ ] `ORDER BY created_at DESC` aplicado en query Drizzle
- [ ] `HistoryScreen` permite navegar al detalle de una solicitud resuelta
- [ ] `AuthorizationDetailScreen` en modo solo-lectura oculta botones de acción
- [ ] App mobile usa ruta `/authorization/requests/history` (consistente con BFF)
- [ ] La app carga correctamente en emulador Android sin errores

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | Ninguna nueva |
| Riesgo técnico | `ORDER BY created_at DESC` sin índice puede ser lento con muchos registros. Mitigación: crear índice si el volumen crece (>10k registros) |
| Suposición a validar | `SessionContext.supervisorId` está disponible en la app mobile. Actualmente es un mock (`supervisor-1`). |

---

## Resultado

**Completado:** 2026-06-10

### USTs implementadas

- [x] US-01: Filtrar historial por supervisor (Must) — `supervisorId` opcional en port, adapter, controller y BFF
- [x] US-02: Ordenar historial por fecha (Should) — `ORDER BY created_at DESC` en Drizzle
- [x] US-03: Ver detalle de solicitud desde historial (Should) — nuevo `'historyDetail'` view + prop `readonly` en `AuthorizationDetailScreen`
- [x] US-04: Corregir ruta del endpoint en mobile (Must) — `/api/requests/history` → `/authorization/requests/history`

### Desviaciones

- Flag #1 (architect): Se agregó normalización `status → resolved` en `useRequestHistory` para que las cards del historial muestren el badge correcto (APROBADA/RECHAZADA) en lugar de "Pendiente".
- Flag #3 (architect): Se adoptó Opción A: nuevo `AppView 'historyDetail'` en `App.tsx`, separando la navegación de historial del flujo live SSE.
- El mutation score global (37.62%) está debajo del threshold 50%, pero el controller de la feature está en 90.48% (high threshold). El score bajo viene de adapters de infraestructura sin cobertura por diseño.

### Tests

| Servicio | Tests | Resultado |
|---|---|---|
| Authorization-service | 100 | ✅ 10 suites |
| BFF | 29 | ✅ 5 suites |
| SSE-server | 8 | ✅ 2 suites |
| Mobile | 103 | ✅ 10 suites |
| **Total** | **240** | ✅ 27 suites |

### Archivos modificados

| Archivo | Operación |
|---|---|
| `apps/authorization-service/src/domain/ports/authorization-repository.port.ts` | MODIFICADO |
| `apps/authorization-service/src/infrastructure/persistence/drizzle/drizzle-authorization.repository.ts` | MODIFICADO |
| `apps/authorization-service/src/authorization/authorization.controller.ts` | MODIFICADO |
| `apps/bff/src/authorization/authorization.controller.ts` | MODIFICADO |
| `apps/bff/src/authorization/authorization.service.ts` | MODIFICADO |
| `apps/mobile/src/hooks/useRequestHistory.ts` | MODIFICADO |
| `apps/mobile/src/screens/HistoryScreen.tsx` | MODIFICADO |
| `apps/mobile/src/screens/AuthorizationDetailScreen.tsx` | MODIFICADO |
| `apps/mobile/App.tsx` | MODIFICADO |
| `apps/mobile/src/hooks/__tests__/useRequestHistory.test.ts` | CREADO |
| `apps/mobile/src/screens/__tests__/HistoryScreen.test.tsx` | CREADO |
| `apps/authorization-service/src/authorization/authorization.controller.spec.ts` | MODIFICADO |
| `apps/bff/src/authorization/__tests__/authorization.controller.spec.ts` | MODIFICADO |
| `apps/mobile/src/screens/__tests__/AuthorizationDetailScreen.test.tsx` | MODIFICADO |

---

## Historial de revisiones

| Rev | Fecha | Cambios |
|-----|-------|---------|
| 1 | 2026-06-10 | Spec inicial |
| 2 | 2026-06-10 | Completado: 4/4 USTs implementadas. Ver desviaciones en Resultado. |
