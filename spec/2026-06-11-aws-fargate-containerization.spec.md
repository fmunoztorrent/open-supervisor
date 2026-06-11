# Spec: AWS Fargate Containerization for Backend Services

**Fecha:** 2026-06-11  
**Stack inferido:** Node.js 22 + NestJS + pnpm monorepo → AWS (ECR + ECS Fargate + ALB + VPC + SSM)  
**Estado:** Draft  
**Revisión:** 2  

<history>
  <entry revision="1" date="2026-06-11" author="spec-generator">
    Initial spec with 7 USTs: Dockerfiles (US-01), Health endpoints (US-02), ECR repos (US-03),
    ECS Fargate tasks (US-04), VPC networking (US-05), SSM params (US-06), CI/CD pipeline (US-07).
    Includes REASONS Canvas, Gherkin scenarios, TDD test plan, and dependencies table.
  </entry>
  <entry revision="2" date="2026-06-11" author="architect">
    Architect review — GO with 2 critical corrections applied:
    - C1: Node.js 22 → 24 Alpine (consistencia con .nvmrc y CI)
    - C2: Dockerfile pattern updated to pnpm deploy --prod (resuelve workspace:* nativamente)
    - US-04 dependencies updated: US-03 → US-03, US-06 (task defs refieren SSM params)
    - Enriched file paths (test specs, validate scripts, edge cases)
    - Risk register expanded (R1-R7)
    - Added edge cases EC1-EC6 (multi-arch, Kafka rebalance, CI cache, cold start, SSM throttling)
    - Multi-scope decomposition confirmed: 5 scopes capa 1, 1 capa 2, 1 capa 3
  </entry>
</history>

---

## Contexto

open-supervisor runs 3 NestJS backend services locally via `pnpm --filter <service> dev`. To deploy to AWS, these services must be containerized with production-grade Dockerfiles, pushed to ECR, and orchestrated via ECS Fargate. The mobile app (`apps/mobile`) is excluded — it deploys via Google Play.

The monorepo structure (pnpm workspaces) requires that shared packages (`shared-types`, `shared-messaging`) are compiled before any service can build. This must be handled inside the Docker build with proper layer caching to avoid full reinstalls on every CI run.

**Out of scope:** Kafka (MSK) and Redis (ElastiCache) provisioning, Terraform/Pulumi IaC, production monitoring beyond CloudWatch Logs, TLS certificates / domain names, mobile app containerization, RDS/Postgres provisioning.

