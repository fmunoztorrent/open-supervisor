# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **⚠️ PIPELINE ENFORCEMENT ACTIVO (opencode):** El plugin `pipeline-enforcer` bloquea cualquier edición de archivos (`edit`/`write`) hasta que se inicie el pipeline con `todowrite`. Si ves el error del plugin, ejecuta primero `todowrite` con los 6 pasos del pipeline. No intentes editar archivos sin pipeline — será bloqueado mecánicamente.
>
> **Claude Code:** El `pre-command` hook y el `git pre-commit hook` también verifican el estado del pipeline. No puedes commitear sin pipeline cerrado.

## Proyecto

**open-supervisor** — App móvil Android para supervisores de supermercado. Recibe solicitudes de autorización desde terminales POS (descuentos especiales, cancelación de compra, beneficio empleado, suspensión de compra), las muestra en tiempo real al supervisor, y envía la decisión de vuelta al POS.

## Codebase map

| Directorio | Propósito |
|---|---|
| `apps/authorization-service/` | Microservicio NestJS: consume Kafka, orquesta use-cases, publica auth.response.{store_id} |
| `apps/sse-server/` | Suscribe Redis pub/sub, emite SSE hacia el BFF |
| `apps/bff/` | Backend for Frontend: proxy SSE + REST API para la app móvil |
| `apps/mobile/` | React Native (Android) — app del supervisor |
| `packages/shared-types/` | DTOs, interfaces, enums compartidos entre servicios |
| `packages/shared-messaging/` | Ports: IMessagePublisher, IMessageConsumer, INotificationSubscriber |
| `scripts/` | Tooling de desarrollo: `inject-request.ts` para simular solicitudes POS sin infraestructura de tienda |
| `collections/` | Colecciones Postman para testing manual de endpoints REST |
| `spec/` | Specs activos (draft). Los completados se mueven a `spec/archived/` (excluido del contexto) |

## Arquitectura

Monorepo pnpm workspaces con microservicios NestJS + app React Native (Android).

```
apps/
  authorization-service/   # Consume auth.requests desde Kafka, lógica de negocio, publica auth.response.{store_id}
  sse-server/              # Suscribe Redis pub/sub, emite SSE hacia el BFF
  bff/                     # Backend for Frontend: proxy SSE + REST API para la app móvil
  mobile/                  # React Native (Android) — app del supervisor

packages/
  shared-types/            # Interfaces, DTOs y enums compartidos entre servicios backend
  shared-messaging/        # Ports de mensajería: IMessagePublisher, IMessageConsumer, INotificationSubscriber
```

### Flujo de una solicitud

```
POS → internal-server (tienda) ──kafka:auth.requests──► authorization-service
  authorization-service → Redis PUBLISH → sse-server → SSE → bff → app móvil
  supervisor decide → bff REST → authorization-service
  authorization-service ──kafka:auth.response.{store_id}──► internal-server → POS
```

### Hexagonal Architecture (Ports & Adapters)

**Regla no negociable:** el dominio de cada servicio define ports (interfaces TypeScript en `domain/ports/`). La infraestructura implementa adapters. Ningún use-case importa SDKs de Kafka, Redis ni ninguna librería de infra directamente.

```
domain/
  entities/        # Entidades puras de dominio
  ports/           # IMessagePublisher, IMessageConsumer, IAuthorizationRepository, IEventEmitter
  use-cases/       # Lógica de negocio — depende solo de ports

application/       # Orquesta use-cases

infrastructure/
  messaging/
    kafka/         # KafkaConsumer, KafkaPublisher (único adaptador activo)
  persistence/     # Implementación de IAuthorizationRepository
  events/          # RedisPublisher para notificaciones al sse-server
                   # Canal store:{id}:requests  → SSE type 'authorization_request'
                   # Canal store:{id}:dispatches → SSE type 'physical_presence_dispatch' (presencia física)

app.module.ts      # Único lugar donde se hace el binding port → adapter
```

Agregar RabbitMQ o Google Pub/Sub en el futuro = nueva carpeta en `infrastructure/messaging/` + cambio en `app.module.ts`. El dominio no se toca.

### Kafka topics

