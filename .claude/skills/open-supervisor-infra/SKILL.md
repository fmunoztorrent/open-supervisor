---
name: open-supervisor-infra
description: Experto en gestionar la infraestructura de desarrollo y servicios backend del proyecto open-supervisor. TRIGGER cuando el usuario menciona: levantar servicios, Podman, Docker, Kafka, Redis, Zookeeper, contenedores, authorization-service, sse-server, bff, puertos, compilar servicios, inyectar solicitudes, consumer group, TSBuildInfo, tsbuildinfo, nest build, pnpm inject, infra, infraestructura, servicios caídos, LAG Kafka, Metro bundler, build falla.
---

# open-supervisor-infra

Manual de referencia y operación de la infraestructura de desarrollo de open-supervisor. Cubre contenedores, compilación y arranque de servicios NestJS, inyección de solicitudes de prueba y diagnóstico de Kafka.

> **Agnóstico de máquina:** este skill **no asume rutas absolutas** de ninguna máquina. Todo se deriva de `git` (raíz del repo), del `docker-compose.yml` del repo y del motor de contenedores instalado. Funciona para cualquier desarrollador que clone el proyecto y corra `setup-android.sh`. Para validar la app en el emulador, ver el skill hermano **`open-supervisor-emulator`**.

**Filosofía:** En desarrollo, los servicios se lanzan como procesos Node compilados (`node dist/main`), no con `nest start --watch`. Esto evita interferencias del watcher y hace el comportamiento idéntico al de producción. El stack de contenedores (Zookeeper + Kafka + Redis) se gestiona con `compose`, detectando automáticamente el motor disponible (Podman preferido, Docker como fallback).

---

## Bootstrap del entorno (portable — correr una vez por sesión)

Antes de cualquier comando de este skill, establecer estas variables. Definen la raíz del repo y el motor de contenedores **sin hardcodear rutas**:

```bash
# Raíz del repo (funciona desde cualquier subdirectorio)
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Motor de contenedores: Podman preferido, Docker como fallback
if command -v podman >/dev/null 2>&1; then
  ENGINE=podman
  # En macOS Podman corre en una VM; resolver su socket si DOCKER_HOST no está seteado
  if [ -z "${DOCKER_HOST:-}" ] && podman machine inspect >/dev/null 2>&1; then
    SOCK="$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}' 2>/dev/null)"
    [ -n "$SOCK" ] && export DOCKER_HOST="unix://$SOCK"
  fi
elif command -v docker >/dev/null 2>&1; then
  ENGINE=docker
fi
COMPOSE="$ENGINE compose"

# Verificación rápida
echo "REPO_ROOT=$REPO_ROOT  ENGINE=$ENGINE  DOCKER_HOST=${DOCKER_HOST:-<default>}"
```

**Notas:**
- Los comandos `compose` se ejecutan desde `$REPO_ROOT` (donde vive `docker-compose.yml`).
- Se referencian los contenedores **por nombre de servicio** (`kafka`, `redis`, `zookeeper`) vía `$COMPOSE exec`, NO por nombre de contenedor (`open-supervisor-kafka-1`), porque el prefijo de proyecto depende del nombre del directorio de clonado y no es portable.
- Si `$DOCKER_HOST` queda vacío y Podman está instalado en macOS, ver **E-5**.

---

## Routing

Parsea `$ARGUMENTS`:

| Argumento | Acción |
|---|---|
| `status` o vacío | **[status]** — estado completo del stack |
| `up` | **[up]** — levantar contenedores y servicios |
| `down` | **[down]** — bajar todo |
| `restart <servicio>` | **[restart]** — reiniciar un servicio específico |
| `inject <...>` | **[inject]** — inyectar solicitud de prueba |
| `kafka <...>` | **[kafka]** — comandos Kafka (LAG, reset, inspect) |
| `build <servicio>` | **[build]** — compilar un servicio |
| `logs <servicio>` | **[logs]** — ver logs en vivo |
| `validate-tf` | **[validate-tf]** — validar módulos Terraform (network + ecr) contra LocalStack |

---

## Mapa de puertos

| Componente | Puerto | Tipo |
|---|---|---|
| Zookeeper | 2181 | Contenedor (servicio `zookeeper`) |
| Kafka | 9092 | Contenedor (servicio `kafka`) |
| Redis | 6379 | Contenedor (servicio `redis`) |
| authorization-service | 3001 | Proceso Node |
| sse-server | 3002 | Proceso Node |
| bff | 3000 | Proceso Node |

---

## [status] — Estado completo del stack

