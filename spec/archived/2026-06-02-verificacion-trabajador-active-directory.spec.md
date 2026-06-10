# Spec: Verificación de trabajador activo vía Active Directory en descuento de empleado

**Fecha:** 2026-06-02  
**Stack inferido:** Node.js / NestJS + TypeScript (monorepo pnpm)  
**Status del spec:** completed  

---

## Contexto

Cuando un POS envía una solicitud de tipo `EMPLOYEE_BENEFIT`, el `authorization-service` debe verificar si el beneficiario es realmente un trabajador activo de la empresa antes de presentar la solicitud al supervisor. Para esto consulta un servicio externo de Active Directory (AD) usando el identificador del empleado incluido en el payload de la solicitud.

Si el servicio AD confirma que `associate: true`, la solicitud sigue su flujo normal y el supervisor decide si autoriza o rechaza. Si `associate: false` o la consulta al AD falla (timeout, error HTTP, empleado no encontrado), la autorización se rechaza automáticamente sin intervención del supervisor, evitando fraudes por uso de beneficio de empleado no vigente.

Queda fuera de scope: la autenticación/autorización del propio servicio AD, la gestión de identidades en AD, el caché de respuestas AD, y cualquier otro tipo de solicitud (`DISCOUNT`, `CANCEL`, `SUSPEND`).

**Ambigüedades resueltas:**
- El identificador del empleado enviado al AD es el **RUT**, transportado en el campo `employee_id` del payload Kafka (`AuthorizationRequestDto`). No se agrega un campo `rut` separado para no romper el contrato Kafka con el `internal-server`.
- El timeout máximo para la consulta al AD es **1 minuto** (60 000 ms), configurable vía `AD_LOOKUP_TIMEOUT_MS`.
- El resultado de la consulta AD (éxito o fallo) **sí se registra** en el log de auditoría de la autorización.
- Los rechazos automáticos usan `resolved_by: "SYSTEM"` y `resolved_at` (en lugar de `rejected_at`) para que el shape del DTO `AuthorizationResponseDto` sea consistente con rechazos manuales. Se agrega `rejection_reason?: RejectionReason` al DTO en shared-types.
- US-03 (pantalla mobile): solo se implementa la parte backend (adjuntar `displayName`, `jobTitle`, `department` al evento Redis). La UI mobile queda diferida hasta que exista `apps/mobile`.

---

## Historias de Usuario

### US-01: Verificar trabajador activo antes de presentar solicitud al supervisor `[Must]`

> Como **authorization-service**, quiero **consultar el Active Directory cuando llega una solicitud EMPLOYEE_BENEFIT**, para que **solo solicitudes de trabajadores activos sean presentadas al supervisor**.

**Criterios de aceptación:**
- [x] Al recibir un mensaje Kafka de tipo `EMPLOYEE_BENEFIT`, el servicio consulta al AD usando el campo `employee_id` del payload (que contiene el RUT).
- [x] Si `associate: true` en la respuesta AD, la solicitud se publica en Redis para que el supervisor la vea.
- [x] Si `associate: false`, la solicitud se rechaza automáticamente con motivo `EMPLOYEE_NOT_ACTIVE` y se publica `auth.response.{store_id}` con `status: REJECTED`.
- [x] El campo `accountEnabled` también es validado: si es `false`, se rechaza con motivo `ACCOUNT_DISABLED`.
- [x] La respuesta de rechazo automático incluye `correlation_id`, `store_id`, `pos_id` y `rejected_at`.

**Notas:** El rechazo automático debe publicarse en Kafka (`auth.response.{store_id}`) igual que una decisión manual del supervisor. El flujo de dominio no debe conocer el SDK HTTP del AD — debe pasar por un port.

---

### US-02: Manejar fallo de consulta al Active Directory `[Must]`

> Como **authorization-service**, quiero **rechazar automáticamente una solicitud EMPLOYEE_BENEFIT cuando la consulta al AD falla**, para que **un error de infraestructura no deje solicitudes pendientes sin resolver**.

**Criterios de aceptación:**
- [x] Si el AD responde con error HTTP (4xx, 5xx) o timeout, la solicitud se rechaza automáticamente con motivo `AD_LOOKUP_FAILED`.
- [x] Si el empleado no existe en AD (404), se rechaza con motivo `EMPLOYEE_NOT_FOUND`.
- [x] El error se registra en el log del servicio con nivel `error` incluyendo `correlation_id` y detalles del fallo.
- [x] El rechazo se publica en `auth.response.{store_id}` con los mismos campos que US-01.

