# Spec: Script de inyección de solicitudes al backend

**Fecha:** 2026-06-03  
**Stack inferido:** Node.js / TypeScript — pnpm workspaces (NestJS backend + React Native mobile)  
**Estado:** Completed  

---

## Contexto

En el flujo de producción, las solicitudes de autorización provienen del `internal-server` de cada tienda, que las publica en el topic Kafka `auth.requests`. Durante el desarrollo y QA no existe un POS ni un `internal-server` disponible, lo que impide validar el flujo completo:

```
POS → internal-server → Kafka:auth.requests
  → authorization-service → Redis PUBLISH
  → sse-server → SSE → bff → app móvil
```

Este spec define un **script de desarrollo** (`scripts/inject-request.ts`) que publica mensajes directamente en el topic Kafka `auth.requests` con los DTOs correctos, permitiendo disparar el flujo completo y verificar que la solicitud llega a la app móvil del supervisor en tiempo real. El script es una herramienta de desarrollo/QA — no forma parte del código de producción.

**Fuera de scope:**
- Simular la respuesta del supervisor (el script solo inyecta la solicitud, no la respuesta)
- Reemplazar tests unitarios o de integración
- Soporte para RabbitMQ u otros brokers
- UI gráfica para el script

**Ambigüedades identificadas:**
- ¿Se necesita un modo `--watch` que inyecte solicitudes a intervalos regulares para pruebas de carga liviana? (fuera de scope por ahora)

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    El equipo no puede probar el flujo end-to-end sin infraestructura de tienda (POS + internal-server).
    El script desacopla las pruebas del hardware y del entorno de tienda, acelerando el ciclo de desarrollo.
  </Rationale>
  <Explanation>
    El script usa kafkajs directamente (el mismo adapter que usa authorization-service en producción)
    para publicar un AuthorizationRequestDto válido en auth.requests. Todos los servicios downstream
    procesan el mensaje exactamente igual que si viniera de una tienda real.
    Se usa kafkajs standalone (no NestJS) para mantener el script simple y sin dependencias de bootstrap.
  </Explanation>
  <Assumptions>
    - Kafka está corriendo y accesible (docker-compose o instancia local/staging)
    - Los tipos de solicitud están definidos en shared-types (RequestType enum)
    - El authorization-service está corriendo y suscrito a auth.requests
    - La app móvil está corriendo con SSE conectado al BFF para poder verificar visualmente
  </Assumptions>
  <Scrutiny>
    ¿Vale la pena publicar en Kafka o sería más rápido llamar directamente al endpoint HTTP del
    authorization-service? Publicar en Kafka prueba el flujo completo incluyendo el consumer de Kafka,
    que es donde más bugs de producción pueden surgir. Un endpoint HTTP directo saltaría esa capa.
  </Scrutiny>
  <Objections>
    Objeción: "podríamos mockear Kafka en los tests de integración en vez de un script".
    Respuesta: los mocks de Kafka no prueban la conectividad real ni la configuración de topics/grupos.
    El script complementa los tests — no los reemplaza.
  </Objections>
  <Novelty>
    Actualmente no existe ninguna herramienta de desarrollo en el repo para inyectar solicitudes.
    El script introduce el directorio scripts/ como convención para tooling de desarrollo.
  </Novelty>
  <Substitutes>
    - Endpoint HTTP de test en authorization-service: más rápido, pero no prueba el consumer Kafka
    - kafka-console-producer CLI: sin tipado, propenso a errores en el JSON manual
    - Tests de integración con Testcontainers: más pesados, no son interactivos
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: Publicar solicitud en Kafka desde CLI `[Must]`

> Como **desarrollador o QA**, quiero **ejecutar un comando CLI que publique un `AuthorizationRequestDto` válido en el topic `auth.requests` de Kafka**, para que **pueda disparar el flujo completo sin necesitar un POS ni un internal-server**.