> Requiere el **Bootstrap del entorno** ejecutado (`$REPO_ROOT`, `$COMPOSE`).

Ejecuta todos estos checks en orden y reporta cada uno:

### 1. Contenedores

```bash
cd "$REPO_ROOT" && $COMPOSE ps
```

Estado esperado: tres servicios `Up` — `zookeeper`, `kafka`, `redis`.

### 2. Servicios Node en puertos

```bash
lsof -i :3000 -i :3001 -i :3002 -P | grep LISTEN
```

Debe aparecer un proceso `node` en cada puerto.

### 3. Health del BFF

```bash
curl -s http://localhost:3000/authorization/store/store-1/pending
```

Respuesta esperada: `[]` o array con solicitudes. Si responde, el pipeline BFF → authorization-service está sano.

### 4. Kafka LAG

```bash
cd "$REPO_ROOT" && $COMPOSE exec -T kafka \
  kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group authorization-service-group --describe
```

`LAG = 0` → consumer al día. `LAG > 0` → mensajes sin procesar.

---

## [up] — Levantar contenedores y servicios

> Requiere el **Bootstrap del entorno** ejecutado.

### Paso 1 — Contenedores

```bash
cd "$REPO_ROOT" && $COMPOSE up -d
```

**GATE:** Los tres servicios muestran `Up`. Kafka tarda 15-30s en pasar a `healthy`.

### Paso 2 — Compilar paquetes compartidos (primer arranque o tras cambios)

```bash
cd "$REPO_ROOT/packages/shared-types" && node_modules/.bin/tsc
cd "$REPO_ROOT/packages/shared-messaging" && node_modules/.bin/tsc
```

### Paso 3 — Compilar y arrancar authorization-service

```bash
cd "$REPO_ROOT/apps/authorization-service"
rm -f tsconfig.tsbuildinfo
node_modules/.bin/nest build
node dist/main > /tmp/auth-service.log 2>&1 &
```

### Paso 4 — Compilar y arrancar sse-server

```bash
cd "$REPO_ROOT/apps/sse-server"
rm -f tsconfig.tsbuildinfo
node_modules/.bin/nest build
node dist/main > /tmp/sse-server.log 2>&1 &
```

### Paso 5 — Compilar y arrancar bff

```bash
cd "$REPO_ROOT/apps/bff"
rm -f tsconfig.tsbuildinfo
node_modules/.bin/nest build
node dist/main > /tmp/bff.log 2>&1 &
```

### Paso 6 — Verificación final

Ejecutar **[status]** completo.

---

## [down] — Bajar todo

### Servicios Node

```bash
lsof -i :3000 -i :3001 -i :3002 -P | grep LISTEN
# Para cada PID:
kill -9 <pid>
```

### Contenedores

```bash
cd "$REPO_ROOT" && $COMPOSE down
```

---

## [restart] — Reiniciar un servicio

| Servicio | Puerto |
|---|---|
| authorization-service | 3001 |
| sse-server | 3002 |
| bff | 3000 |

```bash
# Matar proceso actual
lsof -i :<puerto> -P | grep LISTEN
kill -9 <pid>

# Identificar ghost (si el puerto sigue ocupado tras kill)
lsof -p <pid> | grep cwd   # Si el cwd es inesperado, es un ghost

# Relanzar
cd "$REPO_ROOT/apps/<servicio>"
node dist/main > /tmp/<servicio>.log 2>&1 &
```

---

## [build] — Compilar un servicio

```bash
cd "$REPO_ROOT/apps/<servicio>"

# SIEMPRE limpiar tsbuildinfo antes de compilar
rm -f tsconfig.tsbuildinfo

node_modules/.bin/nest build

# Verificar que dist/main.js existe
ls -la dist/main.js
```

**GATE:** Si `dist/main.js` no existe o tiene fecha vieja → el build falló silenciosamente. Ver E-1.

---

## [inject] — Inyectar solicitud de prueba

Ejecutar desde la raíz del repo:

```bash
cd "$REPO_ROOT"
```

### Tipos de solicitud y parámetros requeridos

| Tipo | Comando |
|---|---|
| DISCOUNT | `pnpm inject --type DISCOUNT --store-id store-1 --pos-id pos-1` |
| CANCEL | `pnpm inject --type CANCEL --store-id store-1 --pos-id pos-3` |
| SUSPEND | `pnpm inject --type SUSPEND --store-id store-1 --pos-id pos-4` |
| PRICE_CHANGE | `pnpm inject --type PRICE_CHANGE --store-id store-1 --pos-id pos-2 --product-id SKU-1 --original-price 400 --requested-price 160` |
| EMPLOYEE_BENEFIT | `pnpm inject --type EMPLOYEE_BENEFIT --store-id store-1 --pos-id pos-emp --employee-id EMP-001` |