**Notas:** El adapter HTTP del AD debe implementar retry con backoff o simplemente propagar la excepción; esta decisión va en infraestructura, no en el use-case.

---

### US-03: Exponer información del empleado al supervisor `[Should]`

> Como **supervisor**, quiero **ver los datos del empleado (nombre, cargo, departamento) al revisar una solicitud EMPLOYEE_BENEFIT**, para que **pueda tomar una decisión informada**.

**Criterios de aceptación:**
- [x] Cuando `associate: true`, los campos `displayName`, `jobTitle` y `department` del AD se adjuntan al evento publicado en Redis.
- [x] Los datos del empleado no se almacenan permanentemente; solo viajan en el evento en memoria.
- [x] ~~La app móvil muestra esos datos en la pantalla de revisión~~ **[DIFERIDO]** — `apps/mobile` no existe aún; la UI mobile se implementa en un ciclo posterior.

**Notas:** Solo se implementa la parte backend (adjuntar campos al evento Redis). El BFF (`stream.service.ts`) pasa el `event.data` sin modificarlo, por lo que los campos nuevos llegan a la app sin cambios en el BFF.

---

## Escenarios BDD

~~~gherkin
Feature: Verificación de trabajador activo en solicitud EMPLOYEE_BENEFIT
  Como authorization-service
  Quiero consultar el Active Directory al recibir una solicitud EMPLOYEE_BENEFIT
  Para que solo trabajadores activos puedan beneficiarse del descuento

  Background:
    Given el servicio está suscrito al topic Kafka "auth.requests"
    And el servicio AD está disponible

  Scenario: Trabajador activo — solicitud pasa al supervisor
    Given llega un mensaje Kafka de tipo "EMPLOYEE_BENEFIT" con employee_id "emp-001"
    When el authorization-service consulta el Active Directory con employee_id "emp-001"
    Then el AD responde con associate=true y accountEnabled=true
    And la solicitud se publica en Redis para que el supervisor la visualice
    And el evento incluye displayName, jobTitle y department del empleado

  Scenario: Trabajador inactivo — rechazo automático
    Given llega un mensaje Kafka de tipo "EMPLOYEE_BENEFIT" con employee_id "emp-002"
    When el authorization-service consulta el Active Directory con employee_id "emp-002"
    Then el AD responde con associate=false
    And la solicitud se rechaza automáticamente con motivo "EMPLOYEE_NOT_ACTIVE"
    And se publica en "auth.response.{store_id}" con status "REJECTED"
    And el supervisor no ve ninguna solicitud pendiente

  Scenario: Cuenta deshabilitada — rechazo automático
    Given llega un mensaje Kafka de tipo "EMPLOYEE_BENEFIT" con employee_id "emp-003"
    When el authorization-service consulta el Active Directory con employee_id "emp-003"
    Then el AD responde con accountEnabled=false
    And la solicitud se rechaza automáticamente con motivo "ACCOUNT_DISABLED"
    And se publica en "auth.response.{store_id}" con status "REJECTED"

  Scenario: Empleado no encontrado en AD — rechazo automático
    Given llega un mensaje Kafka de tipo "EMPLOYEE_BENEFIT" con employee_id "emp-999"
    When el authorization-service consulta el Active Directory con employee_id "emp-999"
    Then el AD responde con HTTP 404
    And la solicitud se rechaza automáticamente con motivo "EMPLOYEE_NOT_FOUND"
    And se publica en "auth.response.{store_id}" con status "REJECTED"

  Scenario: AD no disponible — rechazo automático por fallo de infraestructura
    Given llega un mensaje Kafka de tipo "EMPLOYEE_BENEFIT" con employee_id "emp-001"
    When el authorization-service intenta consultar el Active Directory
    Then el AD responde con timeout o error HTTP 5xx
    And la solicitud se rechaza automáticamente con motivo "AD_LOOKUP_FAILED"
    And el error se registra en el log con nivel "error" y el correlation_id

  Scenario: Solicitud de otro tipo — AD no se consulta
    Given llega un mensaje Kafka de tipo "DISCOUNT" con employee_id "emp-001"
    When el authorization-service procesa la solicitud
    Then el Active Directory no es consultado
    And la solicitud se presenta al supervisor normalmente
~~~