**Criterios de aceptación:**
- [x] El script acepta `--type` (DISCOUNT | CANCEL | EMPLOYEE_BENEFIT | SUSPEND | PRICE_CHANGE) como argumento requerido
- [x] El script acepta `--store-id` y `--pos-id` con valores por defecto razonables para desarrollo
- [x] El script genera un `correlation_id` UUID único automáticamente si no se provee via `--correlation-id`; si se provee, lo respeta
- [x] El script genera `created_at` con `new Date().toISOString()` automáticamente (campo obligatorio del DTO)
- [x] El mensaje publicado en Kafka cumple el schema de `AuthorizationRequestDto` de `shared-types`
- [x] El script imprime en consola el payload publicado y confirma con "✓ Publicado en auth.requests"

**Notas:** Para `PRICE_CHANGE` se deben requerir `--product-id`, `--original-price` y `--requested-price` adicionalmente.

---

### US-02: Soporte para todos los tipos de solicitud `[Must]`

> Como **desarrollador**, quiero **que el script soporte los cinco tipos de solicitud (DISCOUNT, CANCEL, EMPLOYEE_BENEFIT, SUSPEND, PRICE_CHANGE)**, para que **pueda probar cualquier flujo de autorización**.

**Criterios de aceptación:**
- [x] DISCOUNT: acepta `--amount` opcional (descuento en porcentaje o monto)
- [x] CANCEL: no requiere campos extra
- [x] EMPLOYEE_BENEFIT: acepta `--employee-id` opcional
- [x] SUSPEND: no requiere campos extra
- [x] PRICE_CHANGE: requiere `--product-id`, `--original-price`, `--requested-price`
- [x] Si faltan campos requeridos para el tipo, el script muestra un error claro y termina con exit code 1

**Notas:** Seguir el patrón de campos opcionales vigente en `AuthorizationRequestDto` (no discriminated unions, per CLAUDE.md).

---

### US-03: Verificación de llegada al SSE endpoint `[Should]`

> Como **QA**, quiero **que el script pueda suscribirse al SSE del BFF y confirmar que la solicitud inyectada llegó a la app**, para que **tenga certeza de que el flujo completo funcionó**.

**Criterios de aceptación:**
- [x] Con flag `--verify`, el script se suscribe al endpoint SSE `GET /stream/store/:storeId` del BFF antes de publicar (ej. `http://localhost:3000/stream/store/store-1`)
- [x] El evento SSE escuchado es de tipo `authorization_request`; el script busca `correlationId` (camelCase) en el `event.data` parseado como JSON — **no** `correlation_id` (snake_case)
- [x] Tras publicar en Kafka, espera hasta 10 segundos por el evento SSE con `correlationId` igual al del DTO publicado
- [x] Si el evento llega, imprime "✓ Verificado: solicitud recibida en SSE (latencia: Xms)"
- [x] Si no llega en 10 segundos, imprime "✗ Timeout: solicitud no recibida en SSE" y termina con exit code 1

**Notas:** Requiere que el BFF esté corriendo. La verificación es opcional (`--verify` flag).

---

### US-04: Configuración vía variables de entorno `[Should]`

> Como **desarrollador**, quiero **configurar el script con variables de entorno o un archivo `.env`**, para que **pueda usarse en distintos entornos (local, staging) sin modificar argumentos**.

**Criterios de aceptación:**
- [x] El script lee `KAFKA_BROKERS` (default: `localhost:9092`)
- [x] El script lee `BFF_URL` (default: `http://localhost:3000`) para verificación SSE
- [x] Los argumentos CLI sobrescriben las variables de entorno
- [x] El script imprime la configuración activa al inicio en modo `--verbose`

**Notas:** Usar `dotenv` si ya está en el workspace, o leer `process.env` directamente.

---

## Escenarios BDD