**Reglas de dominio para PRICE_CHANGE:**
- `requested_price >= 150` (mínimo absoluto) — por debajo lanza `MinimumPriceViolationError`
- `|diff|/original_price <= 50%` → WITHIN_LIMIT (auto-aprobado, no llega al supervisor)
- `|diff|/original_price > 50%` → EXCEEDS_LIMIT (auto-rechazado por SYSTEM, publica a Kafka pero no queda pendiente en app)
- Para que aparezca como pendiente en el supervisor, usar DISCOUNT o CANCEL.

**Flags útiles:**
- `--verify` → espera confirmación vía SSE (requiere BFF corriendo)
- `--verbose` → muestra configuración activa (brokers, BFF URL)

---

## [kafka] — Comandos Kafka

> Requiere el **Bootstrap del entorno** ejecutado. Todos los `exec` usan el nombre de servicio `kafka`.

### Ver LAG del consumer group

```bash
cd "$REPO_ROOT" && $COMPOSE exec -T kafka \
  kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group authorization-service-group --describe
```

### Ver miembros activos

```bash
cd "$REPO_ROOT" && $COMPOSE exec -T kafka \
  kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group authorization-service-group --describe --members
```

Si algún miembro tiene `#PARTITIONS = 0` → es un ghost. Ver E-4.

### Resetear offsets al último mensaje

Requiere que NO haya miembros activos (matar todos los consumers del grupo primero).

```bash
cd "$REPO_ROOT" && $COMPOSE exec -T kafka \
  kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group authorization-service-group \
  --topic auth.requests \
  --reset-offsets --to-latest --execute
```

### Inspeccionar mensajes en un topic

```bash
# Solicitudes recibidas
cd "$REPO_ROOT" && $COMPOSE exec -T kafka \
  kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic auth.requests --from-beginning --max-messages 10 --timeout-ms 3000

# Respuestas enviadas al POS
cd "$REPO_ROOT" && $COMPOSE exec -T kafka \
  kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic auth.response.store-1 --from-beginning --max-messages 10 --timeout-ms 3000
```

**Fallback** si `$COMPOSE exec` no resuelve el servicio en tu versión de compose:

```bash
KAFKA_CTN="$(cd "$REPO_ROOT" && $COMPOSE ps -q kafka)"
$ENGINE exec "$KAFKA_CTN" kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group authorization-service-group --describe
```

---

## [logs] — Ver logs en vivo

```bash
tail -f /tmp/auth-service.log    # authorization-service
tail -f /tmp/sse-server.log      # sse-server
tail -f /tmp/bff.log             # bff
```

---

## Errores conocidos y soluciones

### E-1: `nest build` sale 0 pero `dist/` no se crea

**Causa:** `incremental: true` en `tsconfig.base.json` + `.tsbuildinfo` corrupto. TypeScript cree que no hay cambios y no emite.

**Solución:**
```bash
rm -f tsconfig.tsbuildinfo
node_modules/.bin/nest build
```

---

### E-2: `nest build` falla con errores TypeScript en archivos `*.spec.ts`

**Causa:** El servicio no tiene `tsconfig.build.json`. Sin él, `nest build` usa el `tsconfig.json` base que incluye los spec files.

**Solución:** Crear `apps/<servicio>/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

---

### E-3: Puerto en uso — `EADDRINUSE`

**Solución:**
```bash
lsof -i :<puerto> -P | grep LISTEN
kill -9 <pid>

# Si el PID no es el servicio esperado, inspeccionar:
lsof -p <pid> | grep cwd
```

---

### E-4: Ghost consumer en Kafka — nuevo consumer no recibe mensajes

**Síntoma:** `memberAssignment: {}` para el consumer activo. LAG crece aunque el proceso está corriendo.

**Causa:** Proceso matado con `kill -9`. Kafka mantiene la sesión del miembro muerto hasta el session timeout (~30s).

**Diagnóstico:**
```bash
# Si aparece un miembro con #PARTITIONS=0 → ghost
cd "$REPO_ROOT" && $COMPOSE exec -T kafka \
  kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group authorization-service-group --describe --members