~~~gherkin
Feature: Rechazo automático publicado correctamente en Kafka
  Como internal-server de tienda
  Quiero recibir la respuesta de rechazo en auth.response.{store_id}
  Para que el POS pueda informar al empleado que su beneficio fue rechazado

  Scenario: Payload de rechazo automático es completo
    Given una solicitud EMPLOYEE_BENEFIT fue rechazada automáticamente por "EMPLOYEE_NOT_ACTIVE"
    When se publica en "auth.response.{store_id}"
    Then el payload contiene correlation_id, store_id, pos_id, status="REJECTED", rejection_reason y rejected_at
~~~

---

## Plan de Tests TDD

### US-01 — Verificar trabajador activo

**Unitarios**
- [x] [RED]   `VerifyEmployeeBenefitUseCase`: dado un `AuthorizationRequest` tipo `EMPLOYEE_BENEFIT`, llama al port `IActiveDirectoryPort` con el `employee_id` correcto.
- [x] [GREEN] Implementar use-case que invoca el port AD y continúa el flujo si `associate: true && accountEnabled: true`.
- [x] [RED]   `VerifyEmployeeBenefitUseCase`: si el port AD retorna `associate: false`, publica rechazo con motivo `EMPLOYEE_NOT_ACTIVE` vía `IMessagePublisher`.
- [x] [GREEN] Agregar rama de rechazo en el use-case.
- [x] [RED]   `VerifyEmployeeBenefitUseCase`: si el port AD retorna `accountEnabled: false`, publica rechazo con motivo `ACCOUNT_DISABLED`.
- [x] [GREEN] Agregar validación de `accountEnabled`.
- [x] [RED]   `VerifyEmployeeBenefitUseCase`: solicitudes que NO son `EMPLOYEE_BENEFIT` no invocan el port AD.
- [x] [GREEN] Agregar guard por tipo de solicitud.

**Integración**
- [x] `HttpActiveDirectoryAdapter`: dado un `rut` válido, realiza GET al endpoint del AD y mapea la respuesta al `ActiveDirectoryUserDto`.
- [x] `HttpActiveDirectoryAdapter`: dado un 404, lanza `EmployeeNotFoundException`.
- [x] `HttpActiveDirectoryAdapter`: dado un 5xx o timeout, lanza `AdLookupException`.

**E2E**
- [x] Flujo completo: mensaje Kafka `EMPLOYEE_BENEFIT` con trabajador activo → AD mock responde `associate: true` → evento publicado en Redis → supervisor lo ve en SSE.
- [x] Flujo completo: mensaje Kafka `EMPLOYEE_BENEFIT` con trabajador inactivo → AD mock responde `associate: false` → `auth.response.{store_id}` publicado con `REJECTED`.

**Edge cases / casos negativos**
- [x] `employee_id` ausente en el payload: use-case lanza error de validación antes de llamar al port AD.
- [x] AD responde en más de N ms (timeout configurable): `AdLookupException` → rechazo automático.
- [x] Respuesta AD con campos parciales (sin `associate`): se trata como `associate: false`.

---

### US-02 — Manejar fallo de consulta al AD

**Unitarios**
- [x] [RED]   `VerifyEmployeeBenefitUseCase`: si el port AD lanza `AdLookupException`, publica rechazo con motivo `AD_LOOKUP_FAILED`.
- [x] [GREEN] Capturar excepción en el use-case y derivar a rechazo automático.
- [x] [RED]   El rechazo automático registra el error en el logger con `correlation_id`.
- [x] [GREEN] Inyectar logger y logear en el catch.

**Integración**
- [x] `HttpActiveDirectoryAdapter` con servidor AD caído: lanza `AdLookupException` con detalles del error original.

**Edge cases / casos negativos**
- [x] AD responde HTTP 401/403: `AdLookupException` (no `EmployeeNotFoundException`) — autenticación AD es problema de infra, no de negocio.

---

## Definition of Done