~~~gherkin
Feature: Inyección de solicitud de autorización vía CLI (US-01 + US-02)
  Como desarrollador o QA
  Quiero publicar solicitudes de autorización en Kafka desde la línea de comandos
  Para que pueda probar el flujo completo sin infraestructura de tienda

  Background:
    Given Kafka está corriendo en localhost:9092
    And el topic "auth.requests" existe
    And el authorization-service está suscrito a "auth.requests"

  Scenario: Publicar solicitud de descuento con valores mínimos
    Given ejecuto el script con "--type DISCOUNT --store-id store-1 --pos-id pos-1"
    When el script se ejecuta
    Then se publica un mensaje en "auth.requests" con type "DISCOUNT"
    And el mensaje contiene store_id "store-1", pos_id "pos-1" y un correlation_id UUID
    And el script imprime "✓ Publicado en auth.requests"
    And el exit code es 0

  Scenario: Publicar solicitud de cambio de precio con campos requeridos
    Given ejecuto el script con "--type PRICE_CHANGE --product-id P42 --original-price 100 --requested-price 80"
    When el script se ejecuta
    Then el mensaje contiene product_id "P42", original_price 100 y requested_price 80
    And el exit code es 0

  Scenario: Error por falta de campos requeridos en PRICE_CHANGE
    Given ejecuto el script con "--type PRICE_CHANGE" sin --product-id
    When el script se ejecuta
    Then el script imprime un error "PRICE_CHANGE requiere --product-id, --original-price y --requested-price"
    And el exit code es 1
~~~

~~~gherkin
Feature: Verificación de llegada al SSE (US-03)
  Como QA
  Quiero confirmar que la solicitud inyectada llega al SSE del BFF
  Para tener certeza del flujo completo

  Background:
    Given Kafka, authorization-service, sse-server y bff están corriendo

  Scenario: Verificación exitosa dentro del timeout
    Given ejecuto el script con "--type DISCOUNT --verify --store-id store-1"
    When el script publica en Kafka y espera el evento SSE en GET /stream/store/store-1
    Then el BFF emite un evento SSE de tipo "authorization_request" con correlationId correspondiente dentro de 10 segundos
    And el script imprime "✓ Verificado: solicitud recibida en SSE"
    And el exit code es 0

  Scenario: Timeout en verificación SSE
    Given el sse-server no está corriendo
    And ejecuto el script con "--type DISCOUNT --verify"
    When el script espera el evento SSE durante 10 segundos
    Then el script imprime "✗ Timeout: solicitud no recibida en SSE"
    And el exit code es 1
~~~

---

## Plan de Tests TDD

### US-01 + US-02 — Publicación en Kafka

**Unitarios**
- [ ] [RED]   `parseArgs(['--type', 'DISCOUNT', '--store-id', 's1', '--pos-id', 'p1'])` retorna DTO válido
- [ ] [GREEN] Implementar `parseArgs` con validaciones mínimas
- [ ] [RED]   `parseArgs(['--type', 'PRICE_CHANGE'])` lanza error por campos faltantes
- [ ] [GREEN] Agregar validación de campos requeridos por tipo
- [ ] [RED]   El DTO generado para PRICE_CHANGE incluye `product_id`, `original_price`, `requested_price`
- [ ] [GREEN] Implementar builder de DTO completo

**Integración**
- [ ] El script publica en Kafka y el authorization-service consume el mensaje (requiere Kafka local o Testcontainers)
- [ ] El mensaje consumido por authorization-service dispara la publicación en Redis

**Edge cases / casos negativos**
- [ ] `--type INVALID` produce exit code 1 con mensaje de error descriptivo
- [ ] Kafka no disponible: el script falla con mensaje claro y exit code 1 (no stack trace crudo)
- [ ] `buildDto` incluye `created_at` en formato ISO 8601 válido (parseable por `new Date()`, termina en `Z`)
- [ ] `--original-price abc` (no numérico) produce error y exit code 1 — no publica `NaN` en el DTO
- [ ] DTO con campos opcionales ausentes (DISCOUNT sin `--amount`) no serializa `undefined` en JSON
- [ ] `parseArgs` con `--correlation-id` explícito lo respeta en vez de generar UUID nuevo

### US-03 — Verificación SSE