| Topic | Dirección | Descripción |
|---|---|---|
| `auth.requests` | tienda → cloud | Todas las tiendas publican aquí |
| `auth.response.{store_id}` | cloud → tienda | Topic dedicado por tienda |

Payload incluye siempre: `store_id`, `pos_id`, `correlation_id`, `type` (DISCOUNT / CANCEL / EMPLOYEE_BENEFIT / SUSPEND / PRICE_CHANGE).

Para `PRICE_CHANGE` el payload incluye además: `product_id`, `original_price`, `requested_price`.  
`AuthorizationResponseDto` incluye `type?: RequestType` para que el `internal-server` discrimine el tipo en la respuesta.

### Routing sin acoplamiento a IPs de tienda

Las tiendas viven en redes privadas. El único canal de retorno es Kafka. El `internal-server` de cada tienda suscribe solo `auth.response.{store_id}` y enruta al POS correcto por `correlation_id`.

## Principios SOLID

La arquitectura hexagonal impone DIP y OCP estructuralmente. Estas reglas hacen explícito el contrato completo.

### El punto dulce: SOLID + filosofía del framework

> Los principios SOLID y la arquitectura hexagonal son objetivos de diseño, no dogmas rígidos. Se aplican **respetando la filosofía del framework** (NestJS para el backend, React Native para el móvil). Cuando exista tensión entre un principio SOLID y un idioma del framework, evaluar el trade-off:
>
> - **El dominio (use-cases, entities, ports) debe ser agnóstico del framework.**
> - **La infraestructura puede y debe usar idiomas del framework** para no reinventar lo que el ecosistema ya resuelve.
> - **Crear un port custom solo si no hay una abstracción del framework** que satisfaga el contrato.

Ejemplos de trade-offs resueltos en este repositorio:

| Situación | Solución elegida | Razón |
|---|---|---|
| HTTP en NestJS | `HttpService` de `@nestjs/axios`, no port custom | `HttpService` ya ES la abstracción; testeable con `HttpClientTestingModule` |
| EventSource (sin built-in NestJS) | Port `IEventSourceConnector` + adapter | No hay módulo oficial; el port justifica la abstracción |
| Scheduling en NestJS | `@Interval()` de `@nestjs/schedule` | El framework maneja el scheduling; no reinventar con `setInterval` |
| Lifecycle en adapters | `OnModuleDestroy` directamente en la clase | NestJS lo diseñó así; TypeScript impide que clientes del port llamen `onModuleDestroy()` |

### Principios

| Principio | Regla |
|---|---|
| **S — Single Responsibility** | Cada use-case tiene exactamente una razón para cambiar. Separar lógica de publicación, persistencia y validación en clases distintas. |
| **O — Open/Closed** | Nuevo broker, repositorio o proveedor externo = nueva carpeta en `infrastructure/` + 1 línea en el module. El dominio no se toca. |
| **L — Liskov Substitution** | Un adapter debe poder substituir al port sin efectos secundarios observables. Los lifecycle hooks NestJS son responsabilidad de la clase concreta — no forman parte del contrato del port y TypeScript los aísla por tipo. |
| **I — Interface Segregation** | Interfaces con el menor número de métodos que satisfagan el contrato. |
| **D — Dependency Inversion** | Dominio y use-cases dependen de abstracciones. Nunca de `kafkajs`, `ioredis`, `drizzle-orm`, `fetch` o `EventSource` directos. Para HTTP: `HttpService` de `@nestjs/axios`. Para SSE: `IEventSourceConnector`. |

> **Regla de oro:** Si un test de un use-case requiere un mock de `kafkajs`, `ioredis`, `drizzle-orm`, `fetch` o `EventSource` directamente, hay una violación DIP. Los tests de dominio mockean ports (interfaces), nunca SDKs.

## Stack

| Capa | Tecnología |
|---|---|
| App móvil | React Native (Android primero) + TypeScript |
| UI system mobile | `@gluestack-ui/themed` v1 — componentes: Box, HStack, VStack, Pressable, Text, Badge, Spinner, Button, ButtonText, ButtonSpinner |
| Backend services | NestJS + TypeScript |
| Mensajería | Kafka (`@nestjs/microservices` + `kafkajs`) |
| Notificaciones realtime | Redis pub/sub → SSE (`@Sse()` NestJS) → `react-native-sse` en la app |
| Monorepo | pnpm workspaces |
| Orquestación backend | Kubernetes |
| Testing backend | Jest + Supertest |
| Testing mobile | Jest + React Native Testing Library + Detox (E2E) |

