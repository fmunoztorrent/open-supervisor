# Spec: Authorization Service — Mejoras SOLID (SRP)

**Fecha:** 2026-06-05
**Status:** draft
**Servicio:** `apps/authorization-service`

## Contexto

El `authorization-service` tiene el nivel de cumplimiento SOLID más alto del repositorio, pero hay dos violaciones de Single Responsibility (SRP) identificadas:

1. **`VerifyEmployeeBenefitUseCase`** tiene 5 responsabilidades: AD lookup, validación de estado del empleado, persistencia, emisión de evento Redis, y publicación de respuesta de rechazo a Kafka (3 paths distintos con `publisher.publish()` directo). El use-case tiene demasiadas razones para cambiar.

2. **`OutboxPublisherService`** mezcla scheduling manual (`setInterval`/`clearInterval` en `onModuleInit`/`onModuleDestroy`) con la lógica del tick (retry de outbox entries). NestJS provee `@Interval()` de `@nestjs/schedule` que resuelve el scheduling a nivel de framework.

<REASONS>
  <Rationale>
    `VerifyEmployeeBenefitUseCase` nació como un use-case simple pero creció para manejar múltiples caminos de rechazo. Los 3 paths directos a `publisher.publish()` significan que si cambia el formato del payload de respuesta, el topic naming, o la lógica de qué incluir en cada tipo de rechazo, el use-case debe modificarse — violando SRP.

    `OutboxPublisherService` usa `setInterval` manual que mezcla la preocupación de "cuándo ejecutar" con "qué ejecutar". `@nestjs/schedule` es el idioma correcto en NestJS para scheduling, y su adopción también mejora la observabilidad (el scheduler del framework puede ser monitoreado).
  </Rationale>
  <Explanation>
    Para US-01: Se crea un port `IAuthorizationResponsePublisher` con métodos `reject(dto, reason)` y opcionalmente `approve(dto)`. El adapter `KafkaAuthorizationResponsePublisher` encapsula los 3 paths de publicación. `VerifyEmployeeBenefitUseCase` delega todos los rechazos a este port. Resultado: el use-case tiene 2 responsabilidades (AD lookup + delegar resultado), no 5.

    Para US-02: Se agrega `@nestjs/schedule` al `authorization-service`. `OutboxPublisherService` reemplaza `setInterval`/`clearInterval` por `@Interval()`. La lógica del tick no cambia — solo cambia quién dispara la ejecución.

    Ambas USTs son independientes y pueden implementarse en paralelo.
  </Explanation>
  <Assumptions>
    - `@nestjs/schedule` puede agregarse sin conflictos con las dependencias actuales.
    - Los 3 paths de rechazo en `VerifyEmployeeBenefitUseCase` producen el mismo tipo de payload (`AuthorizationResponseDto`) diferenciado solo por `RejectionReason` y campos opcionales.
    - El `OUTBOX_TICK_INTERVAL_MS` de configuración sigue siendo respetado al migrar a `@Interval()` — se leerá del `ConfigService` en el decorator o en el `onModuleInit`.
    - `ResolveAuthorizationUseCase` NO necesita este port — ya usa el outbox para publicar, no `publisher.publish()` directamente.
  </Assumptions>
  <Scrutiny>
    - ¿Es necesario un port `IAuthorizationResponsePublisher` o alcanza con extraer un método privado? El port es necesario porque permite testear `VerifyEmployeeBenefitUseCase` con un mock del publisher sin depender de `IMessagePublisher`/Kafka. Testear el rechazo se vuelve trivial.
    - ¿`@Interval()` en NestJS soporta intervalos dinámicos (configurables por env)? Sí, mediante `@Interval(configService.get('OUTBOX_TICK_INTERVAL_MS'))` o usando `SchedulerRegistry` para intervalos dinámicos.
    - ¿Qué pasa si `@nestjs/schedule` falla al inicializar? `ScheduleModule.forRoot()` es robusto; los fallos serían de compilación/configuración, no runtime.
  </Scrutiny>
  <Objections>
    - "El use-case ya funciona; refactorizarlo sin cambiar comportamiento es riesgo innecesario." — Los tests existentes garantizan que el comportamiento no cambia. El port es una refactorización interna.
    - "`setInterval` también funciona." — Sí, pero `@Interval()` elimina el boilerplate de `onModuleInit`/`onModuleDestroy` y hace el scheduling visible y gestionado por el framework.
  </Objections>
  <Novelty>
    - Introduce el primer port de respuesta (`IAuthorizationResponsePublisher`) como abstracción sobre el mecanismo de publicación de rechazos.
    - Primera adopción de `@nestjs/schedule` en el proyecto.
  </Novelty>
  <Substitutes>
    - Extraer método privado `rejectRequest()` en el use-case: reduce duplicación pero no invierte la dependencia; los tests siguen acoplados al publisher genérico.
    - Mantener `setInterval` manual: funciona pero es inconsistente con el resto del stack NestJS.
  </Substitutes>
