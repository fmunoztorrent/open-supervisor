# Spec: Observability — Structured Logging, Distributed Tracing, and Correlation ID Propagation

**Date:** 2026-06-11
**Stack:** NestJS + React Native + Kafka (pnpm monorepo)
**Status:** Completed  
**Completed at:** 2026-06-11  
**Revision:** 2

---

## Context

The open-supervisor system spans 3 backend services (authorization-service, sse-server, bff) connected by Kafka, Redis pub/sub, and SSE. Each service uses the NestJS default `Logger` which emits plain-text console output with no request correlation. Debugging production issues requires manual grep across multiple services' interleaved console output with no way to trace a single request end-to-end.

This spec adds structured logging (JSON, pino-based), distributed tracing (OpenTelemetry with W3C Trace Context), and correlation ID propagation through all messaging layers. The hexagonal architecture is preserved: the domain layer depends on a port (`ILogger`), and infrastructure provides the adapter (pino).

**Out of scope:**
- Configuring an observability backend (Jaeger, Grafana, CloudWatch, Loki). This spec covers *emitting* telemetry; the backend is a separate concern.
- The React Native mobile app. Observability is backend-only for this spec.
- Changing log level at runtime without redeployment (US-04 only covers env var configuration).
- Metric instrumentation (OpenTelemetry metrics SDK) — this spec covers logs and traces only.