```

**Solución:** Matar todos los consumers, esperar 35s, resetear offsets, relanzar:
```bash
kill -9 <pid-del-authorization-service>
# esperar 35s para que Kafka expire la sesión del ghost
cd "$REPO_ROOT" && $COMPOSE exec -T kafka \
  kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group authorization-service-group \
  --topic auth.requests --reset-offsets --to-latest --execute
cd "$REPO_ROOT/apps/authorization-service"
node dist/main > /tmp/auth-service.log 2>&1 &
```

**REGLA:** Solo una instancia del `authorization-service` debe correr. Múltiples instancias causan split de particiones.

---

### E-5: `$DOCKER_HOST` vacío / socket de contenedores no encontrado

El **Bootstrap del entorno** resuelve el socket automáticamente cuando Podman está instalado en macOS. Si aun así queda vacío o el motor no responde:

**Podman (macOS):** la VM debe estar corriendo.
```bash
podman machine start
# Re-correr el bloque de Bootstrap para re-exportar DOCKER_HOST
```

**Podman (Linux):** el socket suele estar en el bus de usuario; normalmente no hace falta `DOCKER_HOST`. Si lo necesitás:
```bash
export DOCKER_HOST="unix://${XDG_RUNTIME_DIR}/podman/podman.sock"
```

**Docker:** no requiere `DOCKER_HOST`; `docker compose` usa el socket por defecto.

---

### E-6: Metro bundler para la app móvil

```bash
cd "$REPO_ROOT/apps/mobile"
pnpm start --reset-cache
```

Esperar a `Metro waiting on...`. La app actual corre desde JS bundleado — Metro solo es necesario para el proceso de build/debug inicial o reinstalación. Para validar la app en el emulador, ver el skill **`open-supervisor-emulator`**.

---

## [validate-tf] — Validar módulos Terraform contra LocalStack

Valida los módulos `network` y `ecr` de `infra/terraform/` usando LocalStack Community Edition. Los módulos restantes (ALB, RDS, ElastiCache Serverless, MSK Serverless, ECS) requieren LocalStack Pro o tienen soporte mínimo.

> Requiere el **Bootstrap del entorno** ejecutado y `terraform` en el PATH.

### Uso rápido (todo en uno)

```bash
cd "$REPO_ROOT"
bash scripts/validate-tf-localstack.sh
```

El script:
1. Detecta el motor de contenedores (Podman/Docker)
2. Levanta LocalStack si no está corriendo (`docker-compose.localstack.yml`)
3. Corre `terraform init` + `terraform validate` + `terraform plan` en `infra/terraform/localstack/`
4. Reporta PASS/FAIL con salida coloreada
5. Guarda el plan en `infra/terraform/localstack/localstack.tfplan`

### Con cleanup (destruir estado de LocalStack al terminar)

```bash
bash scripts/validate-tf-localstack.sh --clean
```

### Levantar solo LocalStack (sin validar)

```bash
cd "$REPO_ROOT"
$COMPOSE -f docker-compose.yml -f docker-compose.localstack.yml up -d localstack

# Verificar servicios activos
curl -s http://localhost:4566/_localstack/health | python3 -m json.tool
```

### Correr pasos manualmente

```bash
cd "$REPO_ROOT/infra/terraform/localstack"
terraform init -reconfigure
terraform validate
terraform plan
```

### Módulos cubiertos vs. no cubiertos

| Módulo | LocalStack Community | Alternativa |
|---|---|---|
| `network` (VPC, SGs, NAT) | Completo | — |
| `ecr` (repos + lifecycle) | Completo | — |
| `alb` | Pro | `terraform plan` contra AWS sandbox |
| `rds` | Pro (sin Multi-AZ) | `terraform plan` contra AWS sandbox |
| `elasticache` (Serverless) | Limitado | `terraform plan` contra AWS sandbox |
| `msk` (Serverless) | Muy limitado | `terraform plan` contra AWS sandbox |
| `ecs` (Fargate) | Pro | `terraform plan` contra AWS sandbox |

---

## Convenciones operativas

- **Nunca** usar `pnpm dev` / `nest start --watch` en validación. Usar `node dist/main`.
- **Siempre** limpiar `tsconfig.tsbuildinfo` antes de compilar.
- **Solo una instancia** de cada servicio debe correr.
- El consumer group `authorization-service-group` es exclusivo del `authorization-service`.
- `.env` por defecto (ver `.env.example` en la raíz): Kafka en `localhost:9092`, Redis en `localhost:6379`.
- Referenciar contenedores por **nombre de servicio** (`kafka`/`redis`/`zookeeper`) vía `$COMPOSE exec`, nunca por nombre de contenedor con prefijo de proyecto.