## Comandos

```bash
# ── Primer uso (nuevo desarrollador) ─────────────────────────────────────────
# 1. Instalar todas las dependencias del sistema y configurar el entorno Android:
./setup-android.sh

# 2. Recargar el shell para activar ANDROID_HOME y platform-tools en el PATH:
source ~/.zshrc   # o ~/.bashrc según tu shell

# 3. Compilar los paquetes compartidos (OBLIGATORIO antes del primer nest start):
cd packages/shared-types && node_modules/.bin/tsc && cd ../shared-messaging && node_modules/.bin/tsc && cd ../..

# ─────────────────────────────────────────────────────────────────────────────

# Instalar dependencias (ya lo hace setup-android.sh; correr manualmente si se clona sin el script)
pnpm install

# ── Levantar todo con un solo comando (Makefile) ──────────────────────────────
# Reemplaza los pasos manuales de abajo: levanta contenedores + compila + arranca los 3 servicios
make dev               # infraestructura + servicios backend
make emulator          # emulador + port forwarding + Metro + app (requiere make dev primero)
make all               # dev + emulator (stack completo)
make down              # detiene todo
make status            # verifica qué está corriendo
# Override del motor de contenedores: make dev COMPOSE="docker compose"

# ─────────────────────────────────────────────────────────────────────────────

# Levantar infraestructura (Kafka + Redis) — el Makefile detecta el motor automáticamente:
make infra

# Backend — levantar servicio específico
pnpm --filter authorization-service dev
pnpm --filter sse-server dev
pnpm --filter bff dev

# Mobile — requiere dos terminales separadas
# Terminal 1: Metro bundler (debe estar corriendo antes de pnpm android)
cd apps/mobile && pnpm start

# Terminal 2: compilar, instalar y lanzar en el emulador
# El emulador debe estar corriendo antes (Android Studio → Virtual Device Manager, o:)
#   emulator -avd open_supervisor &
cd apps/mobile && pnpm android   # usa --no-packager, depende de Metro activo

# Tests
pnpm test                                    # todos los servicios backend
pnpm --filter authorization-service test
pnpm --filter authorization-service test:e2e
cd apps/mobile && pnpm test                  # Jest + RNTL
cd apps/mobile && pnpm detox:test            # E2E Detox

# Lint / typecheck
pnpm lint
pnpm typecheck

# Script de inyección de solicitudes (desarrollo / QA)
# Simula el flujo completo POS → Kafka → authorization-service → SSE → app
pnpm inject --type DISCOUNT --store-id store-1 --pos-id pos-1
pnpm inject --type PRICE_CHANGE --product-id P42 --original-price 100 --requested-price 80
pnpm inject --type DISCOUNT --verify   # verifica llegada al SSE del BFF (requiere servicios corriendo)
pnpm inject --type DISCOUNT --verbose  # muestra configuración activa

# Tests del script de inyección (node --test + tsx, sin Jest)
npx tsx --test scripts/inject-request.spec.ts

# Mutation testing (Stryker) — valida calidad de tests en servicios backend
pnpm test:mutation              # todos los servicios
pnpm --filter <service> test:mutation  # servicio específico

# Colección Postman (testing manual de endpoints REST)
# Importar collections/open-supervisor.postman_collection.json en Postman
# Incluye todos los endpoints REST del BFF y authorization-service + documentación de inyección
```

## Flujo de trabajo (pipeline automático)

### Triaje de tareas

Antes de ejecutar cualquier acción, clasificar la petición del usuario:

| Tipo | Ejemplos | Pipeline |
|---|---|---|
| `feature` | implementar login con Google, agregar alertas, nuevo endpoint | 6 pasos completo |
| `bugfix` | el SSE no reconecta, las solicitudes no llegan al BFF | 6 pasos (sin spec si es directo) |
| `debug` | por qué falla el typecheck, investigar timeout en Kafka | triage → reproducir → análisis → reporte |
| `chore` | cambiar LOG_LEVEL, renombrar variable, actualizar dependencia | scope → ejecutar → verify → close |
| `question` | qué puerto usa el BFF, cómo está estructurado el proyecto | responder directamente, sin pipeline |

