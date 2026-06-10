# Spec: Portabilidad del harness — Detección dinámica de Podman/Docker

**Fecha:** 2026-06-04  
**Stack inferido:** Monorepo pnpm + NestJS + React Native + Shell scripts  
**Estado:** Completed  

---

## Contexto

El proyecto open-supervisor utiliza Podman como motor de contenedores para desarrollo local. Si bien los skills operativos (`open-supervisor-infra`, `open-supervisor-emulator`) y el `Makefile` ya implementan detección automática de Podman vs Docker, persisten **hardcodeos críticos** en archivos del harness que rompen la portabilidad del repositorio:

- `CLAUDE.md` (el archivo guía del proyecto para agentes de IA) contiene un comando hardcodeado con la ruta absoluta del socket Podman de la máquina del autor.
- `.claude/LEARNINGS.md` replica el mismo hardcodeo en su sección "Cómo aplicar".
- `.claude/settings.json` (trackeado en git) contiene rutas absolutas a `$HOME/...` que son inválidas en cualquier otra máquina.
- `.claude/settings.local.json` contiene nombres de contenedor con prefijo de proyecto (`open-supervisor-kafka-1`) frágiles si el directorio de clonado tiene otro nombre.
- `docker-compose.localstack.yml` monta `/var/run/docker.sock` hardcodeado, que no existe en entornos Podman macOS.
- `infra/terraform/README.md` asume Docker como único motor, sin nota de compatibilidad.

El **patrón de detección** ya está consolidado en 3 lugares (Makefile, skill `open-supervisor-infra`, `scripts/validate-tf-localstack.sh`) y es correcto. Esta feature no crea un nuevo mecanismo de detección, sino que **corrige los hardcodeos residuales** y asegura que todo el harness sea portable.

**Fuera de scope:**
- Cambios en la arquitectura de producto (servicios NestJS, app React Native).
- Refactor del mecanismo de detección existente (ya funciona bien).
- Agregar soporte para otros motores de contenedores (ej. Rancher Desktop).
- Cambios en `docker-compose.yml` principal (ya es portable).

**Ambigüedades identificadas:**
- ¿`docker-compose.localstack.yml` se usa activamente? Si no, podría eliminarse en vez de corregirse.
- ¿Cuántas reglas de permisos en `.claude/settings.json` necesitan moverse a `.claude/settings.local.json`? Se requiere inspección completa.

---

## REASONS Canvas

<REASONS>
  <Rationale>Un repositorio de código abierto debe ser clonable y ejecutable por cualquier desarrollador sin requerir edición manual de rutas hardcodeadas. Los hardcodeos actuales (socket Podman, rutas absolutas a $HOME) rompen el principio de portabilidad y generan fricción en el onboarding. El patrón de detección automática ya existe en los skills; extenderlo a los archivos de harness es la extensión natural.</Rationale>
  
  <Explanation>La feature corrige hardcodeos puntuales en 5 archivos del harness, reemplazándolos por referencias al Makefile (que ya detecta el motor), rutas relativas, o variables de entorno. No se introduce un nuevo mecanismo de detección: se reutiliza el existente. Para `settings.json`, la solución es mover reglas con rutas absolutas a `settings.local.json` (archivo personal no trackeado) y dejar en `settings.json` solo reglas portables con rutas relativas o patrones genéricos.</Explanation>
  
  <Assumptions>
    - El Makefile y los skills operativos seguirán siendo el punto de entrada canónico para comandos de infraestructura.
    - `.claude/settings.local.json` ya está en `.gitignore` (o se agregará) para que las reglas personales no se trackeen.
    - `docker-compose.localstack.yml` se usa para desarrollo local con LocalStack; si no se usa, aplicar la opción de eliminación.
    - Los agentes de IA (Claude Code, opencode) leerán CLAUDE.md como fuente de verdad para comandos del proyecto.
  </Assumptions>
  
  <Scrutiny>
    - ¿Qué pasa si un desarrollador no tiene Make instalado? → Los skills operativos son el fallback; CLAUDE.md puede documentar ambos caminos.
    - ¿Qué pasa si `settings.local.json` no existe al clonar por primera vez? → El archivo de settings trackeado debe ser autocontenido y funcional; `settings.local.json` es opcional para overrides personales.
    - ¿Qué pasa si el directorio de clonado se llama distinto y el prefijo de contenedor cambia? → Los skills ya usan `$COMPOSE exec <servicio>` (nombre de servicio, no de contenedor); este patrón debe documentarse.
  </Scrutiny>
  
  <Objections>
    - "No vale la pena un spec para cambios tan chicos" → Aunque cada cambio es pequeño, el impacto acumulado en la experiencia de onboarding es alto. Un spec asegura que no queden hardcodeos residuales y que el patrón quede documentado.
    - "settings.json es personal, no debería trackearse" → settings.json contiene reglas base que aplican a todos los desarrolladores (ej. permitir `pnpm test`). La separación en settings.json (compartido) + settings.local.json (personal) es el patrón estándar de Claude Code.
  </Objections>
  
  <Novelty>No se introduce nueva funcionalidad de producto. La novedad está en la disciplina de harness: separar configuración portable (trackeada) de configuración personal (local), y asegurar que todos los ejemplos de comandos en la documentación del proyecto usen los mecanismos de detección automática existentes.</Novelty>
  
  <Substitutes>
    - **Alternativa 1: Script de bootstrap que detecte el entorno y genere configs.** Descartada: sobre-ingeniería para 5 archivos. La corrección puntual es más simple y mantenible.
    - **Alternativa 2: Usar solo Docker, abandonar soporte Podman.** Descartada: Podman es el motor usado por el autor y es común en entornos macOS sin Docker Desktop. El patrón de detección ya funciona; abandonarlo sería un retroceso.
    - **Alternativa 3: Mover todo a Dev Containers / GitHub Codespaces.** Descartada: cambiaría el modelo de desarrollo completo y está fuera del alcance de esta feature.
  </Substitutes>