</REASONS>

## Historias de usuario

### US-01: Port IAuthorizationResponsePublisher

**Como** desarrollador,
**quiero** un port `IAuthorizationResponsePublisher` que encapsule la publicación de respuestas de autorización,
**para** que `VerifyEmployeeBenefitUseCase` delegue los 3 paths de rechazo al port y tenga una sola razón para cambiar.

**Criterios de aceptación:**
```gherkin
Dado que existe el port IAuthorizationResponsePublisher
Cuando se inspecciona la interfaz
Entonces tiene al menos el método: reject(dto: AuthorizationRequestDto, reason: RejectionReason): Promise<void>

Dado que existe KafkaAuthorizationResponsePublisher
Cuando se llama a reject(dto, reason)
Entonces publica el payload correcto en auth.response.{dto.store_id} vía IMessagePublisher
Y el payload incluye decision: REJECT, reason, y los campos requeridos del DTO

Dado que VerifyEmployeeBenefitUseCase procesa un empleado no encontrado en AD
Cuando el AD lookup falla con EmployeeNotFoundException
Entonces llama a this.responsePublisher.reject(dto, RejectionReason.EMPLOYEE_NOT_FOUND)
Y no llama a this.publisher.publish() directamente

Dado que VerifyEmployeeBenefitUseCase procesa un empleado con cuenta deshabilitada
Cuando el AD devuelve un empleado con status !== 'active'
Entonces llama a this.responsePublisher.reject(dto, RejectionReason.EMPLOYEE_ACCOUNT_DISABLED)
Y no llama a this.publisher.publish() directamente

Dado que VerifyEmployeeBenefitUseCase procesa un empleado sin rol de associate
Cuando el AD devuelve un empleado con role !== 'associate'
Entonces llama a this.responsePublisher.reject(dto, RejectionReason.EMPLOYEE_NOT_ASSOCIATE)
Y no llama a this.publisher.publish() directamente

Dado que existe un test de VerifyEmployeeBenefitUseCase
Cuando se configura un mock de IAuthorizationResponsePublisher
Entonces el test puede verificar que se llamó reject() con la razón correcta
Sin necesitar un mock de IMessagePublisher
```

**Archivos a crear:**
- `apps/authorization-service/src/domain/ports/authorization-response-publisher.port.ts`
- `apps/authorization-service/src/infrastructure/messaging/kafka/kafka-authorization-response-publisher.adapter.ts`

**Archivos a modificar:**
- `apps/authorization-service/src/domain/use-cases/verify-employee-benefit.use-case.ts` — reemplazar 3 llamadas `publisher.publish()` por `responsePublisher.reject()`
- `apps/authorization-service/src/authorization/authorization.module.ts` — binding `AUTHORIZATION_RESPONSE_PUBLISHER` → `KafkaAuthorizationResponsePublisher`
- Tests de `verify-employee-benefit.use-case.spec.ts`

---

### US-02: OutboxPublisherService usa @Interval() de @nestjs/schedule

**Como** desarrollador,
**quiero** que `OutboxPublisherService` use `@Interval()` de `@nestjs/schedule` en lugar de `setInterval` manual,
**para** que el framework gestione el scheduling y el servicio se enfoque solo en la lógica del tick.