Si la clasificación no es clara, preguntar al usuario en lugar de asumir.

### Visibilidad del pipeline

Cada vez que se inicia, avanza o termina un paso del pipeline, se DEBE:

1. **Anunciar la transición** con el formato:

```
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Paso N/M · <Agente>
  Tarea: <descripción>
  Estado: iniciado | validando | bloqueado | completado
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

2. **Actualizar `todowrite`** con el estado completo del pipeline, visible en cada interacción:

```
[✓] 1/6 Spec Generator → spec aprobado
[▶] 2/6 Architect → validando paths y escenarios...
[ ] 3/6 QA (RED)
[ ] 4/6 Backend/Frontend
[ ] 5/6 QA (GREEN)
[ ] 6/6 Cierre
```

### Pipeline feature (6 pasos)

> **REGLA ABSOLUTA — SIN EXCEPCIONES:** Cualquier modificación al código fuente (feature, refactor, hot fix, test, renombrado, corrección de typo en lógica) requiere ejecutar este flujo completo antes de escribir código. No existe tarea "demasiado pequeña" para saltarse el flujo.

```
1. /spec-generator        → spec formal en spec/ con REASONS Canvas (XML)
2. architect agent        → valida viabilidad técnica, enriquece paths y escenarios de test
3. qa agent (RED)         → escribe tests que fallan por la razón correcta
4. backend / frontend     → implementa hasta que los tests pasen en verde
                           ⚠️ FRONTEND: el paso 4 no está completo hasta que la app cargue
                           correctamente en el emulador Android sin pantalla roja. Pasos
                           obligatorios antes de marcar el paso 4 como completado:
                             (a) Metro corriendo: `cd apps/mobile && pnpm start`
                             (b) App instalada: `pnpm android` (emulador debe estar activo)
                             (c) `adb logcat | grep ReactNativeJS` sin errores críticos
                             (d) Screenshot del emulador confirma UI correcta (sin red screen)
5. qa agent (GREEN)       → corre la suite completa y reporta
6. cierre                 → (a) actualizar spec con tareas completadas,
                           (b) entrada en .claude/LEARNINGS.md,
                           (c) actualizar CLAUDE.md si corresponde