</REASONS>

---

## Historias de Usuario

### US-01: Comandos portables en la documentación del harness `[Must]`

> Como **desarrollador que clona el repositorio por primera vez**, quiero **que los comandos documentados en CLAUDE.md y LEARNINGS.md sean ejecutables sin modificar rutas hardcodeadas**, para que **pueda levantar la infraestructura inmediatamente después del clonado**.

**Criterios de aceptación:**
- [x] `CLAUDE.md` no contiene la ruta absoluta `$HOME/.local/share/containers/podman/machine/podman.sock` ni ningún otro hardcodeo de socket.
- [x] `CLAUDE.md` referencia `make infra` o los skills operativos como método canónico para levantar infraestructura.
- [x] `.claude/LEARNINGS.md` — la entrada del 2026-06-04 en "Cómo aplicar" recomienda `make infra` en lugar del comando hardcodeado.
- [x] Cualquier otro hardcodeo de rutas absolutas en la sección de comandos de CLAUDE.md es reemplazado por referencias portables (Makefile, skills, o rutas relativas).
- [x] `.claude/settings.local.json` usa `$COMPOSE exec <servicio>` en lugar de nombres de contenedor con prefijo de proyecto.

**Notas:** El patrón de "Cómo aplicar" en LEARNINGS.md debe seguir siendo una entrada histórica (lo que se aprendió), pero la solución recomendada debe ser portable. La entrada existente del 2026-06-03 ya documenta el mecanismo de detección; esta corrección es complementaria.

---

### US-02: Portabilidad de archivos de infraestructura `[Should]`

> Como **desarrollador que usa Podman en macOS**, quiero **que los archivos de infraestructura (compose files, READMEs de deploy) funcionen sin requerir Docker Engine**, para que **pueda usar LocalStack y seguir las instrucciones de deploy sin fricción**.

**Criterios de aceptación:**
- [x] `docker-compose.localstack.yml` no fuerza el montaje de `/var/run/docker.sock` hardcodeado. En su lugar, usa una variable de entorno (`DOCKER_SOCK`) con fallback a `/var/run/docker.sock`, o se elimina el archivo si no está en uso activo.
- [x] `infra/terraform/README.md` incluye una nota de compatibilidad indicando que los comandos `docker` pueden reemplazarse por `podman` (o usar `alias docker=podman`).
- [x] Si `docker-compose.localstack.yml` se mantiene, el script `scripts/validate-tf-localstack.sh` (o el mecanismo que lo invoca) pasa la variable `DOCKER_SOCK` correctamente.

