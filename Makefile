# open-supervisor Makefile
# Un solo comando para levantar todo el stack de desarrollo.
#
# Uso:
#   make dev        Levanta infraestructura + servicios backend
#   make localstack  Levanta servicios backend sobre LocalStack MSK (Pro/Ultimate)
#   make emulator    Lanza emulador Android + port forwarding + app
#   make all         Hace dev + emulator (full stack)
#   make down        Detiene todo
#   make status      Muestra qué está corriendo
#
# Override del motor de contenedores:
#   make dev COMPOSE="docker compose"

# ── Raíz del proyecto (derivada dinámicamente, sin rutas absolutas) ──────────
ROOT_DIR := $(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))

# ── Detección automática del motor de contenedores ────────────────────────────
# Orden de preferencia:
#   1. podman-compose  → script Python que habla directo con Podman (sin delegar a docker-compose)
#   2. podman compose  → subcomando CLI de Podman (puede delegar a docker-compose si existe)
#   3. docker compose  → último recurso (requiere Docker daemon o DOCKER_HOST apuntando a Podman)
COMPOSE ?= $(shell command -v podman-compose >/dev/null 2>&1 && echo "podman-compose" || (command -v podman >/dev/null 2>&1 && echo "podman compose" || echo "docker compose"))

# ── Socket de Podman en macOS ─────────────────────────────────────────────────
# podman-compose no necesita DOCKER_HOST — usa el CLI de Podman directamente.
# Para los fallbacks (podman compose / docker compose) exponemos el socket.
ifeq ($(findstring podman-compose,$(COMPOSE)),podman-compose)
  # podman-compose: DOCKER_HOST innecesario
else ifeq ($(findstring podman,$(COMPOSE)),podman)
  ifeq ($(shell uname),Darwin)
    ifndef DOCKER_HOST
      export DOCKER_HOST := unix://$(shell podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}' 2>/dev/null)
    endif
  endif
endif

