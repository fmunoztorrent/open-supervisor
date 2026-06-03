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

## Arquitectura

Monorepo pnpm workspaces con microservicios NestJS + app React Native (Android).

```
apps/
  authorization-service/   # Consume auth.requests desde Kafka, lógica de negocio, publica auth.response.{store_id}
  sse-server/              # Suscribe Redis pub/sub, emite SSE hacia el BFF
  bff/                     # Backend for Frontend: proxy SSE + REST API para la app móvil
  mobile/                  # React Native (Android) — app del supervisor (pendiente de bootstrap)

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

## Stack

| Capa | Tecnología |
|---|---|
| App móvil | React Native (Android primero) + TypeScript |
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

# ─────────────────────────────────────────────────────────────────────────────

# Instalar dependencias (ya lo hace setup-android.sh; correr manualmente si se clona sin el script)
pnpm install

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
[feature/login-google]
[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect → validar viabilidad
[ ] 3/6 QA (RED) -> tests que fallan
[ ] 4/6 Backend -> implementar
[ ] 5/6 QA (GREEN) -> suite completa
[ ] 6/6 Cierre -> close.md

[bugfix/sse]
[▶] 1/5 Triage -> confirmar error
[ ] 2/5 Reproducir -> test que falla
[ ] 3/5 Fix -> corregir
[ ] 4/5 Verify -> tests + typecheck
[ ] 5/5 Cierre -> close.md
```

### Claude Code hooks

El pre-command hook en `.claude/settings.json` ejecuta `.opencode/pipeline/check.sh` antes de cada comando bash. Si no hay pipeline activo, bloquea comandos destructivos.

### Git pre-commit hook (cuando exista repo)

```bash
# Una vez que exista .git:
git init
git config core.hooksPath .opencode/pipeline
```

El script `.opencode/pipeline/pre-commit.sh` rechaza commits si el pipeline está en progreso (paso < 6/6).

### Actualización del spec al cierre

Al completar la implementación de un spec (siguiendo `close.md`):

1. En `spec/`:
   - Marcar `[x]` los criterios de aceptación completados
   - Agregar una sección `## Resultado` al final con:
     - Fecha de finalización
     - Resumen de lo implementado vs lo planeado
     - Desviaciones respecto al spec original (si las hay)
   - Cambiar el status del spec de `draft` a `completed`
2. El spec queda como registro histórico de lo planeado vs lo entregado.

Formato de la sección `## Resultado`:

```markdown
## Resultado

**Fecha de finalización:** YYYY-MM-DD
**Status del spec:** completed

### Implementado
- [x] US-01: ...
- [x] US-02: ...

### No implementado / Desviaciones
- US-03: no se implementó porque ...

### Tests
- Unitarios: 12/12 pasando
- Integración: 3/3 pasando
- E2E: no aplica
```

### Pipeline bugfix (pasos simplificados)

```
1. triage                → confirmar el bug, recolectar evidencias (logs, stacks)
2. reproducir            → escribir test que reproduzca el bug (falla en rojo)
3. architect (opcional)  → si el fix requiere cambios arquitecturales
4. fix                   → implementar la corrección
5. verify                → correr suite completa + typecheck
6. cierre                → entrada en LEARNINGS.md si aplica
```

### Cierre automático (close-agent)

Al marcar el último todo de un scope como `completed`, el **agente debe ejecutar inmediatamente** las instrucciones de `.opencode/pipeline/close.md`. Este checklist cubre:

1. Actualizar spec si existe
2. Entrada en LEARNINGS.md
3. Revisar si CLAUDE.md necesita actualización
4. Limpiar close-pending
5. Anunciar cierre

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
- **Variables de entorno**: backend via `ConfigModule` NestJS; mobile via `react-native-config`.
- **Módulos NestJS**: cada feature es un módulo; el binding port → adapter va en el module, no en los use-cases.