**Notas:** Si `docker-compose.localstack.yml` no se usa en el flujo de desarrollo actual, la opción preferida es eliminarlo para reducir superficie de mantenimiento. Si está en uso, la corrección con variable de entorno es el camino.

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|-----|-----------|-----------------|
| US-01 | — | sí (capa 1) |
| US-02 | — | sí (capa 1) |

---

## Escenarios BDD

```gherkin
Feature: Comandos portables en el harness (US-01)
  Como desarrollador que clona el repositorio por primera vez
  Quiero ejecutar los comandos documentados sin editar rutas
  Para que el onboarding sea inmediato

  Background:
    Given que el repositorio fue clonado en una máquina nueva
    And que el desarrollador tiene Podman instalado (o Docker, o ninguno)

  Scenario: Levantar infraestructura siguiendo CLAUDE.md
    Given que el desarrollador lee la sección "Comandos" de CLAUDE.md
    When  ejecuta el comando documentado para levantar infraestructura
    Then  el comando NO contiene rutas absolutas a /Users/<usuario>
    And   el comando funciona independientemente del motor de contenedores instalado
    And   si no hay motor instalado, el mensaje de error es claro (no "socket not found")

  Scenario: Consultar LEARNINGS.md para resolver un problema de infraestructura
    Given que el desarrollador busca en LEARNINGS.md cómo levantar infraestructura
    When  lee la entrada del 2026-06-04 en la sección "Cómo aplicar"
    Then  el comando recomendado es portable (make o skill, no ruta hardcodeada)

  Scenario: Agente de IA ejecuta comandos con permisos de settings.local.json
    Given que el archivo .claude/settings.local.json contiene reglas allow para comandos de contenedores
    When  el agente ejecuta un comando con nombre de contenedor
    Then  el comando usa $COMPOSE exec <servicio> en lugar de docker exec <nombre-contenedor-con-prefijo>
```

```gherkin
Feature: Portabilidad de infraestructura (US-02)
  Como desarrollador que usa Podman en macOS
  Quiero que los archivos de infraestructura no asuman Docker
  Para que LocalStack y los scripts de deploy funcionen en mi entorno

  Background:
    Given que el desarrollador tiene Podman instalado (sin Docker)
    And que Podman expone su socket en una ruta no estándar (ej. /var/run/docker.sock no existe)

  Scenario: Levantar LocalStack con Podman
    Given que docker-compose.localstack.yml define un volumen para el socket
    When  se ejecuta docker compose (o podman compose) up
    Then  el socket se resuelve desde una variable de entorno (DOCKER_SOCK)
    And   si la variable no está definida, usa el fallback /var/run/docker.sock
    And   LocalStack puede iniciar correctamente

  Scenario: Leer instrucciones de deploy a ECR
    Given que el desarrollador lee infra/terraform/README.md
    When  encuentra comandos que usan `docker`
    Then  hay una nota indicando que puede usar `podman` como reemplazo
    And   la nota sugiere `alias docker=podman` como alternativa
```

---

## Plan de Tests TDD

### US-01 — Comandos portables en la documentación del harness

**Unitarios / Validación estática**
- [x] [RED]   Test: `grep -r "fabianmunoz" CLAUDE.md` retorna 0 matches para rutas hardcodeadas  
- [x] [GREEN] Reemplazar hardcodeos con referencias a `make infra` o skills
- [x] [RED]   Test: `grep -r "fabianmunoz" .claude/LEARNINGS.md` retorna 0 matches en sección "Cómo aplicar"  
- [x] [GREEN] Actualizar LEARNINGS.md con comando portable
- [x] [RED]   Test: `grep -r "fabianmunoz" .claude/settings.json` retorna 0 matches para rutas absolutas  
- [x] [GREEN] Mover reglas con rutas absolutas a `.claude/settings.local.json`

**Integración**
- [x] Test: `make infra` levanta infraestructura correctamente (o falla con mensaje claro si no hay motor)
- [x] Test: `make dev` inicia servicios backend sin errores de socket

**Edge cases / casos negativos**
- [x] Test: Clonar el repo en una máquina sin Podman ni Docker → los comandos documentados indican el requisito claramente
- [x] Test: `.claude/settings.local.json` no existe → `.claude/settings.json` sigue siendo funcional con reglas base

### US-02 — Portabilidad de archivos de infraestructura