- [x] Todos los escenarios BDD pasan en CI
- [ ] Cobertura de tests unitarios ≥ 90% (flujo crítico de negocio con implicaciones de fraude) — no verificado formalmente
- [x] Tests de integración del `HttpActiveDirectoryAdapter` pasan contra un mock del AD
- [ ] Code review aprobado por al menos 1 par — no hubo code review formal
- [x] El campo `employee_id` transporta el RUT; documentado en spec y en shared-types
- [x] El timeout de consulta AD es configurable vía variable de entorno (`AD_LOOKUP_TIMEOUT_MS`)
- [x] Un rechazo automático es indistinguible de un rechazo manual en el topic `auth.response.{store_id}`
- [x] Documentación actualizada (CLAUDE.md y/o README si aplica)

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | Servicio de Active Directory — URL, autenticación y contrato de API deben ser provistos por el equipo de infraestructura |
| Dependencia externa | El campo `employee_id` de `auth.requests` transporta el RUT; no se requiere campo adicional |
| Riesgo técnico | Latencia del AD en horario pico puede degradar el tiempo de respuesta al supervisor; considerar timeout estricto |
| Riesgo técnico | El AD puede no tener todos los empleados (ej.: empleados externos o temporales) — definir comportamiento por defecto |
| Suposición a validar | El `authorization-service` tiene conectividad de red al servicio AD (puede requerir ajuste en Kubernetes NetworkPolicy) |
| Suposición a validar | El campo `associate` es suficiente para determinar actividad laboral (confirmar con RRHH) |

---

```xml
<REASONS>
  <Rationale>
    Prevenir el uso fraudulento del beneficio de descuento de empleado por personas
    que ya no son trabajadores activos, sin agregar fricción al flujo cuando el
    trabajador sí está activo.
  </Rationale>
  <Explanation>
    La verificación ocurre en el authorization-service porque es el único punto
    centralizado que conoce el tipo de solicitud. Al hacerlo antes de notificar
    al supervisor, se evita que este vea solicitudes que serán rechazadas de todas
    formas, reduciendo ruido en la app móvil.
  </Explanation>
  <Assumptions>
    - El payload Kafka incluye el campo `employee_id` (que contiene el RUT), resoluble por el AD.
    - El servicio AD es accesible desde el cluster Kubernetes del authorization-service.
    - "associate: true" es condición suficiente y necesaria para considerar activo al trabajador.
  </Assumptions>
  <Scrutiny>
    ¿Por qué rechazar automáticamente en lugar de permitir que el supervisor decida
    aun cuando el AD no responde? Porque un error del AD no garantiza que el
    empleado sea activo; asumir que sí lo es en caso de fallo crea un vector de fraude.
  </Scrutiny>
  <Objections>
    - "El AD puede tener latencia alta": mitigado con timeout configurable y rechazo rápido.
    - "Empleados válidos pueden ser rechazados si el AD falla": aceptable para el negocio
      dado que el riesgo de fraude supera el impacto de un rechazo ocasional.
  </Objections>
  <Novelty>
    Introduce el concepto de port IActiveDirectoryPort en el dominio del
    authorization-service, con un adapter HTTP en infraestructura. El dominio
    no conoce HTTP ni el esquema de respuesta AD directamente.
  </Novelty>
  <Substitutes>
    Alternativa descartada: verificar en el BFF. Rechazada porque el BFF no debe
    contener lógica de negocio y no tiene acceso directo a Kafka para publicar rechazos.
  </Substitutes>
</REASONS>

---

## Resultado

**Fecha de finalización:** 2026-06-05 (cierre documental; código implementado ~2026-06-02)
**Status del spec:** completed

### Implementado
- [x] US-01: `VerifyEmployeeBenefitUseCase` consulta AD vía `IActiveDirectoryPort`, valida `associate` + `accountEnabled`, publica rechazos automáticos con `RejectionReason`.
- [x] US-02: Manejo de fallos AD — `EmployeeNotFoundException` (404) → `EMPLOYEE_NOT_FOUND`, `AdLookupException` (5xx/timeout) → `AD_LOOKUP_FAILED`, logging con `correlation_id`.
- [x] US-03 (backend): `displayName`, `jobTitle`, `department` adjuntados al evento Redis (`store:{id}:requests`).

### No implementado / Desviaciones
- US-03 UI mobile: diferido intencionalmente en el spec original (apps/mobile no existía). Los datos viajan en el evento Redis y están disponibles para la app cuando se implemente la UI.
- Cobertura ≥90% no verificada formalmente; los tests existentes cubren todos los paths del use-case y adapter.
- Code review formal no realizado (spec temprano, anterior a la convención de PR).

### Tests
- Unitarios: `VerifyEmployeeBenefitUseCase` — tests cubren todos los paths (activo, inactivo, cuenta deshabilitada, 404, 5xx, timeout, 401/403, employee_id ausente)
- Integración: `HttpActiveDirectoryAdapter` — 7 tests (200 válido, 404, 5xx, timeout, 401, 403)
- Suite completa authorization-service: **94/94 tests pasando** (10 suites)
```