**Ambigüedades identificadas:**
- **Resuelto por architect:** Usar `pnpm deploy --prod` (pnpm ≥8, CI usa v11). Este comando resuelve nativamente los `workspace:*` packages como copias planas en `node_modules/`, eliminando el riesgo de symlinks rotos en el stage de producción. No se usa fallback manual.
- ECS inter-service communication: whether to use ECS Service Connect (Cloud Map) or an internal ALB. This spec assumes Service Connect (simpler, no extra ALB cost), but documents the ALB alternative.
- The CI/CD workflow should use OpenID Connect (OIDC) for AWS authentication rather than long-lived IAM user credentials, but OIDC setup requires the AWS account ID and GitHub org/repo — placeholders will be used.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    open-supervisor has no cloud deployment path. The 3 backend services run only
    in local development via nest start --watch. To onboard real stores and supervisors,
    the backend must run on AWS infrastructure. Containerization is the first
    prerequisite: without Docker images, nothing can be deployed. Fargate is chosen
    over EC2 because it eliminates node management, auto-scales, and integrates
    natively with ECR, SSM, and CloudWatch — all AWS services the project will
    need regardless of compute choice.
  </Rationale>
  <Explanation>
    Multi-stage Dockerfiles (build → production) produce minimal images (~150 MB
    each vs. ~600 MB with dev dependencies). The monorepo build caches pnpm store
    and node_modules in Docker layers: package.json files are copied first, then
    pnpm install runs only when dependencies change. Shared packages are compiled
    with tsc before the service build. The CI/CD pipeline (GitHub Actions) builds
    images on push to main, pushes to ECR, and deploys to ECS with rolling updates.
    ECS Fargate tasks run in private subnets; only the BFF is exposed via a public
    Application Load Balancer. Environment configuration is externalized to AWS
    SSM Parameter Store and Secrets Manager — no .env files in the image.
  </Explanation>
  <Assumptions>
    - An AWS account exists with permissions to create ECR repos, ECS clusters,
      VPCs, ALBs, SSM parameters, and IAM roles.
    - Kafka (MSK or self-managed on EC2) and Redis (ElastiCache) are provisioned
      separately and their endpoints are known at deploy time.
     - Node.js 24 Alpine is compatible with all dependencies (kafkajs, ioredis,
       drizzle-orm, pg, @nestjs/*). No native modules requiring build tools in
       the production stage are expected. Verified via `.nvmrc` (24) and CI (ci.yml uses node-version: 24).
    - The CI/CD GitHub Actions runner has docker buildx available (ubuntu-latest
      includes it by default).
    - The project will use a single ECS cluster for all 3 services (staging
      environment first; production cluster later).
  </Assumptions>
  <Scrutiny>
    Why Fargate and not App Runner or Lambda? Fargate is the right balance:
    App Runner is simpler but lacks VPC integration for Kafka/Redis access.
    Lambda is unsuitable for long-running SSE connections and Kafka consumers
    (15-minute timeout). Fargate gives container-level control + VPC-native
    networking without managing EC2 instances.
    Why multi-stage Docker and not a single pnpm deploy stage? Multi-stage
    separates build-time dependencies (@nestjs/cli, typescript, ts-jest) from
    runtime dependencies, reducing image size by ~60% and attack surface.
    Why pnpm and not npm? The project already uses pnpm workspaces; switching
    to npm would require lockfile migration and potential breakage.
  </Scrutiny>
  <Objections>
    - "Containerizing a monorepo with pnpm is complex." — True, but the layer
      caching pattern (copy package.json → install → copy source → build) is
      well-established and documented. The complexity is front-loaded in the
      Dockerfile; once built, it rarely changes.
    - "CI/CD + ECS is overkill for a pre-production project." — The alternative
      (manual docker build + push + ecs update-service) is error-prone and
      unsustainable beyond 2-3 deployments. CI/CD pays for itself quickly.
  </Objections>
  <Novelty>
    First containerization of any open-supervisor service. Introduces the
    multi-stage monorepo Docker pattern, the ECS Fargate compute model, and
    the GitHub Actions → ECR → ECS deployment pipeline. Establishes the
    foundation for all future cloud infrastructure (auto-scaling, multi-AZ,
    blue/green deployments).
  </Novelty>
  <Substitutes>
    - AWS App Runner: simpler (no VPC, no ECS), but cannot access Kafka in a
      VPC without VPC connector (adds latency and cost). Rejected.
    - AWS Lambda + API Gateway: unsuitable for SSE (30s API Gateway timeout)
      and Kafka consumers (need persistent connections). Rejected.
    - EC2 + Docker Compose: requires AMI management, patching, and scaling
      logic. Fargate eliminates all of this. Rejected.
    - Kubernetes (EKS): more powerful but 10x operational complexity. Premature
      for 3 services. Rejected.
    - Google Cloud Run: would work technically, but the team is standardizing
      on AWS. Rejected for consistency.
    - Docker Swarm: not a managed AWS service; requires EC2 cluster management.
      Rejected.
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: Multi-stage Dockerfiles for 3 backend services `[Must]`

> Como **desarrollador de infraestructura**, quiero **Dockerfiles multi-stage para authorization-service, sse-server y bff**, para que **cada servicio se compile con sus dependencias de monorepo y produzca una imagen de producción mínima**.

**Criterios de aceptación:**
- [ ] `apps/authorization-service/Dockerfile` — multi-stage (deps → build → production), Node.js 24 Alpine, compila `shared-types` + `shared-messaging` antes de `nest build`
- [ ] `apps/sse-server/Dockerfile` — mismo patrón, compila `shared-messaging` antes de `nest build`
- [ ] `apps/bff/Dockerfile` — mismo patrón, compila `shared-types` antes de `nest build`
- [ ] `.dockerignore` en la raíz del monorepo excluye `node_modules`, `dist`, `.git`, `apps/mobile`, `coverage`, `spec/`, `collections/`
- [ ] `docker build -f apps/<service>/Dockerfile .` desde la raíz produce una imagen funcional (verificable con `docker run` + curl al health endpoint)

**Notas:** El contexto de build es la raíz del monorepo (`.`) porque pnpm necesita `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json` y los packages compartidos. El patrón de capas de caché copia primero `package.json` + `pnpm-lock.yaml` + `pnpm-workspace.yaml`, luego `pnpm install --frozen-lockfile`, luego el código fuente, y finalmente compila. La imagen final solo incluye `dist/` + `node_modules` de producción (sin `devDependencies`). El `CMD` debe ser `["node", "dist/main.js"]`.

---

### US-02: Health check endpoints for all services `[Must]`

> Como **orquestador ECS**, quiero **que cada servicio exponga un endpoint GET /health**, para que **Fargate pueda verificar que el contenedor está vivo y reiniciarlo si falla**.

**Criterios de aceptación:**
- [ ] `GET /health` en authorization-service responde `{ status: "ok", service: "authorization-service", timestamp }` con HTTP 200
- [ ] `GET /health` en sse-server responde `{ status: "ok", service: "sse-server", timestamp }` con HTTP 200
- [ ] `GET /health` en bff responde `{ status: "ok", service: "bff", timestamp }` con HTTP 200
- [ ] Tests unitarios verifican que cada endpoint retorna 200 (usando `supertest` o `@nestjs/testing`)
- [ ] El módulo de health se registra en el `AppModule` de cada servicio como `HealthModule`

**Notas:** El health check es un check de **liveness**, no de **readiness**. No verifica conexiones a Kafka, Redis ni Postgres — eso sería un readiness check que requiere `@nestjs/terminus` y está fuera de scope para este spec. El endpoint debe ser ligero (sin consultas a base de datos) y responder en <50ms. Se implementa como un `HealthController` en `src/health/` con su `HealthModule`. El prefijo de ruta es raíz (`/health`, no `/api/health`).

---

### US-03: ECR repositories for each service `[Must]`

> Como **pipeline CI/CD**, quiero **tres repositorios ECR (uno por servicio) en AWS**, para que **las imágenes Docker puedan almacenarse y versionarse antes del deploy a ECS**.

**Criterios de aceptación:**
- [ ] Repositorio ECR `open-supervisor/authorization-service` creado en `us-east-1` (o región configurable)
- [ ] Repositorio ECR `open-supervisor/sse-server` creado
- [ ] Repositorio ECR `open-supervisor/bff` creado
- [ ] Tag immutability habilitado (`imageTagMutability: IMMUTABLE`) para evitar sobrescritura de tags
- [ ] Política de ciclo de vida: retener máximo 20 imágenes por repositorio (limpia builds antiguas)
- [ ] IAM role `github-actions-ecr-push` con permisos `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:CompleteLayerUpload`, `ecr:PutImage`

**Notas:** Los repositorios se crean una vez (no en cada deploy). Esto puede hacerse manualmente vía AWS Console, CloudFormation, o un script `scripts/aws/create-ecr-repos.sh`. El spec incluye un script de referencia pero no requiere CloudFormation. La región por defecto es `us-east-1`, configurable vía variable `AWS_REGION`. La política de ciclo de vida mantiene las últimas 20 imágenes con tag `latest` o `sha-*`; las imágenes sin tag o con tag `pr-*` se limpian después de 7 días.

---

### US-04: ECS Fargate Task Definitions and Services `[Must]`

> Como **operador de infraestructura**, quiero **definiciones de tarea ECS Fargate para cada servicio backend**, para que **AWS pueda ejecutar los contenedores en la nube con los recursos adecuados**.

**Criterios de aceptación:**
- [ ] Task definition `authorization-service` — 0.5 vCPU, 1 GB RAM, puerto 3001, variables de entorno desde SSM
- [ ] Task definition `sse-server` — 0.25 vCPU, 512 MB RAM, puerto 3002, variables de entorno desde SSM
- [ ] Task definition `bff` — 0.25 vCPU, 512 MB RAM, puerto 3000, variables de entorno desde SSM
- [ ] Cada task definition configura `awslogs` driver para CloudWatch Logs (grupo `/ecs/<service-name>`)
- [ ] ECS Service para cada task definition, corriendo en el cluster `open-supervisor`, subredes privadas
- [ ] IAM Role `ecs-task-execution` con permisos para `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `logs:CreateLogStream`, `logs:PutLogEvents`, `ssm:GetParameters`

**Notas:** Las task definitions se definen como JSON o CloudFormation. El spec incluye archivos JSON de referencia en `infra/ecs/task-definitions/`. No requieren CloudFormation para ser válidas. La CPU y memoria son valores iniciales conservadores — se ajustarán con métricas reales. El `authorization-service` recibe más recursos porque ejecuta lógica de negocio, consultas a AD, y es el consumidor Kafka. El `networkMode` es `awsvpc` (obligatorio en Fargate). Las tasks NO reciben IP pública (`assignPublicIp: DISABLED`) — usan NAT Gateway para acceder a ECR y SSM.

---

### US-05: VPC Networking and Security Groups `[Must]`

> Como **arquitecto de red**, quiero **una VPC con subredes públicas/privadas y security groups**, para que **los servicios backend se comuniquen de forma segura y solo el BFF esté expuesto a internet**.

**Criterios de aceptación:**
- [ ] VPC `open-supervisor-vpc` con CIDR `10.0.0.0/16`, región `us-east-1`
- [ ] 2 subredes públicas (`10.0.1.0/24`, `10.0.2.0/24`) en AZs distintas para el ALB
- [ ] 2 subredes privadas (`10.0.3.0/24`, `10.0.4.0/24`) para las tareas ECS
- [ ] NAT Gateway en una subred pública para que las tareas privadas accedan a ECR, SSM y CloudWatch
- [ ] Security Group `alb-sg`: permite inbound HTTP (80) desde `0.0.0.0/0`
- [ ] Security Group `bff-sg`: permite inbound desde `alb-sg` en puerto 3000
- [ ] Security Group `sse-server-sg`: permite inbound desde `bff-sg` en puerto 3002
- [ ] Security Group `auth-service-sg`: permite inbound desde `bff-sg` en puerto 3001
- [ ] Application Load Balancer `open-supervisor-alb` en subredes públicas, target group apuntando al ECS Service del BFF (puerto 3000)

**Notas:** Esta configuración es el minimum viable para staging. Producción necesitaría multi-AZ NAT Gateways para alta disponibilidad. El ALB solo expone el BFF; el sse-server se accede a través del BFF (proxy). El `authorization-service` no recibe tráfico HTTP del ALB — solo recibe requests del BFF vía Service Connect (o dirección IP privada). Los security groups se definen como infraestructura; el spec incluye un diagrama de referencia y archivos CloudFormation/JSON en `infra/network/`.

---

### US-06: Environment Configuration via SSM Parameter Store `[Must]`

> Como **operador de seguridad**, quiero **que las variables de entorno sensibles se almacenen en AWS SSM Parameter Store**, para que **no estén hardcodeadas en imágenes Docker ni en archivos de configuración**.

**Criterios de aceptación:**
- [ ] SSM Parameter `/open-supervisor/staging/KAFKA_BROKER` (String, valor placeholder)
- [ ] SSM Parameter `/open-supervisor/staging/REDIS_HOST` (String)
- [ ] SSM Parameter `/open-supervisor/staging/REDIS_PORT` (String, default `6379`)
- [ ] SSM Parameter `/open-supervisor/staging/DATABASE_URL` (SecureString, valor placeholder)
- [ ] SSM Parameter `/open-supervisor/staging/SSE_SERVER_URL` (String, e.g. `http://sse-server.open-supervisor.local:3002`)
- [ ] SSM Parameter `/open-supervisor/staging/AUTH_SERVICE_URL` (String, e.g. `http://authorization-service.open-supervisor.local:3001`)
- [ ] SSM Parameter `/open-supervisor/staging/KEYCLOAK_URL` (String)
- [ ] SSM Parameter `/open-supervisor/staging/KEYCLOAK_REALM` (String)
- [ ] SSM Parameter `/open-supervisor/staging/KEYCLOAK_CLIENT_ID` (String)
- [ ] Secrets Manager secret `/open-supervisor/staging/KEYCLOAK_CLIENT_SECRET` (SecureString)
- [ ] IAM Role `ecs-task-execution` tiene permiso `ssm:GetParameters` y `secretsmanager:GetSecretValue`

**Notas:** Los valores reales se completan después de provisionar Kafka (MSK), Redis (ElastiCache) y Postgres (RDS). Para el MVP, se usan placeholders. Los parámetros siguen la jerarquía `/open-supervisor/<environment>/<variable>` para permitir múltiples entornos (staging, production). `KEYCLOAK_CLIENT_SECRET` se almacena en Secrets Manager (no SSM) porque es una credencial que requiere rotación. Las task definitions de ECS referencian estos parámetros en la sección `secrets` del contenedor.

---

### US-07: GitHub Actions CI/CD Pipeline `[Must]`

> Como **desarrollador**, quiero **que cada push a main buildee las imágenes Docker, las pushee a ECR y despliegue a ECS**, para que **el deploy sea automático, repetible y auditable**.

**Criterios de aceptación:**
- [ ] Workflow `.github/workflows/deploy.yml` con trigger en `push` a `main` y `workflow_dispatch` (manual)
- [ ] Job `build-and-push`: build de las 3 imágenes Docker con `docker buildx`, tag con `sha-${GITHUB_SHA::7}` y `latest`, push a ECR
- [ ] Job `deploy`: actualiza los 3 ECS services con `aws ecs update-service --force-new-deployment` usando la imagen del paso anterior
- [ ] Autenticación AWS vía OpenID Connect (OIDC): GitHub Actions asume un IAM Role sin usar access keys
- [ ] Timeout máximo por job: 20 minutos
- [ ] Notificación de éxito/fallo en el summary del workflow run (no se requiere integración con Slack/Discord en este spec)

**Notas:** El workflow usa `docker buildx` con cache `type=gha` (GitHub Actions cache) para acelerar builds subsecuentes. Las imágenes de los 3 servicios se buildean en paralelo (`matrix` strategy) para reducir el tiempo total. El deploy a ECS es secuencial (no en paralelo) para evitar que un deploy parcial deje el sistema en estado inconsistente — aunque los servicios son independientes, el orden bff → sse-server → authorization-service minimiza el riesgo. Si el workflow falla en cualquiera de los jobs, los servicios existentes siguen corriendo (no hay rollback automático — se hará manualmente con `aws ecs update-service --task-definition <previous-arn>`).

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|-----|-----------|-----------------|
| US-01 | — | sí (capa 1) |
| US-02 | — | sí (capa 1) |
| US-03 | — | sí (capa 1) |
| US-05 | — | sí (capa 1) |
| US-06 | — | sí (capa 1) |
| US-04 | US-03, US-06 | sí dentro de capa 2 |
| US-07 | US-01, US-03, US-04 | no (capa 3) |

**Capas topológicas:**
- **Capa 1 (5 USTs paralelizables):** US-01, US-02, US-03, US-05, US-06
- **Capa 2 (1 UST):** US-04 (necesita ECR URIs de US-03 + SSM params de US-06 para las task definitions)
- **Capa 3 (1 UST):** US-07 (necesita Dockerfiles de US-01, ECR de US-03, task defs de US-04)

---

## Escenarios BDD

### Feature: Containerización de servicios backend (US-01)

```gherkin
Feature: Multi-stage Docker builds for backend services
  Como desarrollador de infraestructura
  Quiero construir imágenes Docker desde el monorepo
  Para que cada servicio pueda ejecutarse en ECS Fargate

  Background:
    Given el monorepo está clonado en la raíz del contexto de build
    And los archivos package.json, pnpm-lock.yaml y pnpm-workspace.yaml están presentes

  Scenario: Build exitoso de authorization-service
    Given el Dockerfile está en apps/authorization-service/Dockerfile
    When ejecuto "docker build -f apps/authorization-service/Dockerfile -t auth-service:test ."
    Then la imagen se construye sin errores
    And la imagen final pesa menos de 300 MB
    And "docker run --rm auth-service:test node -e 'require(\"@open-supervisor/shared-types\")'" no produce errores

  Scenario: Build exitoso de sse-server
    Given el Dockerfile está en apps/sse-server/Dockerfile
    When ejecuto "docker build -f apps/sse-server/Dockerfile -t sse-server:test ."
    Then la imagen se construye sin errores
    And la imagen final pesa menos de 200 MB
    And "docker run --rm sse-server:test node -e 'require(\"@open-supervisor/shared-messaging\")'" no produce errores

  Scenario: Build exitoso de bff
    Given el Dockerfile está en apps/bff/Dockerfile
    When ejecuto "docker build -f apps/bff/Dockerfile -t bff:test ."
    Then la imagen se construye sin errores
    And la imagen final pesa menos de 250 MB
    And "docker run --rm bff:test node -e 'require(\"@open-supervisor/shared-types\")'" no produce errores

  Scenario: El caché de capas acelera builds subsecuentes
    Given una primera build ha completado exitosamente
    When modifico solo un archivo fuente en apps/authorization-service/src/
    And ejecuto la build nuevamente
    Then las capas de "pnpm install" usan caché (no se re-ejecutan)
    And la build termina en menos del 50% del tiempo de la primera build
```

### Feature: Health check endpoints (US-02)

```gherkin
Feature: Health check endpoints para ECS
  Como orquestador ECS Fargate
  Quiero consultar la salud de cada servicio vía HTTP
  Para que Fargate pueda reiniciar contenedores no saludables

  Scenario: authorization-service responde a health check
    Given el contenedor de authorization-service está corriendo
    When hago GET http://localhost:3001/health
    Then la respuesta tiene HTTP status 200
    And el body contiene "status": "ok"
    And el body contiene "service": "authorization-service"

  Scenario: sse-server responde a health check
    Given el contenedor de sse-server está corriendo
    When hago GET http://localhost:3002/health
    Then la respuesta tiene HTTP status 200
    And el body contiene "status": "ok"
    And el body contiene "service": "sse-server"

  Scenario: bff responde a health check
    Given el contenedor de bff está corriendo
    When hago GET http://localhost:3000/health
    Then la respuesta tiene HTTP status 200
    And el body contiene "status": "ok"
    And el body contiene "service": "bff"

  Scenario: Health check no depende de servicios externos
    Given Kafka, Redis y Postgres NO están disponibles
    When hago GET /health en cualquier servicio
    Then la respuesta sigue siendo HTTP 200
    And no hay timeouts ni errores 5xx
```

### Feature: CI/CD Pipeline (US-07)

```gherkin
Feature: Deploy automático a ECS desde GitHub Actions
  Como desarrollador
  Quiero que un push a main despliegue automáticamente
  Para que el proceso de release sea repetible y auditable

  Scenario: Push a main dispara el workflow de deploy
    Given existe un commit en la rama main
    When hago push a origin/main
    Then el workflow ".github/workflows/deploy.yml" se ejecuta
    And las 3 imágenes se construyen y se pushean a ECR
    And los 3 servicios ECS se actualizan con las nuevas imágenes
    And el workflow reporta éxito en GitHub Actions

  Scenario: Workflow manual vía workflow_dispatch
    Given quiero desplegar una rama que no es main
    When disparo el workflow manualmente desde la UI de GitHub Actions
    And selecciono la rama "feature/hotfix-urgente"
    Then las imágenes se construyen desde esa rama
    And se depliegan a ECS sin necesidad de mergear a main

  Scenario: Fallo en build no afecta servicios existentes
    Given el paso de build de authorization-service falla
    When el workflow llega al job de build-and-push
    Then el job de deploy NO se ejecuta
    And los servicios ECS existentes siguen corriendo con la versión anterior
```

---

## Plan de Tests TDD

### US-01 — Multi-stage Dockerfiles

**Unitarios / Validación estructural**
- [ ] [RED] Test: `docker build -f apps/authorization-service/Dockerfile .` falla porque el Dockerfile no existe aún
- [ ] [GREEN] Crear `apps/authorization-service/Dockerfile` con el patrón multi-stage descrito
- [ ] [RED] Test: la imagen construida pesa más de 500 MB (incluye devDependencies)
- [ ] [GREEN] Optimizar el stage de producción para excluir devDependencies
- [ ] [RED] Test: `docker build -f apps/sse-server/Dockerfile .` falla (Dockerfile no existe)
- [ ] [GREEN] Crear `apps/sse-server/Dockerfile`
- [ ] [RED] Test: `docker build -f apps/bff/Dockerfile .` falla (Dockerfile no existe)
- [ ] [GREEN] Crear `apps/bff/Dockerfile`

**Integración / Validación funcional**
- [ ] [RED] Test script: `scripts/validate-docker-builds.sh` — construye las 3 imágenes, ejecuta `docker run --rm <image> node -e "require('@open-supervisor/shared-types')"` y verifica exit code 0
- [ ] [GREEN] Todos los shared packages son resolvibles dentro del contenedor

**Edge cases**
- [ ] Modificar un archivo en `packages/shared-types/src/` y verificar que las 3 builds invalidan caché de shared-types pero no de node_modules
- [ ] `docker build --no-cache` produce imágenes funcionales
- [ ] La imagen de production NO contiene `node_modules/.cache`, `tsconfig*.tsbuildinfo`, `src/` (solo `dist/`)

---

### US-02 — Health Check Endpoints

**Unitarios**
- [ ] [RED] Test: `GET /health` en authorization-service retorna 404 (endpoint no existe)
- [ ] [GREEN] Crear `HealthController` + `HealthModule` en authorization-service, registrar en `AppModule`
- [ ] [RED] Test: `GET /health` en sse-server retorna 404
- [ ] [GREEN] Crear `HealthController` + `HealthModule` en sse-server
- [ ] [RED] Test: `GET /health` en bff retorna 404
- [ ] [GREEN] Crear `HealthController` + `HealthModule` en bff

**Unitarios (contenido de respuesta)**
- [ ] [RED] Test: respuesta no incluye campo `service`
- [ ] [GREEN] Agregar `service` field al DTO de respuesta, con nombre hardcodeado por servicio
- [ ] [RED] Test: respuesta no incluye `timestamp`
- [ ] [GREEN] Agregar `timestamp: new Date().toISOString()`

**Edge cases**
- [ ] Health check no depende de ningún puerto externo (mockear todos los servicios externos como caídos, el endpoint sigue retornando 200)
- [ ] Health check responde en <50ms (test de performance con `jest.setTimeout`)

---

### US-03 — ECR Repositories

**Unitarios (script de validación)**
- [ ] [RED] Test: `aws ecr describe-repositories --repository-names open-supervisor/authorization-service` falla (no existe)
- [ ] [GREEN] Script `scripts/aws/create-ecr-repos.sh` crea los 3 repositorios
- [ ] [RED] Test: `imageTagMutability` no es `IMMUTABLE`
- [ ] [GREEN] Script configura `imageTagMutability: IMMUTABLE`
- [ ] [RED] Test: política de ciclo de vida no existe
- [ ] [GREEN] Script adjunta política de ciclo de vida (máx 20 imágenes)

**Edge cases**
- [ ] El script es idempotente: correrlo 2 veces no produce errores
- [ ] El script falla con mensaje claro si las credenciales AWS no están configuradas

---

### US-04 — ECS Task Definitions

**Validación estructural**
- [ ] [RED] Test: validar JSON de task definition contra el schema de AWS ECS (`aws ecs register-task-definition --generate-cli-skeleton`)
- [ ] [GREEN] JSON válido según el schema
- [ ] [RED] Test: `aws ecs describe-task-definition --task-definition authorization-service` falla
- [ ] [GREEN] `aws ecs register-task-definition --cli-input-json file://infra/ecs/task-definitions/authorization-service.json` funciona

**Edge cases**
- [ ] Task definition referencia parámetros SSM que no existen → error claro al registrar
- [ ] CPU y memoria cumplen con las combinaciones válidas de Fargate (no todas las combinaciones son válidas)

---

### US-05 — VPC Networking

**Validación de infraestructura**
- [ ] [RED] Test: `aws ec2 describe-vpcs --filters Name=tag:Name,Values=open-supervisor-vpc` no retorna VPCs
- [ ] [GREEN] CloudFormation o script crea la VPC
- [ ] [RED] Test: `aws ec2 describe-security-groups --filters Name=group-name,Values=alb-sg` no retorna SGs
- [ ] [GREEN] Los 4 security groups existen con las reglas especificadas

**Edge cases**
- [ ] El ALB acepta tráfico en puerto 80 y lo forwardea al target group del BFF
- [ ] Una instancia en el SG `bff-sg` puede conectarse a una instancia en `auth-service-sg:3001`
- [ ] Una instancia en `bff-sg` NO puede conectarse a internet directamente (tráfico sale por NAT Gateway)

---

### US-06 — SSM Parameters

**Validación de parámetros**
- [ ] [RED] Test: `aws ssm get-parameter --name /open-supervisor/staging/KAFKA_BROKER` falla
- [ ] [GREEN] Script `scripts/aws/create-ssm-params.sh` crea los parámetros
- [ ] [RED] Test: `aws ssm get-parameter --name /open-supervisor/staging/DATABASE_URL --with-decryption` no retorna el valor descifrado
- [ ] [GREEN] `DATABASE_URL` es de tipo `SecureString` y se puede leer con `--with-decryption`

**Edge cases**
- [ ] El script es idempotente (usa `put-parameter` con `--overwrite`)
- [ ] `KEYCLOAK_CLIENT_SECRET` se almacena en Secrets Manager, no en SSM (`aws secretsmanager get-secret-value` funciona)

---

### US-07 — GitHub Actions CI/CD

**Validación de workflow**
- [ ] [RED] Test: `act -W .github/workflows/deploy.yml` (simulación local con `nektos/act`) falla porque el workflow no existe
- [ ] [GREEN] Workflow `.github/workflows/deploy.yml` creado con jobs `build-and-push` y `deploy`
- [ ] [RED] Test: `act -j build-and-push` falla porque las credenciales AWS no están configuradas
- [ ] [GREEN] Workflow usa OIDC (`aws-actions/configure-aws-credentials@v4` con `role-to-assume`)

**Edge cases**
- [ ] El workflow no expone secretos en logs (verificar que `docker build` no imprime `--build-arg` con valores sensibles)
- [ ] Si el build de un servicio falla, los otros servicios NO son redeployados (el job de deploy verifica que los 3 builds hayan pasado)
- [ ] `workflow_dispatch` permite seleccionar la rama a desplegar

---

## Definition of Done

- [ ] Las 3 imágenes Docker se construyen exitosamente con `docker build` desde la raíz del monorepo
- [ ] Cada imagen expone `GET /health` y responde HTTP 200 en <100ms
- [ ] Los 3 repositorios ECR existen y tienen política de ciclo de vida activa
- [ ] Las 3 task definitions ECS son válidas y aceptadas por `aws ecs register-task-definition`
- [ ] La VPC, subredes, NAT Gateway y security groups están creados y funcionales
- [ ] Los parámetros SSM existen y son legibles por la IAM role `ecs-task-execution`
- [ ] El workflow `deploy.yml` se ejecuta en GitHub Actions: build → push a ECR → deploy a ECS
- [ ] Un push a `main` resulta en servicios ECS actualizados con las nuevas imágenes en <20 minutos
- [ ] Tests unitarios pasan para todos los health endpoints (cobertura ≥ 90%)
- [ ] Scripts de validación de infraestructura (`scripts/aws/validate-infra.sh`) pasan contra la cuenta AWS de staging

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| R1: Node.js version mismatch | Corregido: spec usa Node.js 24 Alpine (consistente con `.nvmrc` y CI `node-version: 24`) |
| R2: `workspace:*` symlinks | Mitigado: `pnpm deploy --prod` (pnpm ≥8, CI usa v11) resuelve como copias planas |
| R3: `nest build` falla en Alpine | Mitigación: verificar prebuilds para linux/arm64 y linux/amd64 de kafkajs, ioredis, pg, drizzle-orm, @nestjs/*, undici |
| R4: Graceful shutdown ausente | No bloqueante MVP. ECS stop timeout 30s; Kafka consumer group se rebalancea. Fast-follow. |
| R5: Cache de capas Docker | No bloqueante. Copy de todos los package.json en una capa; optimización futura: separar por servicio. |
| R6: VPC CIDR colisión | Documentado. Requiere validación pre-deploy. |
| R7: OIDC setup manual | Documentado. Placeholder `account-id` en el workflow requerirá reemplazo. |
| Dependencia externa | AWS account con permisos para ECR, ECS, VPC, SSM, IAM, CloudWatch |
| Dependencia externa | Kafka (MSK o EC2) y Redis (ElastiCache) provisionados con endpoints conocidos |
| Riesgo técnico | `pnpm deploy --prod` es el enfoque elegido (pnpm ≥8, CI usa v11). Resuelve nativamente los `workspace:*` packages como copias planas sin symlinks. No hay riesgo de `workspace:*` sin resolver. |
| Riesgo técnico | `nest build` puede fallar en Alpine si alguna dependencia requiere binaries nativos no disponibles para musl. Mitigación: verificar que todos los paquetes tienen prebuilds para linux/arm64 y linux/amd64 |
| Suposición a validar | `kafkajs`, `ioredis`, `drizzle-orm` y `pg` funcionan en Node.js 24 Alpine sin dependencias nativas adicionales |
| Suposición a validar | El VPC CIDR `10.0.0.0/16` no colisiona con VPCs existentes en la cuenta AWS |
| Suposición a validar | GitHub Actions tiene permisos para asumir el IAM Role vía OIDC (requiere configuración inicial en AWS IAM) |

---

## Edge Cases Adicionales (Architect Review)

| # | Edge Case | Impacto | Nota |
|---|-----------|---------|------|
| EC1 | **Multi-arch builds**: `node:24-alpine` soporta `linux/amd64` y `linux/arm64`. AWS Graviton es 20% más barato. | Bajo (opcional MVP) | Usar `docker buildx build --platform linux/amd64,linux/arm64` |
| EC2 | **Kafka consumer group rebalance**: authorization-service usa `sessionTimeout: 30000`. ECS stop timeout > 30s para graceful disconnect. | Medio | Fast-follow recomendado |
| EC3 | **CI cache saturation**: GitHub Actions cache tiene límite 10 GB por repo. | Bajo | Monitorear en Settings → Actions → Cache |
| EC4 | **Cold start en Fargate**: primera descarga de imagen 30-60s. `startPeriod: 60` en healthCheck lo cubre. | Bajo | Documentado en task definitions |
| EC5 | **SSM throttling**: 40 req/s por cuenta. Sin riesgo (solo lectura al arrancar, no refresco en runtime). | Bajo | Sin acción requerida |
| EC6 | **tsconfig.build.json ausente**: solo authorization-service lo tiene. sse-server y bff usan `tsconfig.json` con `nest build`. | Bajo | Documentar en Dockerfiles que no se espera `tsconfig.build.json` en esos servicios |

---

## Archivos a crear/modificar

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `apps/authorization-service/Dockerfile` | CREATE | Multi-stage build para authorization-service |
| `apps/sse-server/Dockerfile` | CREATE | Multi-stage build para sse-server |
| `apps/bff/Dockerfile` | CREATE | Multi-stage build para bff |
| `.dockerignore` | CREATE | Excluir node_modules, dist, .git, apps/mobile, coverage, spec/, collections/, .stryker-tmp |
| `apps/authorization-service/src/health/health.controller.ts` | CREATE | HealthController con GET /health |
| `apps/authorization-service/src/health/health.controller.spec.ts` | CREATE | Test unitario del health endpoint |
| `apps/authorization-service/src/health/health.module.ts` | CREATE | HealthModule (registrado en AppModule) |
| `apps/sse-server/src/health/health.controller.ts` | CREATE | HealthController con GET /health |
| `apps/sse-server/src/health/health.controller.spec.ts` | CREATE | Test unitario del health endpoint |
| `apps/sse-server/src/health/health.module.ts` | CREATE | HealthModule |
| `apps/bff/src/health/health.controller.ts` | CREATE | HealthController con GET /health |
| `apps/bff/src/health/health.controller.spec.ts` | CREATE | Test unitario del health endpoint |
| `apps/bff/src/health/health.module.ts` | CREATE | HealthModule |
| `apps/authorization-service/src/app.module.ts` | MODIFY | Importar HealthModule |
| `apps/sse-server/src/app.module.ts` | MODIFY | Importar HealthModule |
| `apps/bff/src/app.module.ts` | MODIFY | Importar HealthModule |
| `infra/ecs/task-definitions/authorization-service.json` | CREATE | Task definition ECS Fargate |
| `infra/ecs/task-definitions/sse-server.json` | CREATE | Task definition ECS Fargate |
| `infra/ecs/task-definitions/bff.json` | CREATE | Task definition ECS Fargate |
| `infra/network/vpc.yaml` | CREATE | CloudFormation o JSON para VPC, subredes, SGs, ALB |
| `scripts/aws/create-ecr-repos.sh` | CREATE | Script para crear repositorios ECR |
| `scripts/aws/create-ssm-params.sh` | CREATE | Script para crear parámetros SSM |
| `scripts/aws/validate-infra.sh` | CREATE | Script para validar que toda la infra está creada |
| `scripts/validate-docker-builds.sh` | CREATE | Script para construir y validar las 3 imágenes |
| `.github/workflows/deploy.yml` | CREATE | Workflow CI/CD: build → push ECR → deploy ECS |
| `spec/2026-06-11-aws-fargate-containerization.spec.md` | CREATE | Este spec |

---

## Notas de implementación

### Patrón del Dockerfile multi-stage

```dockerfile
# Stage 1: Dependencies + Build
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app
# Copy workspace config + lockfile first (layer caching)
COPY pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/tsconfig.json packages/shared-types/
COPY packages/shared-messaging/package.json packages/shared-messaging/tsconfig.json packages/shared-messaging/
COPY apps/<service>/package.json apps/<service>/tsconfig.json apps/<service>/nest-cli.json apps/<service>/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/ packages/
COPY apps/<service>/src apps/<service>/src/
RUN pnpm --filter @open-supervisor/shared-types build
RUN pnpm --filter @open-supervisor/shared-messaging build
RUN pnpm --filter @open-supervisor/<service> build

# Stage 2: Production (pnpm deploy --prod)
FROM node:24-alpine AS production
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/tsconfig.json packages/shared-types/
COPY packages/shared-messaging/package.json packages/shared-messaging/tsconfig.json packages/shared-messaging/
COPY apps/<service>/package.json apps/<service>/nest-cli.json apps/<service>/
COPY --from=build /app/packages/shared-types/dist/ /app/packages/shared-types/dist/
COPY --from=build /app/packages/shared-messaging/dist/ /app/packages/shared-messaging/dist/
COPY --from=build /app/apps/<service>/dist/ /app/apps/<service>/dist/
# pnpm deploy resuelve workspace:* como copias planas (sin symlinks)
RUN pnpm --filter @open-supervisor/<service> deploy --prod /app/prod
WORKDIR /app/prod
EXPOSE <port>
CMD ["node", "dist/main.js"]
```

### Health check en ECS Task Definition

```json
{
  "healthCheck": {
    "command": ["CMD-SHELL", "curl -f http://localhost:<port>/health || exit 1"],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 60
  }
}
```

### Autenticación OIDC en GitHub Actions

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::<account-id>:role/github-actions-deploy
    aws-region: us-east-1
```