```

Un hook `Stop` en `.claude/settings.json` recuerda el paso 6 al terminar cada turno.

La herramienta `todowrite` mantendrá el tablero visible. Cada transición se anuncia con el formato de visibilidad descrito arriba.

### Pipeline enforcement automático

El plugin `pipeline-enforcer` (`.opencode/plugins/pipeline-enforcer.js`) bloquea mecánicamente cualquier `edit`/`write` hasta que se detecte un pipeline activo via `todowrite`.

**Cómo funciona (multi-scope):**
1. El hook `todo.updated` parsea cada todo y lo asigna a un **scope** usando el prefijo `[scope:id]`. Los todos sin prefijo van al scope `main`.
2. Cada scope mantiene su propio estado en `state.json` (`{ scopes: { "feature/x": { active, type, step, ... } } }`)
3. El hook `tool.execute.before` bloquea `edit`/`write` si **ningún scope** está activo
4. Cuando un scope completo pasa de activo a completado, el plugin escribe `.opencode/pipeline/close-pending.json` automáticamente
5. Al marcar todos los todos de todos los scopes como `completed`, el plugin desactiva el bloqueo global

**Si ves el error del plugin:** ejecuta `todowrite` con los pasos del pipeline. Para tareas múltiples:

```
[feature.login-google]
[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect → validar viabilidad
[ ] 3/6 QA (RED) -> tests que fallan
[ ] 4/6 Backend -> implementar
[ ] 5/6 QA (GREEN) -> suite completa
[ ] 6/6 Cierre -> close.md

[bugfix.sse]
[▶] 1/5 Triage -> confirmar error
[ ] 2/5 Reproducir -> test que falla
[ ] 3/5 Fix -> corregir
[ ] 4/5 Verify -> tests + typecheck
[ ] 5/5 Cierre -> close.md
```

### Claude Code hooks

El pre-command hook en `.claude/settings.json` ejecuta `.opencode/pipeline/check.sh` antes de cada comando bash. Si no hay pipeline activo, bloquea comandos destructivos.

## Git workflow

### Branching strategy

> **REGLA:** Toda tarea nueva que requiera un spec se debe trabajar en una rama ad-hoc. No se trabaja directamente sobre `main`.

| Tipo de tarea | Branch desde | Convención de nombre | Integración local | PR (remoto) |
|---|---|---|---|---|
| `feature` (con spec) | `main` | `feature/<descripcion-corta>` | merge a `dev` local | PR → `main` |
| `bugfix` | `main` | `fix/<descripcion-corta>` | merge a `dev` local | PR → `main` |
| `chore` | `main` | `chore/<descripcion-corta>` | merge a `dev` local | PR → `main` |

**Flujo:**
1. Crear rama desde `main`: `git checkout -b feature/mi-feature main`
2. Trabajar en la rama siguiendo el pipeline
3. Al completar el pipeline (paso 6), la rama actual se **fusiona automáticamente** a `dev` local (ver siguiente subsección)
4. Abrir un Pull Request apuntando a `main`
5. El PR se mergea a `main` (squash o merge convencional)

No se permite merge directo a `main`. Todo cambio entra vía PR.

### Integración local con `dev`

> **REGLA:** Al terminar un spec (paso 6 del pipeline), la rama actual se
> fusiona a la rama `dev` local **antes** de abrir el PR. `dev` es la
> rama de integración local — no se pushea automáticamente al remoto.

**Cómo funciona:**

- Si la rama `dev` no existe: se crea desde `main` (`git branch dev main`).
- Si ya existe: se hace `git merge --no-ff` de la rama actual hacia `dev`.
- Si la rama actual es `main` o `dev`: no se hace nada (evita noop).
- Si hay conflicto al fusionar: el merge se aborta, el worktree vuelve a la
  rama original, y el cierre se detiene para que el humano resuelva.

**Implementación:** `.opencode/pipeline/merge-to-dev.sh`. Es invocado por
el paso 2 de `.opencode/pipeline/close.md` durante el cierre automático de
un scope.

**Para qué sirve `dev` local:**

- Punto de integración temprana: validás que la rama actual convive con
  lo que ya hay integrado (detecta conflictos antes del PR).
- Compuerta antes de review: si algo se rompe al integrar, lo arreglás
  acá, no durante la review en `main`.
- Historial legible: `--no-ff` preserva la topología de la feature branch
  dentro de `dev`.

**Push a `origin/dev`:** se hace manualmente, nunca durante el cierre del
spec. Si querés sincronizar, `git push origin dev` cuando lo decidas.

> **⚠️ REGLA ABSOLUTA: `dev` es permanente.** La rama `dev` **nunca** debe
> ser eliminada — ni local ni remotamente. Es la rama de integración perpetua
> del proyecto. Al limpiar ramas después de una consolidación a `main`,
> solo se eliminan las ramas de feature/bugfix/chore; `dev` se preserva
> intacta. Cualquier operación de limpieza (`git branch -d`, `git push
> --delete`) debe excluir explícitamente `dev`.

### Git pre-commit hook

```bash
# Ya ejecutado:
git init
git config core.hooksPath .opencode/pipeline
```

El script `.opencode/pipeline/pre-commit.sh` rechaza commits si el pipeline está en progreso (paso < 6/6).

### Actualización del spec al cierre

Al completar la implementación de un spec (siguiendo `close.md`):

1. En `spec/`:
   - Marcar `[x]` los criterios de aceptación completados en el XML (`<result>/<implemented>/<item>`)
   - Llenar `<result>` con:
     - `<completed-at>`: fecha de finalización
     - `<implemented>`: USTs completadas
     - `<deviations>`: desviaciones respecto al spec original (si las hay)
     - `<tests>`: resumen de resultados
   - Cambiar `spec@status` de `draft` a `completed`
   - Marcar `<meta>/<archived>` como `true`
   - Incrementar `spec@revision` y agregar entrada en `<history>`
   - **Mover el spec** de `spec/` a `spec/archived/`
2. El spec queda como registro histórico inmutable de lo planeado vs lo entregado.

### Pipeline bugfix (pasos simplificados)

```
1. triage                → confirmar el bug, recolectar evidencias (logs, stacks)
2. reproducir            → escribir test que reproduzca el bug (falla en rojo)
3. architect (opcional)  → si el fix requiere cambios arquitecturales
4. fix                   → implementar la corrección
5. verify                → correr suite completa + typecheck
6. cierre                → leer `.opencode/pipeline/close.md` y ejecutar instrucciones
```

### Cierre automático (close-agent)

Al marcar el último todo de un scope como `completed`, el **agente debe ejecutar inmediatamente** las instrucciones de `.opencode/pipeline/close.md`. Este checklist cubre:

1. Actualizar spec si existe
2. **Fusionar la rama actual a `dev` local** (creando `dev` desde `main` si no existe)
3. Abrir Pull Request apuntando a `main`
4. Entrada en LEARNINGS.md
5. Revisar si CLAUDE.md necesita actualización
6. Limpiar close-pending
7. Anunciar cierre

**El plugin no ejecuta el cierre automáticamente** — solo marca que hay un cierre pendiente. El agente es responsable de leer y ejecutar `close.md`.

### REASONS Canvas — obligatorio en todo spec

> **NO NEGOCIABLE:** Todo spec generado con `/spec-generator` **debe incluir** el bloque REASONS Canvas en XML. Un spec sin este bloque es inválido y no puede avanzar al paso 2.

El REASONS Canvas captura el **por qué** de cada decisión de diseño, no solo el qué. Estructura:

```xml
<REASONS>
  <Rationale>Por qué existe esta feature / decisión de negocio que la motiva.</Rationale>
  <Explanation>Cómo funciona y por qué se eligió este enfoque sobre otros.</Explanation>
  <Assumptions>Supuestos que deben ser verdaderos para que el diseño sea válido.</Assumptions>
  <Scrutiny>Preguntas que vale la pena desafiar antes de implementar.</Scrutiny>
  <Objections>Contraargumentos conocidos y cómo se responden.</Objections>
  <Novelty>Qué es nuevo o diferente respecto al estado actual del sistema.</Novelty>
  <Substitutes>Alternativas consideradas y por qué fueron descartadas.</Substitutes>
</REASONS>
```

El bloque va como sección propia (`## REASONS Canvas`) inmediatamente después del `## Contexto`, antes de las historias de usuario.

### Mantenimiento de la configuración

Revisar la configuración del harness (CLAUDE.md, hooks, skills, .claudeignore, permisos) **cada 3-6 meses** o después de un release mayor del modelo. Las instrucciones escritas para una versión anterior del modelo pueden volverse ruido o restricciones innecesarias cuando el modelo mejora.

## Descomposición y paralelización de scopes

**Regla obligatoria al iniciar un pipeline de feature/bugfix cuando el spec tiene muchas USTs:**

| Spec tiene... | Acción |
|---|---|
| **≥3 USTs independientes** (sin dependencias entre sí) | **Descomponer** en N scopes, uno por UST, usando prefijo `[scope:id]` en `todowrite` |
| 1–2 USTs | Un solo scope (no descomponer — overhead > beneficio) |
| USTs mixtas (independientes + dependientes) | Descomponer y procesar por **capas topológicas** |

**Convención de nombres de scope** (el regex del plugin es `[\w.-]+`, NO soporta `/`):
- ✅ `feature-nombre-corto-kebab` o `bugfix.nombre-corto-kebab`
- ❌ `feature/nombre` (rompe el regex — usar `-` o `.` como separador)

**Formato multi-scope en todowrite** (ver también sección "Pipeline enforcement automático" arriba):

```
[feature-login-google]
[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect → validar viabilidad
[ ] 3/6 QA (RED) → tests que fallan
[ ] 4/6 Backend → implementar
[ ] 5/6 QA (GREEN) → suite completa
[ ] 6/6 Cierre → close.md

[bugfix.sse-reconnect]
[▶] 1/5 Triage → confirmar error
[ ] 2/5 Reproducir → test que falla
[ ] 3/5 Fix → corregir
[ ] 4/5 Verify → tests + typecheck
[ ] 5/5 Cierre → close.md
```

**Paralelización de scopes independientes:** cuando hay N scopes en la misma capa topológica (sin dependencias entre sí), se procesan **en paralelo** vía `task` tool:
- Invocar `task` tool N veces en **una sola respuesta** (paralelismo a nivel de tool calls)
- Cada `task` recibe un prompt con: spec path, scope name, USTs a implementar, dependencias satisfechas
- Esperar a que **todos** los sub-agentes de la capa actual terminen antes de procesar la siguiente capa

**Análisis de dependencias:** todo spec debe incluir una sección `## Dependencias entre USTs` con tabla `UST → Depende de → ¿Paralelizable?`. Si el spec no la tiene, el architect la agrega en el paso 2 como enriquecimiento.

**Skill `scope-orchestrator`:** invocar `.claude/skills/scope-orchestrator/SKILL.md` cuando se detecta un spec con ≥3 USTs. El skill codifica el patrón completo: análisis de dependencias, cálculo de capas, prompt template para sub-agentes.

**Resumen:**
- Spec chico (1-2 USTs) → 1 scope, secuencial
- Spec grande (≥3 USTs) → descomponer + paralelizar por capas

**Spec de referencia:** `spec/2026-06-04-descomposicion-paralelizacion-scopes.spec.md`

## Loop QA GREEN → RED

El agente QA en FASE GREEN no solo verifica — decide si el pipeline avanza a cierre o vuelve a RED:

| Falla | Acción |
|---|---|
| Typecheck roto | Backend corrige, QA re-verifica, vuelve a RED |
| Tests en rojo por regresión | QA escribe test que captura la regresión, vuelve a RED |
| Mutation score < 50% (threshold `low`) | QA refuerza tests para mutantes sobrevivientes, vuelve a RED |
| Todo OK | QA reporta "GREEN completo" y avanza a cierre |

**Herramientas**: QA usa `pnpm test:mutation` (Stryker) como paso adicional en FASE GREEN. El contrato completo está documentado en `Skill(mutation-testing)` y en los agentes QA (`.claude/agents/qa.md` y `.opencode/agents/qa.md`).

## Code Navigation

- **LSP (opencode):** LSP está habilitado via `"lsp": true` en `opencode.json`. Usa tsserver built-in para go-to-definition, find-references y diagnostics.
- **LSP (Claude Code):** Activado via feature flag `ENABLE_LSP_TOOL` + plugin `typescript-lsp@claude-plugins-official`. Usa `typescript-language-server`.
- **Prefer LSP over Grep** para navegación de símbolos: go-to-definition, find-references, hover. Usar Grep/Glob solo para descubrimiento (encontrar archivos, buscar patrones).
- Después de localizar un archivo con Grep/Glob, usar LSP para navegar dentro de él en vez de leer el archivo completo.

## Convenciones

- **Specs primero**: toda feature arranca con un spec en `spec/` siguiendo el REASONS Canvas (XML). **El bloque `<REASONS>` es obligatorio y no negociable** — ver sección "REASONS Canvas — obligatorio en todo spec".
- **TDD**: QA escribe tests en rojo antes de que el implementador escriba código.
- **Ports en `shared-messaging`**: `IMessagePublisher`, `IMessageConsumer` e `INotificationSubscriber` definidos en el package compartido; adapters Kafka en cada servicio bajo `infrastructure/messaging/kafka/`.
- **DTOs en `shared-types`**: `AuthorizationRequestDto`, `AuthorizationResponseDto`, enums de tipo de solicitud. Importados tanto por servicios backend como por la app mobile. Patrón vigente: **campos opcionales** (`amount?`, `employee_id?`, `product_id?`, etc.) — NO discriminated unions. Migrar a unions discriminadas requiere un spec de refactor separado.
- **SSE en mobile**: usar `react-native-sse` (polyfill de EventSource para React Native); el BFF expone el endpoint SSE que la app consume.
- **UI en mobile**: usar `@gluestack-ui/themed` v1 para todos los componentes visuales. No usar `StyleSheet.create` en componentes migrados. Imports desde `@gluestack-ui/themed`: `Box`, `HStack`, `VStack`, `Pressable`, `Text`, `Badge`, `BadgeText`, `Center`, `Spinner`, `ScrollView`, `Button`, `ButtonText`, `ButtonSpinner`. El `GluestackUIProvider` con `config` de `@gluestack-ui/config` está en `App.tsx` como wrapper raíz. Los tests requieren `renderWithProvider` (definido en `jest.setup.js`) en lugar de `render` directo para componentes Gluestack.
- **Variables de entorno**: backend via `ConfigModule` NestJS; mobile via `react-native-config`.
- **Módulos NestJS**: cada feature es un módulo; el binding port → adapter va en el module, no en los use-cases.
- **Skills operativos en el repo (agnósticos)**: `open-supervisor-infra` (contenedores + servicios backend + inyección + Kafka) y `open-supervisor-emulator` (validación e2e de la app Android) viven en `.claude/skills/` dentro del repo (git-trackeados), por lo que cualquiera que clone el proyecto los recibe. **Son agnósticos de máquina**: no contienen rutas absolutas — derivan la raíz con `git rev-parse --show-toplevel`, detectan el motor de contenedores (Podman/Docker) y resuelven el socket y el serial del emulador dinámicamente. opencode los lee vía `.claude/skills` agregado a `skills.paths` en `opencode.json` (fuente única, sin duplicar). Los agentes `qa`, `backend` y `frontend` tienen el tool `Skill` habilitado y deben **delegar en estos skills** en vez de improvisar comandos crudos de Podman/Docker/adb. Regla: ningún skill ni script de tooling debe contener rutas absolutas de usuario (`$HOME/...`) ni nombres de contenedor con prefijo de proyecto; usar `$COMPOSE exec <servicio>`.
- **Skills de automejora (learnings)**: `qa-learnings`, `backend-learnings`, `frontend-learnings` y `architect-learnings` en `.claude/skills/`. Cada uno contiene reglas activas y lecciones recientes destiladas de `.claude/LEARNINGS.md` para el subagente correspondiente. Se actualizan automáticamente al cierre de cada tarea vía `scripts/extract-learnings.ts`. Los agentes cargan su skill al comenzar.
- **Skill de mutation testing**: `mutation-testing` en `.claude/skills/`. Documenta cómo ejecutar Stryker, interpretar thresholds y el contrato QA GREEN → RED. Cargado por el agente QA al iniciar.
## Validaciones automáticas (prevención de hardcodeos)

El harness bloquea mecánicamente la introducción de hardcodeos en tres niveles:

| Nivel | Mecanismo | Archivo | Cuándo |
|---|---|---|---|
| 1 | **Plugin opencode** | `.opencode/plugins/pipeline-enforcer.js` | En tiempo real al ejecutar `edit`/`write` |
| 2 | **Git pre-commit hook** | `.opencode/pipeline/pre-commit.sh` → `scripts/validate-hardcodes.sh` | Antes de `git commit` |
| 3 | **Script standalone** | `scripts/validate-hardcodes.sh` | Manual o CI (`bash scripts/validate-hardcodes.sh <archivos>`) |

### Patrones prohibidos

| Patrón | Ejemplo incorrecto | Forma correcta |
|---|---|---|
| Ruta absoluta de usuario | `$HOME/proyecto/config` | `$(git rev-parse --show-toplevel)/config` |
| Socket hardcodeado | `Variable DOCKER_HOST con socket absoluto` | `make infra` (detección automática) |
| Nombre de contenedor con prefijo | `podman exec <proyecto>-kafka-1` | `$COMPOSE exec kafka` |

### Allowlist

Si un hardcodeo es legítimo (ej. en `.claude/settings.local.json`), hay dos mecanismos:

1. **Archivos excluidos:** `.claude/settings.local.json` está en la allowlist global (definida en `.opencode/pipeline/hardcode-patterns.json`).
2. **Comentario inline:** agregar `# hardcode-ok: <razón>` en el archivo para excluir líneas específicas.

Los patrones están definidos en `.opencode/pipeline/hardcode-patterns.json` (fuente única compartida por el plugin JS y el script bash).