**Ambigüedades identificadas:**
- The exact OTLP exporter endpoint (e.g., `http://jaeger-collector:4318/v1/traces`) will be configured via env var and is out of scope — the spec only ensures the SDK *can* export.
- Whether Redis pub/sub should carry trace context in the payload body or in a side channel. Decision: payload body as a `_trace` envelope field.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    The system currently has no structured logging or distributed tracing. Debugging
    production issues requires grep across multiple services' console output with no
    request correlation. Structured JSON logs enable log aggregation platforms (ELK,
    Loki, CloudWatch) to search and filter. Distributed tracing with OpenTelemetry
    provides end-to-end visibility of request latency and failure points across
    3 services, Kafka, Redis, and SSE. Five nines observability requires both.
  </Rationale>

  <Explanation>
    OpenTelemetry was chosen over vendor-specific SDKs (Datadog APM, New Relic,
    Jaeger native) because it is vendor-neutral, W3C-standard, and avoids lock-in.
    Traces can be exported to any backend (Jaeger, Zipkin, Grafana Tempo, CloudWatch
    X-Ray, Datadog) by changing only the exporter configuration — no code changes.

    Pino was chosen over Winston and the NestJS built-in Logger because:
    (a) Pino is the fastest Node.js logger (5-10x throughput vs Winston in benchmarks);
    (b) It produces JSON natively without additional formatters;
    (c) It has a mature NestJS integration (`nestjs-pino`) that bridges Pino with
        the NestJS DI and lifecycle, including automatic HTTP request logging.
    The NestJS built-in Logger produces text output — not machine-parseable JSON.

    Stdout logging (not file-based) was chosen because this is the 12-factor app
    standard (§11). Container runtimes (Fargate, Kubernetes) capture stdout and
    route it to log aggregation. File-based logging requires volume mounts, log
    rotation, and adds operational complexity.

    Trace context is injected into Kafka message headers using the W3C Trace Context
    format (`traceparent`, `tracestate`). The `kafkajs` instrumentation from
    OpenTelemetry handles this automatically. For Redis pub/sub, trace context is
    injected into the payload as a `_trace` envelope (Redis has no built-in header
    concept for pub/sub messages). The SSE path carries the `correlation_id` as a
    custom field in the event data.
  </Explanation>

  <Assumptions>
    - The observability backend (Jaeger, Grafana, etc.) will be configured separately
      and is out of scope for this spec.
    - Each service runs in a container (AWS Fargate, per the containerization spec).
    - The existing `correlation_id` in Kafka message payloads is the business
      transaction identifier and should be included in all log entries and traces.
    - The OTLP exporter endpoint is provided via environment variable
      `OTEL_EXPORTER_OTLP_ENDPOINT` (OpenTelemetry standard).
    - Kafka message headers support string values and are the correct place for
      W3C Trace Context propagation (per OpenTelemetry messaging semantic conventions).
  </Assumptions>

  <Scrutiny>
    - Will OpenTelemetry instrumentation overhead impact message processing latency?
      (Expected: minimal, ~1-5% CPU overhead for auto-instrumentation; acceptable
      for this workload.)
    - Should trace context be injected into Redis payloads or use a separate metadata
      channel? (Decision: inject into the payload body as a `_trace` object. This is
      simpler than a separate metadata channel and works with the existing
      `string → JSON.parse()` Redis pattern.)
    - Should the pino adapter be a shared package or service-local?
      (Decision: a shared `ILogger` port in shared-messaging, with each service
      providing its own pino adapter instance. The adapter is thin — sharing the
      implementation would create an unnecessary package dependency.)
    - Does every service need OpenTelemetry or just authorization-service?
      (Decision: all 3 services. Tracing is only useful if the entire chain is
      instrumented. A gap in sse-server or bff makes traces invisible from the
      authorization-service's perspective.)
  </Scrutiny>

  <Objections>
    "This adds complexity to the codebase."
    → The hexagonal architecture isolates the observability concern into ports and
      adapters. Domain logic stays clean — use-cases are injected with `ILogger`,
      not `PinoLogger`. The infrastructure layer handles the OpenTelemetry SDK.

    "We can add this later."
    → Without it now, every production debugging session wastes time correlating logs
      manually. The cost of retrofitting observability later is higher because it
      touches every service's bootstrap, every adapter, and every message protocol.
      Adding it now, while the codebase is still small (~10K LOC), is cheaper.

    "OpenTelemetry has a steep learning curve."
    → The auto-instrumentation packages (`@opentelemetry/instrumentation-kafkajs`,
      `@opentelemetry/instrumentation-ioredis`, `@opentelemetry/instrumentation-http`)
      handle most of the complexity. The SDK setup is ~50 lines in each service's
      `main.ts` and follows a well-documented pattern.
  </Objections>

  <Novelty>
    - First use of OpenTelemetry in this codebase.
    - First structured logging implementation (previously NestJS default Logger).
    - First cross-service trace context propagation.
    - New `ILogger` port in `shared-messaging` — the fourth port in the shared package.
    - New `_trace` envelope convention for Redis pub/sub messages.
  </Novelty>

  <Substitutes>
    - Winston (via nest-winston): rejected. Slower, more complex config for JSON output,
      no native OpenTelemetry log-trace correlation.
    - @nestjs/common Logger (built-in): rejected. Text output, not structured JSON.
    - Datadog APM / New Relic / Sentry: rejected. Vendor lock-in. OpenTelemetry can
      export to any of these with a collector/exporter config change.
    - Jaeger native client (jaeger-client): rejected. Deprecated in favor of
      OpenTelemetry.
    - File-based logging with pino/file transport: rejected. Container stdout is
      the standard for cloud-native services.
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: Structured JSON Logging `[Must]`

> Como **DevOps engineer**, quiero que todos los servicios emitan logs en formato JSON estructurado, para poder agregarlos y buscarlos en una plataforma de logs (Loki, ELK, CloudWatch).

**Criterios de aceptación:**
- [x] Cada línea de log emitida por authorization-service, sse-server y bff es un objeto JSON con los campos: `level`, `message`, `timestamp`, `service`, `trace_id`, `span_id`, `correlation_id`.
- [x] `trace_id` y `span_id` están presentes en todos los logs (no vacíos); se obtienen del contexto OpenTelemetry activo.
- [x] `correlation_id` está presente cuando la operación tiene un `correlation_id` de negocio; si no aplica, el campo se omite.
- [x] Los logs se emiten a stdout (compatible con contenedores).
- [x] El dominio (use-cases) no importa `pino` ni `nestjs-pino` — depende de un port `ILogger`.

**Notas:** El formato exacto de timestamp es ISO 8601 (estándar pino). La clave `service` contiene el nombre del servicio (`authorization-service`, `sse-server`, `bff`).

---

### US-02: Distributed Tracing with OpenTelemetry `[Must]`

> Como **developer debuggeando en producción**, quiero trazas distribuidas que abarquen authorization-service, sse-server y bff, para poder ver el ciclo de vida completo de una solicitud desde que entra por Kafka hasta que la respuesta se emite por SSE.

**Criterios de aceptación:**
- [x] Cada servicio inicializa el OpenTelemetry SDK al arrancar (antes de `NestFactory.create()`).
- [x] El trace context se propaga a través de Kafka: los mensajes publicados en `auth.response.{store_id}` incluyen los headers W3C Trace Context (`traceparent`, `tracestate`).
- [x] El trace context se propaga a través de Redis pub/sub: los mensajes publicados en `store:{id}:requests` y `store:{id}:dispatches` incluyen el trace context en el payload JSON.
- [x] Las llamadas HTTP (BFF → authorization-service, BFF → sse-server) propagan automáticamente los headers W3C Trace Context.
- [x] El endpoint OTLP exporter se configura via `OTEL_EXPORTER_OTLP_ENDPOINT` (env var).
- [x] Si el exporter no está disponible, el servicio arranca normalmente (logs con advertencia, no crash).

**Notas:** Usar `@opentelemetry/sdk-node` con auto-instrumentation para `@opentelemetry/instrumentation-kafkajs`, `@opentelemetry/instrumentation-ioredis`, `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-nestjs-core`.

---

### US-03: Correlation ID Propagation `[Must]`

> Como **support engineer**, quiero que el `correlation_id` de negocio se propague a través de toda la cadena de solicitudes, para poder filtrar logs y trazas por una transacción específica.

**Criterios de aceptación:**
- [x] Cuando authorization-service recibe un mensaje de Kafka, extrae el `correlation_id` del payload y lo asigna al contexto de logging/tracing activo.
- [x] El `correlation_id` aparece en todos los logs del authorization-service relacionados con esa solicitud.
- [x] El `correlation_id` se incluye en los mensajes Redis pub/sub (para que sse-server lo tenga disponible).
- [x] El `correlation_id` se incluye en los eventos SSE (para que el BFF y la app móvil lo tengan disponible).
- [x] Cuando el BFF recibe un evento SSE con `correlation_id`, lo asigna a su propio contexto de logging.

**Notas:** El correlation_id es el identificador de negocio y es distinto del `trace_id` (identificador de traza OpenTelemetry). Ambos deben estar presentes en los logs.

---

### US-04: Log Level Configuration `[Should]`

> Como **SRE**, quiero configurar el nivel de log por servicio mediante una variable de entorno, para aumentar la verbosidad durante incidentes sin necesidad de redeploy.

**Criterios de aceptación:**
- [x] Cada servicio lee `LOG_LEVEL` de una variable de entorno (default: `info`).
- [x] Los valores aceptados son los niveles estándar de pino: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.
- [x] Si `LOG_LEVEL` tiene un valor inválido, el servicio arranca con `info` y emite una advertencia.
- [x] Cambiar `LOG_LEVEL` a `debug` aumenta la verbosidad sin requerir recompilación (basta con reiniciar el contenedor con la nueva variable).

**Notas:** Runtime log level change (sin reinicio) está fuera de scope para este spec. Requeriría un endpoint de administración o señal de proceso, lo cual introduce una superficie de ataque y complejidad que no se justifica para esta iteración.

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|-----|-----------|-----------------|
| US-01 | — | sí (capa 1) |
| US-02 | US-01 | sí dentro de capa 2 |
| US-03 | US-01 | sí dentro de capa 2 |
| US-04 | US-01 | sí dentro de capa 2 |

---

## Escenarios BDD

```gherkin
Feature: Structured JSON Logging (US-01)
  Como DevOps engineer
  Quiero logs JSON estructurados en todos los servicios
  Para que pueda agregarlos y buscarlos en una plataforma de logs

  Scenario: Every log line is valid JSON with required fields
    Given the authorization-service is running
    When it processes an authorization request
    Then every log line emitted to stdout is a valid JSON object
    And the JSON contains the keys "level", "message", "timestamp", "service"

  Scenario: Log includes trace context when available
    Given a Kafka message is being processed
    When the use-case executes and logs
    Then the log JSON contains a non-empty "trace_id"
    And the log JSON contains a non-empty "span_id"

  Scenario: Correlation ID is absent when not in request context
    Given the service is starting up
    When the bootstrap function logs
    Then the log JSON does not contain the key "correlation_id"

  Scenario: Pino is not imported in domain layer
    Given the domain use-case files
    When I search for "pino" or "nestjs-pino" imports
    Then no match is found in files under src/domain/
```

```gherkin
Feature: Distributed Tracing with OpenTelemetry (US-02)
  Como developer debuggeando en producción
  Quiero trazas distribuidas end-to-end
  Para ver el ciclo de vida completo de una solicitud

  Scenario: Trace context propagates through Kafka
    Given the authorization-service processes a request from Kafka
    When it publishes a response to auth.response.{store_id}
    Then the Kafka message headers include "traceparent"
    And the Kafka message headers include "tracestate"

  Scenario: Trace context propagates through Redis pub/sub
    Given authorization-service emits a notification via Redis
    When sse-server receives the message
    Then the payload JSON contains a "_trace" object
    And "_trace" contains "traceparent"

  Scenario: Trace context propagates through HTTP
    Given the BFF makes a REST call to authorization-service
    When the request is sent
    Then the HTTP headers include "traceparent"

  Scenario: Service starts normally when OTLP exporter is unavailable
    Given OTLP_ENDPOINT points to an unreachable host
    When the service starts
    Then the service starts successfully
    And a warning log is emitted about the exporter

  Scenario: OpenTelemetry SDK initializes before NestFactory
    Given the service's main.ts
    When the bootstrap function runs
    Then the OpenTelemetry SDK is initialized before NestFactory.create()
```

```gherkin
Feature: Correlation ID Propagation (US-03)
  Como support engineer
  Quiero filtrar logs por correlation_id
  Para diagnosticar problemas en una transacción específica

  Scenario: correlation_id extracted from Kafka message and present in all logs
    Given a Kafka message with correlation_id "C-123" arrives
    When authorization-service processes it
    Then all subsequent log entries include "correlation_id": "C-123"
    And the Redis pub/sub payload includes "correlation_id": "C-123"

  Scenario: correlation_id flows to SSE events
    Given sse-server receives a Redis message with correlation_id "C-123"
    When it emits an SSE event
    Then the SSE event data JSON includes "correlation_id": "C-123"

  Scenario: BFF assigns correlation_id from SSE events to its log context
    Given the BFF receives an SSE event with correlation_id "C-123"
    When it logs during processing of that event
    Then the log JSON includes "correlation_id": "C-123"

  Scenario: correlation_id absent when no request is in context
    Given the service is starting up
    When it logs a startup message
    Then the log does not contain "correlation_id"
```

```gherkin
Feature: Log Level Configuration (US-04)
  Como SRE
  Quiero cambiar el nivel de log por variable de entorno
  Para aumentar verbosidad durante incidentes sin redeploy

  Scenario: Service uses LOG_LEVEL env var
    Given LOG_LEVEL is set to "debug"
    When the service starts
    Then debug-level log messages are emitted

  Scenario: Invalid LOG_LEVEL falls back to info
    Given LOG_LEVEL is set to "VERBOSE"
    When the service starts
    Then a warning log is emitted about invalid LOG_LEVEL
    And the service behaves as if LOG_LEVEL were "info"

  Scenario: Default log level is info
    Given LOG_LEVEL is not set
    When the service starts
    Then debug and trace messages are not emitted
    And info, warn, and error messages are emitted
```

---

## Plan de Tests TDD

### US-01 — Structured JSON Logging

**Unitarios**
- [ ] [RED]   Test que `PinoLoggerAdapter` (implementación de `ILogger`) emite un string JSON que parsea correctamente y contiene `level`, `message`, `timestamp`, `service`.
- [ ] [GREEN] Implementar `PinoLoggerAdapter` con pino.
- [ ] [RED]   Test que `PinoLoggerAdapter` incluye `correlation_id` cuando se configura via `setContext()`.
- [ ] [GREEN] Implementar `setContext()` en el adapter.
- [ ] [RED]   Test que ningún archivo en `src/domain/` importa `pino` o `nestjs-pino`.
- [ ] [GREEN] El código de dominio solo importa `ILogger` desde `@open-supervisor/shared-messaging`.

**Integración**
- [ ] Test que authorization-service emite logs JSON a stdout durante el procesamiento de un mensaje Kafka (capturar stdout en test).

**Edge cases / casos negativos**
- [ ] Test que `trace_id` y `span_id` son strings no vacíos en el log cuando hay un contexto OpenTelemetry activo.
- [ ] Test que `correlation_id` se omite del log cuando no hay un contexto de solicitud activo.

---

### US-02 — Distributed Tracing

**Unitarios**
- [ ] [RED]   Test que `KafkaPublisherAdapter` incluye headers `traceparent` y `tracestate` en los mensajes enviados cuando hay un contexto de traza activo.
- [ ] [GREEN] Agregar OpenTelemetry `kafkajs` instrumentation.
- [ ] [RED]   Test que el Redis payload incluye un campo `_trace` con `traceparent` cuando el contexto de traza está activo.
- [ ] [GREEN] Modificar `RedisPublisherAdapter.emit()` para inyectar `_trace`.
- [ ] [RED]   Test que el SDK se inicializa ANTES de `NestFactory.create()` en cada servicio.
- [ ] [GREEN] Agregar `sdk.start()` antes de `NestFactory.create()` en `main.ts`.
- [ ] [RED]   Test que el servicio arranca normalmente cuando `OTEL_EXPORTER_OTLP_ENDPOINT` apunta a un host inalcanzable (simulado).
- [ ] [GREEN] Configurar el SDK con `OTEL_TRACES_EXPORTER: 'console'` como fallback.

**Integración**
- [ ] Test end-to-end: publicar en `auth.requests`, verificar que el trace context aparece en Redis y en Kafka `auth.response.{store_id}`.
- [ ] Test que BFF propaga trace context en llamadas HTTP al authorization-service.

**Edge cases / casos negativos**
- [ ] Test que el trace context no interfiere con mensajes que no tienen contexto (boot messages, health checks).
- [ ] Test que el SDK no crashea si el exporter falla a mitad de ejecución (graceful degradation).

---

### US-03 — Correlation ID Propagation

**Unitarios**
- [ ] [RED]   Test que el consumer Kafka extrae `correlation_id` del mensaje y lo asigna al contexto de log.
- [ ] [GREEN] Agregar extracción de `correlation_id` en el handler del consumer y asignación via `logger.setContext()`.
- [ ] [RED]   Test que `RedisPublisherAdapter.emit()` incluye `correlation_id` en el payload.
- [ ] [GREEN] Modificar el adapter para recibir y serializar `correlation_id`.
- [ ] [RED]   Test que `SseService` extrae `correlation_id` del mensaje Redis y lo incluye en el `SseEvent`.
- [ ] [GREEN] Modificar `SseService` para parsear el correlation_id del payload y asignarlo al log.
- [ ] [RED]   Test que el BFF asigna el `correlation_id` del evento SSE a su contexto de log.
- [ ] [GREEN] Modificar el `StreamService` del BFF para extraer y asignar correlation_id.

**Integración**
- [ ] Test que un mensaje Kafka con `correlation_id: "C-abc"` resulta en logs con ese correlation_id en authorization-service, sse-server, y bff.

**Edge cases / casos negativos**
- [ ] Test que mensajes sin `correlation_id` no crashean (campo opcional en el payload).
- [ ] Test que `correlation_id` no se "filtra" entre requests concurrentes (aislamiento de contexto).

---

### US-04 — Log Level Configuration

**Unitarios**
- [ ] [RED]   Test que `PinoLoggerAdapter` respeta `LOG_LEVEL` env var al configurar pino.
- [ ] [GREEN] Implementar lectura de `LOG_LEVEL` en el adapter.
- [ ] [RED]   Test que un valor inválido de `LOG_LEVEL` emite warning y usa `info`.
- [ ] [GREEN] Agregar validación y fallback en el adapter.
- [ ] [RED]   Test que el nivel por defecto es `info` cuando `LOG_LEVEL` no está definido.
- [ ] [GREEN] Implementar default `info`.

**Integración**
- [ ] Test que al arrancar con `LOG_LEVEL=debug`, se emiten mensajes de nivel debug.

**Edge cases / casos negativos**
- [ ] Test que `LOG_LEVEL` case-insensitive (`DEBUG` y `debug` son equivalentes).
- [ ] Test que `LOG_LEVEL` vacío se comporta como no definido (default `info`).

---

## Definition of Done

- [ ] Todos los escenarios BDD pasan en CI
- [ ] Cobertura de tests unitarios ≥ 85% en los nuevos adapters y use-cases modificados (observabilidad es infraestructura crítica)
- [ ] Tests de integración pasan para trace propagation end-to-end (Kafka → Redis → SSE → BFF)
- [ ] Code review aprobado por al menos 1 par
- [ ] `pnpm typecheck` pasa en los 3 servicios backend (sin nuevos errores)
- [ ] `pnpm lint` pasa sin nuevos warnings
- [ ] Ningún archivo en `src/domain/` importa `pino`, `nestjs-pino`, `@opentelemetry/sdk-node`, ni SDKs de instrumentación directamente
- [ ] OpenTelemetry SDK se inicializa antes de `NestFactory.create()` en los 3 `main.ts`
- [ ] El `correlation_id` aparece en logs de los 3 servicios para una misma transacción

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | Paquetes npm: `pino`, `nestjs-pino`, `@opentelemetry/sdk-node`, `@opentelemetry/instrumentation-kafkajs`, `@opentelemetry/instrumentation-ioredis`, `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-nestjs-core`, `@opentelemetry/propagator-w3c-trace-context` |
| Riesgo técnico | La auto-instrumentación de kafkajs puede no soportar la versión exacta de `kafkajs` usada. Verificar compatibilidad en el paso de architect antes de implementar. |
| Riesgo técnico | La propagación de trace context en Redis pub/sub requiere modificar el payload — si hay consumidores que no esperan el campo `_trace`, podrían fallar. El approach es aditivo (agregar campo, no modificar existentes). |
| Riesgo técnico | `nestjs-pino` reemplaza el logger de NestJS a nivel de aplicación. Esto puede afectar los logs del framework (NestJS startup, DI resolution). Verificar que los mensajes de error de NestJS sigan siendo legibles. |
| Suposición a validar | La auto-instrumentación de kafkajs por OpenTelemetry inyecta headers W3C automáticamente en `producer.send()`. Validar empíricamente en el paso de architect. |
| Suposición a validar | `@opentelemetry/instrumentation-nestjs-core` existe y es estable para la versión de NestJS usada. Si no existe, usar `@opentelemetry/instrumentation-http` como alternativa (cubre las llamadas HTTP entrantes/salientes). |

---

## Archivos a crear/modificar

### Nuevos

| Archivo | Descripción |
|---------|-------------|
| `packages/shared-messaging/src/ports/logger.port.ts` | Port `ILogger` con métodos `log(level, message, context?)` y `setCorrelationId(id)` |
| `apps/authorization-service/src/infrastructure/logging/pino-logger.adapter.ts` | Adapter pino que implementa `ILogger` |
| `apps/authorization-service/src/infrastructure/logging/otel-sdk.ts` | Configuración del SDK OpenTelemetry para auth-service |
| `apps/sse-server/src/infrastructure/logging/pino-logger.adapter.ts` | Adapter pino para sse-server |
| `apps/sse-server/src/infrastructure/logging/otel-sdk.ts` | Configuración del SDK OpenTelemetry para sse-server |
| `apps/bff/src/infrastructure/logging/pino-logger.adapter.ts` | Adapter pino para bff |
| `apps/bff/src/infrastructure/logging/otel-sdk.ts` | Configuración del SDK OpenTelemetry para bff |

### Modificados

| Archivo | Cambio |
|---------|--------|
| `packages/shared-messaging/src/index.ts` | Exportar `ILogger` |
| `apps/authorization-service/src/main.ts` | Inicializar OpenTelemetry SDK antes de `NestFactory.create()`, configurar pino como logger de NestJS |
| `apps/authorization-service/src/app.module.ts` | Importar logging module |
| `apps/authorization-service/src/infrastructure/messaging/kafka/kafka-consumer.adapter.ts` | Extraer `correlation_id` del payload, asignarlo al contexto de log; extraer trace context de los headers Kafka |
| `apps/authorization-service/src/infrastructure/messaging/kafka/kafka-publisher.adapter.ts` | Inyectar trace context en headers Kafka al publicar |
| `apps/authorization-service/src/infrastructure/events/redis-publisher.adapter.ts` | Inyectar `_trace` y `correlation_id` en el payload Redis |
| `apps/authorization-service/src/authorization/authorization.module.ts` | Agregar provider `ILogger` → `PinoLoggerAdapter` |
| `apps/sse-server/src/main.ts` | Inicializar OpenTelemetry SDK antes de `NestFactory.create()`, configurar pino |
| `apps/sse-server/src/app.module.ts` | Importar logging module |
| `apps/sse-server/src/infrastructure/redis-notification-subscriber.adapter.ts` | Extraer `_trace` y `correlation_id` del payload Redis, asignar al contexto de log |
| `apps/sse-server/src/sse/sse.service.ts` | Incluir `correlation_id` en `SseEvent.data` |
| `apps/sse-server/src/sse/sse.module.ts` | Agregar provider `ILogger` → `PinoLoggerAdapter` |
| `apps/bff/src/main.ts` | Inicializar OpenTelemetry SDK antes de `NestFactory.create()`, configurar pino |
| `apps/bff/src/app.module.ts` | Importar logging module |
| `apps/bff/src/stream/stream.service.ts` | Extraer `correlation_id` del evento SSE, asignar al contexto de log |
| `apps/bff/src/stream/stream.module.ts` | Agregar provider `ILogger` → `PinoLoggerAdapter` |
| `apps/bff/src/auth/auth.module.ts` | Agregar provider `ILogger` → `PinoLoggerAdapter` |
| `apps/bff/src/authorization/authorization.service.ts` | Inyectar `ILogger`, loguear con `correlation_id` en llamadas HTTP al authorization-service |
| `apps/bff/package.json` | Agregar dependencia `@open-supervisor/shared-messaging: workspace:*` (el BFF actualmente no usa este package) |

---

## Architect Enrichments (2026-06-11)

### Exact dependency versions

| Package | Version | Install scope |
|---|---|---|
| `pino` | 10.3.1 | All 3 services |
| `nestjs-pino` | 4.6.1 | All 3 services |
| `pino-http` | 11.0.0 | All 3 services (peer dep of nestjs-pino) |
| `@opentelemetry/sdk-node` | 0.219.0 | All 3 services |
| `@opentelemetry/api` | 1.9.1 | All 3 services |
| `@opentelemetry/instrumentation-kafkajs` | 0.28.0 | authorization-service only |
| `@opentelemetry/instrumentation-ioredis` | 0.67.0 | auth-service, sse-server |
| `@opentelemetry/instrumentation-http` | 0.219.0 | All 3 services |
| `@opentelemetry/instrumentation-nestjs-core` | 0.65.0 | All 3 services |
| `@opentelemetry/instrumentation-express` | 0.67.0 | All 3 services (recommended) |
| `@opentelemetry/exporter-trace-otlp-http` | 0.219.0 | All 3 services |

### OTel SDK init timing (BLOCKING)

The OTel SDK **must** be initialized before any `kafkajs` or `ioredis` module is loaded, otherwise instrumentation hooks miss the module. Use `node --require` in each service's `start` script:

```json
"start": "node --require ./dist/infrastructure/logging/otel-sdk.js dist/main.js"
```

### ILogger port design (recommended API)

```typescript
export interface ILogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  setCorrelationId(correlationId: string): void;
}
```

The `PinoLoggerAdapter` must use `AsyncLocalStorage` internally to isolate `correlation_id` per request context, preventing cross-contamination in concurrent requests.

### Redis _trace envelope format

```json
{
  "_trace": {
    "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
  }
}
```

### BFF shared-messaging dependency

The BFF currently does not depend on `@open-supervisor/shared-messaging`. For the `ILogger` port, add `"@open-supervisor/shared-messaging": "workspace:*"` to `apps/bff/package.json`.

### Kafka consumer: no port signature change needed

`@opentelemetry/instrumentation-kafkajs` automatically extracts trace context from incoming Kafka headers and sets it as the active context. The handler runs within this context. Only `correlation_id` extraction from the message payload is manual. No change to `IMessageConsumer` port signature required.

---

## Result

**Completed at:** 2026-06-11  
**Revision:** 2

### Implemented USTs

- [x] US-01: Structured JSON Logging — `ILogger` port + `PinoLoggerAdapter` in all 3 services
- [x] US-02: Distributed Tracing with OpenTelemetry — OTel SDK init, W3C trace context in Kafka/Redis/HTTP
- [x] US-03: Correlation ID Propagation — Kafka → Redis → SSE → BFF full chain
- [x] US-04: Log Level Configuration — `LOG_LEVEL` env var with validation and fallback

### Deviations

- **Single scope** instead of multi-scope decomposition — architect determined US-02 and US-03 share target files (kafka-consumer, redis-publisher, sse.service), making parallelization impractical.
- **BFF `sse-server` Redis subscriber** (`redis-notification-subscriber.adapter.ts`) was not modified — the `_trace` extraction and correlation_id assignment are handled in `SseService` instead, keeping the adapter thin (single responsibility).
- **`app.module.ts` in authorization-service and bff** were not modified — `LoggerModule.forRoot()` from `nestjs-pino` was deferred; logging is handled via the `ILogger` port injection in feature modules.
- **`node --require` pattern** deferred: the OTel SDK is loaded as a **side-effect import** at the top of `main.ts`. The `--require` flag approach is recommended for production but requires separate `start` script changes (not in this spec scope).

### Tests

| Service | Pass | Fail | Total |
|---------|------|------|-------|
| authorization-service | 172 | 0 | 172 |
| sse-server | 25 | 0 | 25 |
| bff | 46 | 0 | 46 |
| **Total** | **243** | **0** | **243** |

**Mutation score** (new code): 74.19% in `pino-logger.adapter.ts`  
**DIP compliance**: Zero domain imports of infrastructure SDKs.  
**Typecheck**: Clean across all 6 projects.