**Unitarios / Validación estática**
- [x] [RED]   Test: `docker-compose.localstack.yml` no contiene `/var/run/docker.sock` hardcodeado (o el archivo fue eliminado)  
- [x] [GREEN] Usar variable `DOCKER_SOCK` con fallback, o eliminar archivo
- [x] [RED]   Test: `grep -c "docker " infra/terraform/README.md` no está acompañado de nota de compatibilidad Podman  
- [x] [GREEN] Agregar nota de compatibilidad

**Integración**
- [x] Test: `DOCKER_SOCK=/tmp/podman.sock podman compose -f docker-compose.localstack.yml up` no falla por socket no encontrado

**Edge cases / casos negativos**
- [x] Test: Variable `DOCKER_SOCK` no definida → se usa fallback `/var/run/docker.sock`

---

## Definition of Done

- [x] `CLAUDE.md` no contiene rutas absolutas hardcodeadas (verificar con `grep -r "fabianmunoz" CLAUDE.md .claude/LEARNINGS.md .claude/settings.json`)
- [x] `make infra` (o el comando documentado equivalente) funciona en una máquina limpia con Podman
- [x] `.claude/settings.local.json` usa `$COMPOSE exec <servicio>` para comandos de contenedores
- [x] `docker-compose.localstack.yml` usa `DOCKER_SOCK` variable o fue eliminado
- [x] `infra/terraform/README.md` tiene nota de compatibilidad Podman
- [x] Las entradas de LEARNINGS.md del 2026-06-04 recomiendan comandos portables
- [x] El spec queda actualizado con sección `## Resultado` al cierre
- [x] Rama fusionada a `dev` local sin conflictos

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | Ninguna — todos los cambios son en archivos del repositorio |
| Riesgo técnico | Si `docker-compose.localstack.yml` se elimina y alguien lo necesita, deberá recuperarse del historial de git |
| Suposición a validar | `docker-compose.localstack.yml` no está en uso activo (validar con `git log` y preguntar si es necesario) |

---

## Resultado

**Fecha de finalización:** 2026-06-04
**Status del spec:** completed

### Implementado
- [x] US-01: Comandos portables en la documentación del harness — CLAUDE.md, LEARNINGS.md, settings.json y settings.local.json corregidos
- [x] US-02: Portabilidad de archivos de infraestructura — docker-compose.localstack.yml usa `${DOCKER_SOCK}`, terraform README con nota Podman

### No implementado / Desviaciones
- `docker-compose.localstack.yml` se mantuvo (está en uso activo, commit `39b8a2f`); se corrigió con variable de entorno en lugar de eliminar
- `.claude/settings.local.json`: se mantienen rutas absolutas a `$HOME/` por ser archivo personal (no trackeado en git tras agregar a `.gitignore`)
- Se ajustó el test 1.4 para buscar el patrón `DOCKER_HOST=unix://` en lugar de `podman.sock` (evita falsos positivos con menciones históricas legítimas en LEARNINGS.md)

### Archivos modificados
| Archivo | Cambio |
|---|---|
| `CLAUDE.md` L135-136 | `make infra` portable en lugar de comando hardcodeado |
| `CLAUDE.md` L488 | Placeholder genérico (`$HOME/...`) en regla de portabilidad |
| `.claude/LEARNINGS.md` L412 | `make infra` en "Cómo aplicar" |
| `.claude/settings.json` | 10 reglas despersonalizadas: rutas absolutas → portables o movidas a local |
| `.claude/settings.local.json` | `$COMPOSE exec kafka` + `$COMPOSE ps`; reglas migradas desde settings.json |
| `.gitignore` | Agregado `.claude/settings.local.json` |
| `docker-compose.localstack.yml` | `${DOCKER_SOCK:-/var/run/docker.sock}` |
| `infra/terraform/README.md` | Nota de compatibilidad Podman |
| `scripts/test-portabilidad-harness.sh` | Nuevo: 9 tests de validación estática de portabilidad |

### Tests
- Portabilidad del harness: 9/9 pasando (script `scripts/test-portabilidad-harness.sh`)
- Suite del proyecto: 174/174 pasando (authorization-service: 94, bff: 7, sse-server: 8, mobile: 65)
- Typecheck: 6/6 packages OK
- JSON syntax: settings.json y settings.local.json válidos