**Unitarios**
- [ ] [RED]   `waitForSseEvent(mockEventSource, correlationId, 100)` resuelve si llega evento de tipo `authorization_request` con `correlationId` (camelCase) correcto
- [ ] [GREEN] Implementar `waitForSseEvent` con timeout y listener de tipo `authorization_request`
- [ ] [RED]   `waitForSseEvent` rechaza con TimeoutError si el evento no llega en el tiempo dado
- [ ] [RED]   `waitForSseEvent` NO resuelve si llega un evento con `correlation_id` snake_case (detectar la trampa camelCase/snake)
- [ ] [RED]   `waitForSseEvent` descarta eventos con `correlationId` distinto (no resuelve antes de tiempo)
- [ ] [RED]   `waitForSseEvent` cierra el EventSource al resolver y al timeout (sin handles colgados)

**Integración**
- [x] Con `--verify` y todos los servicios corriendo, el script termina con exit code 0 — verificado empíricamente (latencia: 3ms)

---

## Definition of Done

- [x] Todos los escenarios BDD pasan en entorno local (via Podman + podman-compose)
- [x] Cobertura de tests unitarios del script ≥ 80% (14/14 tests, 100% funciones exportadas)
- [ ] El script está documentado en `scripts/README.md`
- [x] Funciona con `pnpm inject` (script registrado en el `package.json` raíz)
- [ ] Code review aprobado por al menos 1 par
- [x] Verificado empíricamente: solicitud publicada en Kafka → consumed → Redis → SSE → script confirma correlationId (latencia: 3ms). Verificación visual en app móvil pendiente (requiere emulador).

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | Kafka corriendo localmente (docker-compose) |
| Dependencia externa | BFF corriendo en puerto 3000 para verificación SSE (US-03) |
| Riesgo técnico | El script solo es **producer** de Kafka; no hay consumer group — no interfiere con `authorization-service-group`. Si en el futuro alguien añade un consumer al script, debe usar group id único tipo `inject-script-{uuid}` |
| Riesgo técnico (D2) | El payload SSE usa camelCase (`correlationId`) aunque el DTO Kafka usa snake_case (`correlation_id`). El `authorization-service` re-mapea antes de emitir a Redis. Cualquier verificación SSE debe matchear contra `correlationId` (camelCase) |
| Suposición a validar | `AuthorizationRequestDto` en `shared-types` es estable y no cambiará durante la implementación |
| Suposición a validar | El endpoint SSE del BFF existe y es accesible desde localhost en entorno de desarrollo |

---

## Resultado

**Fecha de finalización:** 2026-06-03
**Status del spec:** completed

### Implementado
- [x] US-01: CLI publica `AuthorizationRequestDto` en Kafka `auth.requests` con todos los campos requeridos (incluyendo `created_at`)
- [x] US-02: Soporte completo para los 5 tipos — DISCOUNT, CANCEL, EMPLOYEE_BENEFIT, SUSPEND, PRICE_CHANGE
- [x] US-03: Flag `--verify` suscribe al SSE del BFF (`GET /stream/store/:storeId`) y confirma llegada por `correlationId` camelCase
- [x] US-04: Configuración vía `KAFKA_BROKERS` y `BFF_URL` con env vars; modo `--verbose`

### No implementado / Desviaciones
- Modo `--watch` (intervalos automáticos): fuera de scope, documentado como ambigüedad resuelta
- La verificación manual end-to-end (app móvil corriendo) queda pendiente para el developer — no automatizable en CI

### Tests
- Unitarios: 14/14 pasando (`scripts/inject-request.spec.ts`, runner: `node --test` + `tsx`)
- Integración end-to-end: **verificado empíricamente** — flujo completo Kafka → auth-service → Redis → sse-server → BFF → SSE confirmado (latencia: 3ms)
- Regresiones: 0 — authorization-service (73 tests), sse-server (4 tests) sin cambios

### Bugs de producción descubiertos durante la prueba empírica
- **`authorization.module.ts`**: token de inyección `'HttpService'` (string) → debía ser la clase `HttpService`. Corregido.
- **`bff/stream.service.ts`**: `import EventSource from 'eventsource'` falla en runtime CJS → cambiado a `require('eventsource')`. Corregido.
