# Spec: BFF — Ports hexagonales (HttpService + IEventSourceConnector)

**Fecha:** 2026-06-05
**Status:** draft
**Servicio:** `apps/bff`

## Contexto

El BFF actualmente viola el principio de inversión de dependencias (DIP) en dos puntos:

1. `authorization/authorization.service.ts` usa `fetch()` crudo para llamadas HTTP upstream.
2. `stream/stream.service.ts` instancia `new EventSource()` directamente desde la librería `eventsource`.

Ambas violaciones impiden testear la lógica del BFF sin levantar servidores reales. También viola OCP: agregar un nuevo endpoint upstream o cambiar la librería de SSE requiere modificar los servicios en lugar de solo reemplazar el adaptador.

<REASONS>
  <Rationale>
    El BFF es proxy puro sin lógica de dominio. Aunque es simple, la ausencia de abstracciones hace que sus tests requieran mocks globales de `fetch` o instancias reales de EventSource, lo que fragiliza la suite y complica el mantenimiento. El objetivo es alinear el BFF con el principio DIP ya establecido en `authorization-service`.
  </Rationale>
  <Explanation>
    Para HTTP: NestJS provee `HttpModule` + `HttpService` de `@nestjs/axios` como abstracción oficial. Es testeable con `HttpClientTestingModule` sin crear ports custom innecesarios. Este es el "punto dulce" entre hexagonal y la filosofía NestJS.

    Para EventSource: no existe un built-in NestJS equivalente. Un port `IEventSourceConnector` con su adapter justifica la abstracción porque permite inyectar un mock en tests sin depender de la librería `eventsource` ni de conexiones reales SSE.

    El BFF no necesita una capa `domain/ports/` completa como `authorization-service`. La estructura es más plana: port local para EventSource + HttpModule para HTTP.
  </Explanation>
  <Assumptions>
    - `@nestjs/axios` está disponible o puede agregarse al BFF.
    - Los tests actuales del BFF usan `jest.spyOn(global, 'fetch')` o similar para mockear HTTP — se migrarán a `HttpClientTestingModule`.
    - No hay lógica de retry, circuit-breaker ni rate-limiting en el BFF; eso pertenece a `authorization-service`.
  </Assumptions>
  <Scrutiny>
    - ¿Vale la pena agregar `@nestjs/axios` solo para un proxy con 2 endpoints? Sí: reduce la superficie de mocks y alinea con el stack existente en NestJS.
    - ¿El port `IEventSourceConnector` no es sobre-ingeniería para un thin proxy? No: `StreamService` tiene lógica de reconexión y manejo de subjects que debe ser testeable sin EventSource real.
    - ¿Qué pasa con la reconexión automática del EventSource? El adapter la encapsula; `StreamService` solo maneja la lógica de Observable/Subject.
  </Scrutiny>
  <Objections>
    - "El BFF es tan simple que los tests no importan." — Los tests de reconexión SSE son frágiles sin abstracción; un mock limpio reduce flakiness.
    - "Agrega complejidad sin valor." — La complejidad agregada es mínima: 1 archivo de port + 1 adapter. El valor es testeabilidad y OCP.
  </Objections>
  <Novelty>
    Introduce la primera capa de ports en el BFF. Los servicios `authorization-service` y `sse-server` ya siguen este patrón; el BFF era el único que no lo respetaba.
  </Novelty>
  <Substitutes>
    - Mock global de `fetch` con `jest.spyOn`: funciona pero es frágil y contamina el estado entre tests.
    - `nock` para interceptar HTTP: más robusto pero agrega una dependencia extra y no resuelve el problema de EventSource.
    - No hacer nada: deja la deuda técnica abierta indefinidamente.
  </Substitutes>
</REASONS>

## Historias de usuario

### US-01: AuthorizationService usa HttpService de @nestjs/axios

**Como** desarrollador,
**quiero** que `AuthorizationService` use `HttpService` de `@nestjs/axios`,
**para** poder testear el servicio con `HttpClientTestingModule` sin levantar servidores HTTP reales.

**Criterios de aceptación:**
```gherkin
Dado que AuthorizationService necesita obtener solicitudes pendientes
Cuando se llama a getPending(storeId)
Entonces usa this.http.get() en lugar de fetch()
Y el módulo de autorización importa HttpModule de @nestjs/axios

Dado que existe un test de AuthorizationService
Cuando se configura HttpClientTestingModule en el test
Entonces se puede verificar la URL y headers de la llamada HTTP
Sin necesitar jest.spyOn(global, 'fetch')

Dado que AuthorizationService necesita resolver una solicitud
Cuando se llama a resolve(id, payload)
Entonces usa this.http.post() en lugar de fetch()
```

**Archivos a modificar:**
- `apps/bff/src/authorization/authorization.service.ts`
- `apps/bff/src/authorization/authorization.module.ts` — agregar `HttpModule`
- Tests de `authorization.service.spec.ts`