# ── Colores para output ──────────────────────────────────────────────────────
GREEN  := \033[0;32m
YELLOW := \033[0;33m
CYAN   := \033[0;36m
NC     := \033[0m # No Color

# ═══════════════════════════════════════════════════════════════════════════════
# help — Target por defecto
# ═══════════════════════════════════════════════════════════════════════════════
help:
	@echo "$(CYAN)open-supervisor Makefile$(NC)"
	@echo ""
	@echo "$(YELLOW)Targets principales:$(NC)"
	@echo "  $(GREEN)dev$(NC)         Levanta infra + compila y arranca los 3 servicios backend"
	@echo "  $(GREEN)localstack$(NC)  Levanta servicios backend sobre LocalStack MSK (Pro/Ultimate)"
	@echo "  $(GREEN)emulator$(NC)    Lanza emulador Android + port forwarding + Metro + app"
	@echo "  $(GREEN)all$(NC)         Hace dev + emulator (stack completo)"
	@echo ""
	@echo "$(YELLOW)Targets individuales:$(NC)"
	@echo "  $(GREEN)infra$(NC)       Levanta contenedores (Kafka, Redis, Zookeeper, Postgres)"
	@echo "  $(GREEN)ls-infra$(NC)    Levanta LocalStack MSK + bootstrap (sin servicios)"
	@echo "  $(GREEN)ls-down$(NC)      Detiene LocalStack + servicios lanzados via make localstack"
	@echo "  $(GREEN)sonar$(NC)       Levanta SonarQube (port 9000, solo este servicio)"
	@echo "  $(GREEN)services$(NC)    Compila y arranca authorization-service, sse-server, bff"
	@echo "  $(GREEN)detox-build$(NC) Compila el APK debug para tests Detox E2E"
	@echo "  $(GREEN)detox-test$(NC)  Ejecuta los tests Detox E2E en el emulador"
	@echo "  $(GREEN)e2e$(NC)         Pipeline completo E2E (detox-build + detox-test)"
	@echo "  $(GREEN)down$(NC)        Detiene servicios backend + contenedores + emulador"
	@echo "  $(GREEN)status$(NC)      Muestra estado de contenedores, puertos y emulador"
	@echo ""
	@echo "$(YELLOW)Variables de entorno:$(NC)"
	@echo "  COMPOSE=$(COMPOSE)"
	@echo "  DOCKER_HOST=$([ -n "$(DOCKER_HOST)" ] && echo "$(DOCKER_HOST)" || echo "<default>")"
	@echo "  ROOT_DIR=$(ROOT_DIR)"
	@echo ""
	@echo "Overridable:  make dev COMPOSE=\"docker compose\""

# ═══════════════════════════════════════════════════════════════════════════════
# dev — Levanta todo el backend (infraestructura + servicios)
# ═══════════════════════════════════════════════════════════════════════════════
dev: infra services
	@echo ""
	@echo "$(GREEN)✅ Stack backend listo.$(NC)"
	@echo "   bff:                   http://localhost:3000"
	@echo "   authorization-service: http://localhost:3001"
	@echo "   sse-server:            http://localhost:3002"
	@echo ""
	@echo "   Para el emulador + app:  $(YELLOW)make emulator$(NC)"
	@echo "   Para inyectar requests:  $(YELLOW)pnpm inject --type DISCOUNT --store-id store-1 --pos-id pos-1$(NC)"

# ═══════════════════════════════════════════════════════════════════════════════
# all — Stack completo (backend + emulador + app)
# ═══════════════════════════════════════════════════════════════════════════════
all: dev emulator

# ═══════════════════════════════════════════════════════════════════════════════
# infra — Levantar contenedores (Kafka, Redis, Zookeeper, Postgres)
# ═══════════════════════════════════════════════════════════════════════════════
infra:
	@echo "$(CYAN)🐳 Levantando infraestructura con $(COMPOSE)...$(NC)"
	@$(COMPOSE) up -d
	@echo ""
	@echo "$(YELLOW)⏳ Esperando a que Kafka esté healthy...$(NC)"
	@# Esperar hasta que Kafka responda (máx 60s)
	@for i in $$(seq 1 30); do \
		$(COMPOSE) exec -T kafka kafka-broker-api-versions --bootstrap-server localhost:9092 >/dev/null 2>&1 && break; \
		sleep 2; \
	done
	@echo ""
	@echo "$(CYAN)🐳 Contenedores:$(NC)"
	@$(COMPOSE) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
	@echo ""
	@echo "$(GREEN)✅ Infraestructura lista$(NC)"

# ═══════════════════════════════════════════════════════════════════════════════
# sonar — Levantar SonarQube (solo este servicio)
# ═══════════════════════════════════════════════════════════════════════════════
sonar:
	@echo "$(CYAN)🐳 Starting SonarQube...$(NC)"
	@$(COMPOSE) up -d sonarqube
	@echo "$(YELLOW)⏳ Waiting for SonarQube to be ready (may take ~60s on first startup)...$(NC)"
	@for i in $$(seq 1 30); do \
		curl -sf http://localhost:9000/api/system/status | grep -q '"status":"UP"' && break; \
		sleep 5; \
	done
	@echo ""
	@echo "$(GREEN)✅ SonarQube ready: $(NC)http://localhost:9000"
	@echo "   Default credentials: admin / admin"

# ═══════════════════════════════════════════════════════════════════════════════
# services — Compilar y arrancar los 3 servicios NestJS
# ═══════════════════════════════════════════════════════════════════════════════
services: infra
	@echo "$(CYAN)📦 Compilando paquetes compartidos...$(NC)"
	@cd $(ROOT_DIR)/packages/shared-types && node_modules/.bin/tsc
	@cd $(ROOT_DIR)/packages/shared-messaging && node_modules/.bin/tsc
	@echo ""
	@# ── authorization-service (puerto 3001) ──
	@echo "$(CYAN)🔧 Compilando authorization-service...$(NC)"
	@cd $(ROOT_DIR)/apps/authorization-service && rm -f tsconfig*.tsbuildinfo && node_modules/.bin/nest build
	@echo "$(GREEN)🚀 Iniciando authorization-service (puerto 3001)...$(NC)"
	@cd $(ROOT_DIR)/apps/authorization-service && node dist/main > /tmp/auth-service.log 2>&1 &
	@echo ""
	@# ── sse-server (puerto 3002) ──
	@echo "$(CYAN)🔧 Compilando sse-server...$(NC)"
	@cd $(ROOT_DIR)/apps/sse-server && rm -f tsconfig*.tsbuildinfo && node_modules/.bin/nest build
	@echo "$(GREEN)🚀 Iniciando sse-server (puerto 3002)...$(NC)"
	@cd $(ROOT_DIR)/apps/sse-server && node dist/main > /tmp/sse-server.log 2>&1 &
	@echo ""
	@# ── bff (puerto 3000) ──
	@echo "$(CYAN)🔧 Compilando bff...$(NC)"
	@cd $(ROOT_DIR)/apps/bff && rm -f tsconfig*.tsbuildinfo && node_modules/.bin/nest build
	@echo "$(GREEN)🚀 Iniciando bff (puerto 3000)...$(NC)"
	@cd $(ROOT_DIR)/apps/bff && node dist/main > /tmp/bff.log 2>&1 &
	@echo ""
	@# ── Verificar que los 3 puertos estén en escucha ──
	@echo "$(YELLOW)⏳ Esperando que los servicios estén listos...$(NC)"
	@for i in $$(seq 1 15); do \
		count=$$(lsof -i :3000 -i :3001 -i :3002 -P 2>/dev/null | grep -c LISTEN || echo 0); \
		[ $$count -ge 3 ] && break; \
		sleep 2; \
	done
	@echo ""
	@echo "$(CYAN)🔍 Puertos en escucha:$(NC)"
	@lsof -i :3000 -i :3001 -i :3002 -P 2>/dev/null | grep LISTEN || echo "  ⚠️  Algunos servicios pueden no estar listos"
	@echo ""
	@echo "$(GREEN)✅ Servicios backend levantados$(NC)"

# ═══════════════════════════════════════════════════════════════════════════════
# emulator — Emulador Android + port forwarding + Metro + app
# ═══════════════════════════════════════════════════════════════════════════════
emulator:
	@echo "$(CYAN)📱 Verificando emulador Android...$(NC)"
	@# Verificar que el emulador esté corriendo; si no, lanzarlo
	@if adb devices 2>/dev/null | grep -q emulator; then \
		echo "   Emulador ya corriendo: $$(adb devices | grep emulator | head -1)"; \
	else \
		echo "   Lanzando emulador open_supervisor..."; \
		emulator -avd open_supervisor > /tmp/emulator.log 2>&1 & \
		echo "   Esperando boot del emulador (puede tardar ~30s)..."; \
		adb wait-for-device; \
		adb shell 'while [ "$$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'; \
		echo "   Emulador listo."; \
	fi
	@echo ""
	@echo "$(CYAN)📱 Configurando port forwarding...$(NC)"
	@adb reverse tcp:3000 tcp:3000
	@adb reverse tcp:3001 tcp:3001
	@adb reverse tcp:3002 tcp:3002
	@echo "   Forwarding: 3000 → bff, 3001 → auth-service, 3002 → sse-server"
	@echo ""
	@echo "$(CYAN)📱 Iniciando Metro bundler...$(NC)"
	@cd $(ROOT_DIR)/apps/mobile && pnpm start > /tmp/metro.log 2>&1 &
	@sleep 3
	@echo ""
	@echo "$(CYAN)📱 Compilando e instalando app en el emulador...$(NC)"
	@cd $(ROOT_DIR)/apps/mobile && pnpm android
	@echo ""
	@echo "$(GREEN)✅ Emulador y app listos$(NC)"

# ═══════════════════════════════════════════════════════════════════════════════
# down — Detener todo (servicios + contenedores + emulador)
# ═══════════════════════════════════════════════════════════════════════════════
down:
	@echo "$(YELLOW)🛑 Deteniendo servicios backend...$(NC)"
	@-pkill -f "node dist/main" 2>/dev/null || true
	@sleep 1
	@echo "$(YELLOW)🛑 Deteniendo Metro bundler...$(NC)"
	@-pkill -f "Metro" 2>/dev/null || true
	@echo "$(YELLOW)🛑 Deteniendo emulador...$(NC)"
	@-adb devices 2>/dev/null | grep emulator | awk '{print $$1}' | xargs -I {} adb -s {} emu kill 2>/dev/null || true
	@echo "$(YELLOW)🛑 Deteniendo contenedores...$(NC)"
	@$(COMPOSE) down
	@echo ""
	@echo "$(GREEN)✅ Todo detenido$(NC)"

# ═══════════════════════════════════════════════════════════════════════════════
# status — Mostrar qué está corriendo
# ═══════════════════════════════════════════════════════════════════════════════
status:
	@echo "$(CYAN)=== Contenedores ($(COMPOSE)) ===$(NC)"
	@$(COMPOSE) ps 2>/dev/null || echo "  Sin contenedores corriendo"
	@echo ""
	@echo "$(CYAN)=== Servicios backend (puertos en escucha) ===$(NC)"
	@lsof -i :3000 -i :3001 -i :3002 -P 2>/dev/null | grep LISTEN || echo "  Sin servicios backend"
	@echo ""
	@echo "$(CYAN)=== Emulador Android ===$(NC)"
	@adb devices 2>/dev/null || echo "  adb no disponible"
	@echo ""
	@echo "$(CYAN)=== Procesos Node en background ===$(NC)"
	@ps aux | grep "node dist/main" | grep -v grep || echo "  Sin procesos node dist/main"

# ═══════════════════════════════════════════════════════════════════════════════
# detox-build — Compilar el APK debug para tests Detox E2E
# ═══════════════════════════════════════════════════════════════════════════════
detox-build:
	@echo "$(CYAN)📦 Compilando APK debug para Detox E2E...$(NC)"
	@cd $(ROOT_DIR)/apps/mobile && pnpm detox:build
	@echo ""
	@echo "$(GREEN)✅ APK E2E compilado$(NC)"

# ═══════════════════════════════════════════════════════════════════════════════
# detox-test — Ejecutar los tests Detox E2E en el emulador
# ═══════════════════════════════════════════════════════════════════════════════
detox-test:
	@echo "$(CYAN)🧪 Ejecutando tests Detox E2E...$(NC)"
	@cd $(ROOT_DIR)/apps/mobile && pnpm detox:test
	@echo ""
	@echo "$(GREEN)✅ Tests E2E completados$(NC)"

# ═══════════════════════════════════════════════════════════════════════════════
# e2e — Pipeline completo E2E: build + test
# ═══════════════════════════════════════════════════════════════════════════════
e2e: detox-build detox-test
	@echo ""
	@echo "$(GREEN)✅ Pipeline E2E completo$(NC)"

# ═══════════════════════════════════════════════════════════════════════════════
# localstack-infra — LocalStack MSK + bootstrap (sin servicios backend), uses $(COMPOSE)
# ═══════════════════════════════════════════════════════════════════════════════
localstack-infra:
	@echo "$(CYAN)🐳 Levantando LocalStack con MSK...$(NC)"
	@$(COMPOSE) -f docker-compose.yml -f docker-compose.localstack.yml up -d localstack
	@echo "$(YELLOW)⏳ Esperando a que LocalStack esté healthy (MSK puede tardar)...$(NC)"
	@for i in $$(seq 1 40); do \
		health=$$(curl -sf http://localhost:4566/_localstack/health 2>/dev/null || echo ""); \
		if echo "$$health" | grep -q '"msk"\s*:\s*"available"'; then \
			break; \
		fi; \
		sleep 3; \
	done
	@echo ""
	@echo "$(CYAN)🔧 Provisionando MSK cluster y topics...$(NC)"
	@bash "$(ROOT_DIR)/scripts/bootstrap-msk-local.sh"
	@echo ""
	@echo "$(GREEN)✅ LocalStack MSK infraestructura lista$(NC)"
	@echo "   Bootstrap brokers: $$(grep KAFKA_BROKERS "$(ROOT_DIR)/scripts/msk-env.sh" 2>/dev/null | cut -d= -f2- | tr -d '"' || echo 'unknown')"

# ═══════════════════════════════════════════════════════════════════════════════
# localstack — LocalStack MSK + servicios backend
# ═══════════════════════════════════════════════════════════════════════════════
localstack: localstack-infra
	@echo ""
	@echo "$(CYAN)📦 Compilando paquetes compartidos...$(NC)"
	@cd $(ROOT_DIR)/packages/shared-types && node_modules/.bin/tsc
	@cd $(ROOT_DIR)/packages/shared-messaging && node_modules/.bin/tsc
	@echo ""
	@# Source the MSK env file so KAFKA_BROKERS points to LocalStack MSK
	@set -a && . "$(ROOT_DIR)/scripts/msk-env.sh" && set +a && \
		echo "$(GREEN)🐳 KAFKA_BROKERS=$$KAFKA_BROKERS$(NC)"
	@echo ""
	@# ── authorization-service (puerto 3001) ──
	@echo "$(CYAN)🔧 Compilando authorization-service...$(NC)"
	@cd $(ROOT_DIR)/apps/authorization-service && rm -f tsconfig*.tsbuildinfo && node_modules/.bin/nest build
	@set -a && . "$(ROOT_DIR)/scripts/msk-env.sh" && set +a && \
		cd $(ROOT_DIR)/apps/authorization-service && node dist/main > /tmp/auth-service.log 2>&1 &
	@echo ""
	@# ── sse-server (puerto 3002) ──
	@echo "$(CYAN)🔧 Compilando sse-server...$(NC)"
	@cd $(ROOT_DIR)/apps/sse-server && rm -f tsconfig*.tsbuildinfo && node_modules/.bin/nest build
	@echo "$(GREEN)🚀 Iniciando sse-server (puerto 3002)...$(NC)"
	@cd $(ROOT_DIR)/apps/sse-server && node dist/main > /tmp/sse-server.log 2>&1 &
	@echo ""
	@# ── bff (puerto 3000) ──
	@echo "$(CYAN)🔧 Compilando bff...$(NC)"
	@cd $(ROOT_DIR)/apps/bff && rm -f tsconfig*.tsbuildinfo && node_modules/.bin/nest build
	@echo "$(GREEN)🚀 Iniciando bff (puerto 3000)...$(NC)"
	@cd $(ROOT_DIR)/apps/bff && node dist/main > /tmp/bff.log 2>&1 &
	@echo ""
	@# ── Verificar puertos ──
	@echo "$(YELLOW)⏳ Esperando que los servicios estén listos...$(NC)"
	@for i in $$(seq 1 15); do \
		count=$$(lsof -i :3000 -i :3001 -i :3002 -P 2>/dev/null | grep -c LISTEN || echo 0); \
		[ $$count -ge 3 ] && break; \
		sleep 2; \
	done
	@echo ""
	@echo "$(GREEN)✅ Stack backend sobre LocalStack MSK listo.$(NC)"
	@echo "   bff:                   http://localhost:3000"
	@echo "   authorization-service: http://localhost:3001"
	@echo "   sse-server:            http://localhost:3002"
	@echo ""
	@echo "   Para inyectar requests:  $(YELLOW)source scripts/msk-env.sh && pnpm inject --type DISCOUNT --store-id store-1 --pos-id pos-1$(NC)"

# ═══════════════════════════════════════════════════════════════════════════════
# localstack-down — Detener LocalStack + servicios, stops containers with down/pkill
# ═══════════════════════════════════════════════════════════════════════════════
localstack-down:
	@echo "$(YELLOW)🛑 Deteniendo servicios backend...$(NC)"
	@-pkill -f "node dist/main" 2>/dev/null || true
	@sleep 1
	@echo "$(YELLOW)🛑 Deteniendo LocalStack y contenedores...$(NC)"
	@$(COMPOSE) -f docker-compose.yml -f docker-compose.localstack.yml down
	@echo ""
	@echo "$(GREEN)✅ LocalStack detenido$(NC)"

# ── Phony targets ────────────────────────────────────────────────────────────
.PHONY: help dev infra services sonar emulator all down status clean localstack localstack-infra localstack-down

# ═══════════════════════════════════════════════════════════════════════════════
# clean — Limpiar builds y archivos temporales
# ═══════════════════════════════════════════════════════════════════════════════
clean:
	@echo "$(YELLOW)🧹 Limpiando builds...$(NC)"
	@rm -rf $(ROOT_DIR)/apps/authorization-service/dist
	@rm -rf $(ROOT_DIR)/apps/sse-server/dist
	@rm -rf $(ROOT_DIR)/apps/bff/dist
	@rm -f $(ROOT_DIR)/apps/authorization-service/tsconfig.tsbuildinfo
	@rm -f $(ROOT_DIR)/apps/sse-server/tsconfig.tsbuildinfo
	@rm -f $(ROOT_DIR)/apps/bff/tsconfig.tsbuildinfo
	@rm -f $(ROOT_DIR)/packages/shared-types/tsconfig.tsbuildinfo
	@rm -f $(ROOT_DIR)/packages/shared-messaging/tsconfig.tsbuildinfo
	@echo "$(GREEN)✅ Builds limpiados$(NC)"