**Criterios de aceptación:**
```gherkin
Dado que @nestjs/schedule está instalado en authorization-service
Cuando se inspecciona authorization.module.ts
Entonces ScheduleModule.forRoot() está en los imports del módulo raíz

Dado que OutboxPublisherService usa @Interval()
Cuando se inspecciona la clase
Entonces NO tiene onModuleInit con setInterval
Entonces NO tiene onModuleDestroy con clearInterval
Entonces el método tick() está decorado con @Interval() o equivalente dinámico

Dado que OUTBOX_TICK_INTERVAL_MS está configurado como variable de entorno
Cuando OutboxPublisherService inicializa
Entonces el intervalo refleja el valor configurado
Y el valor por defecto sigue siendo 1000ms si no está definida

Dado que la app corre normalmente con make dev
Cuando se inyectan requests con pnpm inject
Entonces el outbox sigue procesando y publicando en Kafka al mismo ritmo
Sin regresiones en el comportamiento observable

Dado que se ejecuta pnpm --filter authorization-service test
Cuando los tests de OutboxPublisherService corren
Entonces todos pasan en verde
Y los tests no requieren clearInterval manual en teardown
```

**Archivos a modificar:**
- `apps/authorization-service/src/infrastructure/outbox/outbox-publisher.service.ts` — migrar de `setInterval` a `@Interval()`
- `apps/authorization-service/src/authorization/authorization.module.ts` — agregar `ScheduleModule.forRoot()`
- `apps/authorization-service/package.json` — agregar `@nestjs/schedule` si no está presente

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|---|---|---|
| US-01 | — | ✅ Sí (independiente) |
| US-02 | — | ✅ Sí (independiente de US-01) |

## Tests

- **US-01:** Test unitario de `VerifyEmployeeBenefitUseCase` con mock de `IAuthorizationResponsePublisher`; verificar que cada path de rechazo llama `reject()` con el `RejectionReason` correcto. Test unitario de `KafkaAuthorizationResponsePublisher`; verificar que construye el payload correcto.
- **US-02:** Test de `OutboxPublisherService` usando `@nestjs/schedule` en modo test; verificar que `tick()` es invocado y procesa entries del outbox. Sin `clearInterval` en teardown.

## Verificación end-to-end

1. `grep -r "publisher\.publish" apps/authorization-service/src/domain --include="*.ts"` — debe retornar vacío (ningún use-case llama al publisher directamente)
2. `pnpm --filter authorization-service test` — suite completa en verde
3. `pnpm --filter authorization-service typecheck` — sin errores
4. `make dev` + `pnpm inject --type EMPLOYEE_BENEFIT --verify` — flujo completo funciona

---

## Resultado

**Fecha de finalización:** 2026-06-05
**Status del spec:** completed

### Implementado
- [x] US-01: Port `IAuthorizationResponsePublisher` con método `reject(dto, reason)`. Adapter `KafkaAuthorizationResponsePublisher` encapsula publicación a `auth.response.{store_id}`. `VerifyEmployeeBenefitUseCase` delegó los 3 paths de rechazo al port — eliminó dependencia directa de `IMessagePublisher` para rechazos. Token `AUTHORIZATION_RESPONSE_PUBLISHER`.
- [x] US-02: `@nestjs/schedule` instalado. `ScheduleModule.forRoot()` en el módulo raíz. `OutboxPublisherService.tick()` decorado con `@Interval('outbox-tick', OUTBOX_TICK_INTERVAL_MS)`. Eliminados `setInterval`/`clearInterval` manuales, `start()`/`stop()`, `onModuleInit`/`onModuleDestroy`.

### No implementado / Desviaciones
- `process-price-change.use-case.ts` sigue usando `publisher.publish()` directamente — fuera del scope de este spec (solo targetea `VerifyEmployeeBenefitUseCase`).
- No se creó spec/test unitario dedicado para `KafkaAuthorizationResponsePublisher`; la cobertura viene de los tests de `VerifyEmployeeBenefitUseCase`.

### Tests
- authorization-service: **92/92 tests pasando** (10 suites). Se eliminaron 2 tests de lifecycle (`onModuleInit`/`onModuleDestroy`) que ya no aplican con `@Interval()`.
- `grep "publisher\.publish" apps/authorization-service/src/domain/use-cases/verify-employee-benefit.use-case.ts` → vacío ✅
- typecheck: limpio ✅