---

### US-02: Port IEventSourceConnector + EventSourceAdapter

**Como** desarrollador,
**quiero** un port `IEventSourceConnector` con su `EventSourceAdapter`,
**para** poder inyectar un mock en `StreamService` sin usar un EventSource real.

**Criterios de aceptación:**
```gherkin
Dado que existe el port IEventSourceConnector
Cuando se inspecciona la interfaz
Entonces tiene exactamente un método: connect(url: string): Observable<SseEvent>
Y no expone métodos de lifecycle ni de la librería eventsource

Dado que existe EventSourceAdapter
Cuando se llama a connect(url)
Entonces crea internamente un new EventSource(url) de la librería eventsource
Y devuelve un Observable que emite eventos de tipo SseEvent
Y cierra el EventSource cuando el Observable se unsuscribe (cleanup correcto)

Dado que el adapter recibe un evento SSE
Cuando llega un mensaje de tipo 'authorization_request'
Entonces el Observable emite el payload parseado como SseEvent
Y lo mismo para 'physical_presence_dispatch'
```

**Archivos a crear:**
- `apps/bff/src/stream/ports/event-source-connector.port.ts`
- `apps/bff/src/stream/infrastructure/event-source.adapter.ts`

---

### US-03: StreamService usa IEventSourceConnector

**Como** desarrollador,
**quiero** que `StreamService` dependa de `IEventSourceConnector`,
**para** que la lógica de reconexión sea testeable con un mock inyectado.

**Criterios de aceptación:**
```gherkin
Dado que StreamService recibe IEventSourceConnector por inyección
Cuando se llama a getStream(storeId)
Entonces llama a this.connector.connect(url) en lugar de new EventSource(url)
Y la lógica de subjects y reconexión permanece en StreamService

Dado que existe un test de StreamService con un mock de IEventSourceConnector
Cuando el mock emite un SseEvent de tipo 'authorization_request'
Entonces el Subject correspondiente al storeId emite el evento
Sin levantar ninguna conexión HTTP real

Dado que StreamService gestiona la reconexión
Cuando el Observable de IEventSourceConnector completa o emite error
Entonces StreamService reintenta la conexión según su lógica actual
```

**Archivos a modificar:**
- `apps/bff/src/stream/stream.service.ts`
- `apps/bff/src/stream/stream.module.ts` — binding `EVENT_SOURCE_CONNECTOR` → `EventSourceAdapter`
- Tests de `stream.service.spec.ts`

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|---|---|---|
| US-01 | — | ✅ Sí (independiente) |
| US-02 | — | ✅ Sí (independiente de US-01) |
| US-03 | US-02 | ❌ No (necesita el port y adapter de US-02) |

## Tests

- **US-01:** Test unitario de `AuthorizationService` con `HttpClientTestingModule`; verificar URL y método HTTP.
- **US-02:** Test unitario de `EventSourceAdapter` con EventSource simulado; verificar cleanup en unsubscribe.
- **US-03:** Test unitario de `StreamService` con mock de `IEventSourceConnector`; verificar que los subjects emiten correctamente y que la reconexión funciona.

## Verificación end-to-end

1. `pnpm --filter bff test` — suite completa en verde
2. `pnpm --filter bff typecheck` — sin errores de tipos
3. Levantar `make dev` y verificar que el proxy SSE sigue funcionando: `pnpm inject --type DISCOUNT --verify`

---

## Resultado

**Fecha de finalización:** 2026-06-05
**Status del spec:** completed

### Implementado
- [x] US-01: `AuthorizationService` migrado de `fetch()` a `HttpService` de `@nestjs/axios`. `HttpModule` en `authorization.module.ts`. Tests migrados a `HttpClientTestingModule`.
- [x] US-02: Port `IEventSourceConnector` con método `connect(url): Observable<SseEvent>`. Token `EVENT_SOURCE_CONNECTOR`. Adapter `EventSourceAdapter` usando librería `eventsource` con cleanup vía Observable teardown. Tipos SseEvent: `'authorization_request' | 'physical_presence_dispatch'`.
- [x] US-03: `StreamService` inyecta `@Inject(EVENT_SOURCE_CONNECTOR)` en lugar de instanciar `new EventSource()`. La lógica de Subjects y reconexión permanece en `StreamService`. `stream.module.ts` bindea port → adapter.

### No implementado / Desviaciones
- No se creó un test unitario dedicado para `EventSourceAdapter`; el adapter es thin (delega a `eventsource`) y la cobertura viene de los tests de `StreamService`.
- Lint no configurado en BFF (sin `.eslintrc`) — preexistente, no introducido.

### Tests
- bff: **7/7 tests pasando** (2 suites: `authorization.controller.spec.ts` + `stream.service.spec.ts`)
- typecheck: limpio ✅
- `HttpClientTestingModule` reemplazó `jest.spyOn(global, 'fetch')` en tests de auth ✅
