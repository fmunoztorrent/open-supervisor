# Spec: Prevención automática de hardcodeos en el harness

**Fecha:** 2026-06-04  
**Stack inferido:** Shell scripts + Node.js (plugin opencode)  
**Estado:** Completed  

---

## Contexto

En la feature anterior (`feature/portabilidad-harness-podman`) corregimos 8 hardcodeos distribuidos en 5 archivos del harness. Sin embargo, la corrección fue **reactiva**: los hardcodeos llegaron al repositorio y permanecieron ahí hasta que alguien los detectó. Nada impide que nuevos hardcodeos vuelvan a introducirse.

Actualmente, el proyecto tiene **cero validación mecánica de hardcodeos**:

- El pre-commit hook solo verifica que el pipeline esté cerrado.
- El plugin pipeline-enforcer solo controla el flujo de scopes.
- Los agentes de IA tienen reglas escritas contra hardcodeos, pero son texto que puede ignorarse.
- No hay CI que escanee el código.

Esta feature agrega **enforcement mecánico** en tres niveles:

1. **Pre-commit hook**: bloquea commits que introduzcan hardcodeos.
2. **Script standalone**: validación manual/diagnóstico que puede usarse en CI.
3. **Plugin de opencode**: bloquea edits en tiempo real si el agente intenta escribir un hardcodeo.

El objetivo es que sea **físicamente imposible** (no solo desaconsejado) introducir hardcodeos en el repositorio.

**Fuera de scope:**
- Validación de secretos (API keys, tokens, passwords) — requiere tooling diferente (ej. `detect-secrets`, `trufflehog`).
- Linting de estilo de código — ESLint ya lo cubre.
- Validación de imports de infraestructura en use-cases (regla de arquitectura hexagonal) — se documenta pero no se automatiza aún.
- CI/CD hosting.

**Ambigüedades identificadas:**
- ¿El plugin de opencode debe bloquear también `write` o solo `edit`? `write` crea archivos nuevos (más probable que contengan hardcodeos).
- ¿Qué tan agresivo debe ser el pre-commit hook? ¿Debe escanear TODO el repo o solo archivos staged?

---

## REASONS Canvas

<REASONS>
  <Rationale>Corregir hardcodeos después de que entran al repositorio es costoso: requiere un spec, un pipeline de 6 pasos, y tiempo de QA. Prevenirlos mecánicamente es más barato y garantiza que el problema no reaparezca. La feature anterior ya definió el patrón de lo que ES un hardcodeo; ahora lo codificamos en validaciones automáticas.</Rationale>

  <Explanation>Se implementan tres capas de defensa. Capa 1 (plugin opencode): bloquea la escritura en tiempo real; el agente recibe feedback inmediato. Capa 2 (pre-commit hook): última línea de defensa antes de que el hardcodeo entre al historial de git. Capa 3 (script standalone): permite auditorías manuales y puede integrarse en CI futuro. Las tres capas comparten el mismo script de reglas (`scripts/validate-hardcodes.sh`) para evitar duplicación de lógica.</Explanation>

  <Assumptions>
    - Los agentes de IA (Claude Code, opencode) son la principal fuente de hardcodeos (no desarrolladores humanos editando a mano).
    - El plugin pipeline-enforcer ya tiene acceso al contenido de `edit`/`write` via `tool.execute.before`.
    - El pre-commit hook de git (`core.hooksPath`) ya está configurado y es el punto de entrada para validaciones pre-commit.
    - Los patrones de hardcodeo identificados en la feature anterior (`/Users/`, `podman.sock`, `DOCKER_HOST=unix://`, nombres de contenedor con prefijo) son representativos de lo que queremos prevenir.  # hardcode-ok: spec documentation
  </Assumptions>

  <Scrutiny>
    - ¿Qué pasa si un hardcodeo legítimo necesita estar en un archivo? → El script debe tener un mecanismo de allowlist (ej. `# hardcode-ok: razón` en comentarios) o excluir ciertos archivos (`.claude/settings.local.json`).
    - ¿El plugin de opencode agrega latencia perceptible? → El escaneo es una regex simple sobre el string de contenido; <1ms overhead.
    - ¿Qué pasa si el pre-commit hook es muy lento? → Solo escanea archivos staged (no todo el repo), usando `git diff --cached`.
    - ¿Qué patrones adicionales deberíamos buscar? → `@Inject('string')`, `process.env.` fuera de ConfigModule, URLs hardcodeadas. Estos pueden agregarse incrementalmente.
  </Scrutiny>

  <Objections>
    - "El pre-commit hook ya es suficiente, no necesitamos el plugin" → El plugin da feedback en tiempo real al agente, evitando que escriba 50 líneas para luego descubrir en el commit que todo está mal. Feedback inmediato > feedback diferido.
    - "Los agentes ya tienen reglas contra hardcodeos en sus instrucciones" → Las reglas en texto no son enforcement. El plugin es enforcement mecánico. Son complementarios, no redundantes.
  </Objections>

  <Novelty>Primera validación de contenido (no de proceso) en el harness. Hasta ahora, todos los hooks y plugins validaban estado del pipeline. Esto extiende el harness para validar calidad de código.</Novelty>

  <Substitutes>
    - **Alternativa: Usar un linter externo (ej. ESLint plugin custom).** Descartada: requeriría configurar ESLint para todos los servicios, mantener un plugin npm, y no cubriría archivos que no son JS/TS (shell scripts, markdown, YAML).
    - **Alternativa: Solo documentar la regla en CLAUDE.md.** Descartada: ya lo hicimos en la feature anterior y no es suficiente. Los agentes pueden ignorar instrucciones.
    - **Alternativa: pre-commit hook sin plugin.** Aceptable como MVP pero deja un gap: el agente no sabe que está hardcodeando hasta que intenta commitear.
  </Substitutes>
</REASONS>

---

## Historias de Usuario

### US-01: Script de validación de hardcodeos + pre-commit hook `[Must]`

> Como **desarrollador que hace commit**, quiero **que git rechace automáticamente cualquier archivo que introduzca hardcodeos de rutas, sockets o nombres de contenedor**, para que **sea imposible que estos patrones lleguen al historial del repositorio**.

**Criterios de aceptación:**
- [ ] Existe `scripts/validate-hardcodes.sh` que escanea archivos pasados como argumento y retorna código de error si encuentra hardcodeos.
- [ ] El script busca al menos estos patrones: paths absolutos de usuario (`/Users/`, `/home/`), sockets Podman/Docker hardcodeados (`podman.sock`, `docker.sock` como string literal no en variable), `DOCKER_HOST=unix://`, nombres de contenedor con prefijo de proyecto (`<proyecto>-<servicio>-<num>`).  # hardcode-ok: spec doc
- [ ] El script permite excluir archivos vía allowlist (`.claude/settings.local.json`, entradas en `.gitignore`).
- [ ] El script devuelve mensajes de error descriptivos indicando archivo, línea y patrón detectado.
- [ ] `.opencode/pipeline/pre-commit.sh` invoca el script sobre los archivos staged (`git diff --cached --name-only`).
- [ ] Si el script encuentra hardcodeos, el commit se aborta con mensaje claro.

**Notas:** El script debe ser standalone para poder ejecutarse manualmente (`bash scripts/validate-hardcodes.sh archivo1 archivo2`) o desde CI. La allowlist puede ser un archivo `.hardcode-allowlist` en la raíz del repo o comentarios inline (`# hardcode-ok: <razón>`).

---

### US-02: Plugin pipeline-enforcer detecta hardcodeos en tiempo real `[Must]`

> Como **agente de IA que edita archivos**, quiero **recibir feedback inmediato cuando intento escribir un hardcodeo**, para que **pueda corregirlo antes de continuar y no perder tiempo rehaciendo trabajo**.

**Criterios de aceptación:**
- [ ] `.opencode/plugins/pipeline-enforcer.js` extiende el hook `tool.execute.before` para `edit` y `write`.
- [ ] Antes de permitir la operación, escanea el contenido (`oldString`/`newString` en `edit`, `content` en `write`) contra los mismos patrones que `validate-hardcodes.sh`.
- [ ] Si se detecta un hardcodeo, bloquea la operación y devuelve un mensaje de error indicando el patrón detectado y cómo corregirlo.
- [ ] El mensaje de error incluye ejemplos de la forma correcta (ej. "Usá `make infra` en lugar de hardcodear el socket Podman").
- [ ] El plugin **no** bloquea archivos en la allowlist (`.claude/settings.local.json`).
- [ ] El escaneo no agrega latencia perceptible (<10ms por operación).

**Notas:** Los patrones deben estar definidos en un solo lugar (el script `validate-hardcodes.sh`) y el plugin debe invocar el script o compartir las mismas regex. Si compartir código entre bash y Node.js es complejo, se puede duplicar las regex (con un comentario que indique mantener sincronizadas).

---

### US-03: Documentación del sistema de prevención en CLAUDE.md `[Should]`

> Como **nuevo desarrollador o agente de IA**, quiero **entender qué hardcodeos están prohibidos y cómo funcionan las validaciones**, para que **pueda escribir código portable desde el primer momento**.

**Criterios de aceptación:**
- [ ] `CLAUDE.md` tiene una sección (o subsección) que documenta las reglas de hardcodeo.
- [ ] La documentación lista los patrones prohibidos con ejemplos de lo incorrecto y lo correcto.
- [ ] Explica cómo funciona el sistema de prevención (plugin → pre-commit → script standalone).
- [ ] Indica cómo usar la allowlist si un hardcodeo es legítimo.

**Notas:** Esta sección puede ir dentro de "Convenciones" o como una sección nueva "Validaciones automáticas". Debe ser concisa (no más de 15-20 líneas).

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|-----|-----------|-----------------|
| US-01 | — | sí (capa 1) |
| US-02 | — | sí (capa 1) |
| US-03 | US-01, US-02 | no (capa 2 — documenta lo implementado) |

---

## Escenarios BDD

```gherkin
Feature: Prevención de hardcodeos en commits (US-01)
  Como desarrollador que hace commit
  Quiero que git rechace hardcodeos automáticamente
  Para que no lleguen al historial del repositorio

  Scenario: Commit con hardcodeo de ruta absoluta es rechazado
    Given un archivo staged contiene "/Users/juan/proyecto/config.ts"  # hardcode-ok: spec doc
    When  ejecuto git commit
    Then  el pre-commit hook detecta el hardcodeo
    And   el commit es abortado
    And   el mensaje de error indica el archivo y la línea

  Scenario: Commit sin hardcodeos es aceptado
    Given todos los archivos staged usan rutas relativas o variables
    When  ejecuto git commit
    Then  el pre-commit hook pasa
    And   el commit se completa normalmente

  Scenario: Archivo en allowlist no es escaneado
    Given un archivo en .hardcode-allowlist contiene "/Users/juan/.claude/"  # hardcode-ok: spec doc
    When  ejecuto git commit con ese archivo staged
    Then  el pre-commit hook no reporta hardcodeo en ese archivo
    And   el commit se completa normalmente
```

```gherkin
Feature: Detección de hardcodeos en tiempo real (US-02)
  Como agente de IA que edita archivos
  Quiero recibir feedback inmediato al escribir hardcodeos
  Para corregirlos antes de continuar

  Scenario: Agente intenta escribir ruta absoluta
    Given el agente ejecuta edit con newString que contiene "/Users/test-user/"  # hardcode-ok: spec doc
    When  el plugin enforcer evalúa la operación
    Then  la operación es bloqueada
    And   el mensaje de error explica que las rutas absolutas están prohibidas
    And   sugiere usar rutas relativas o variables

  Scenario: Agente escribe contenido portable
    Given el agente ejecuta edit con newString que usa rutas relativas
    When  el plugin enforcer evalúa la operación
    Then  la operación es permitida

  Scenario: Agente edita archivo en allowlist
    Given el agente ejecuta edit sobre .claude/settings.local.json
    When  el nuevo contenido contiene "/Users/test-user/.claude/"  # hardcode-ok: spec doc
    Then  la operación es permitida (archivo en allowlist)
```

---

## Plan de Tests TDD

### US-01 — Script de validación + pre-commit hook

**Unitarios / Validación estática**
- [ ] [RED]   Test: `echo '/Users/test/config.ts  # hardcode-ok: spec doc' | bash scripts/validate-hardcodes.sh` retorna error  
- [ ] [GREEN] Script detecta path absoluto de usuario
- [ ] [RED]   Test: archivo con `DOCKER_HOST=unix:///tmp/podman.sock`  # hardcode-ok: spec doc es detectado  
- [ ] [GREEN] Script detecta socket hardcodeado
- [ ] [RED]   Test: archivo con `podman exec open-supervisor-kafka-1`  # hardcode-ok: spec doc es detectado  
- [ ] [GREEN] Script detecta nombre de contenedor con prefijo
- [ ] [RED]   Test: archivo portable (sin hardcodeos) pasa la validación  
- [ ] [GREEN] Script retorna 0 para archivos limpios
- [ ] [RED]   Test: archivo en allowlist con hardcodeos NO es reportado  
- [ ] [GREEN] Allowlist funciona correctamente

**Integración**
- [ ] Test: `git commit` con archivo staged que contiene hardcodeo → abortado
- [ ] Test: `git commit` con archivos staged limpios → exitoso

### US-02 — Plugin enforcer en tiempo real

**Unitarios**
- [ ] [RED]   Test: `edit` con `newString` que contiene `/Users/test/` →  # hardcode-ok: spec doc bloqueado  
- [ ] [GREEN] Plugin detecta hardcodeo en edit
- [ ] [RED]   Test: `write` con `content` que contiene `podman.sock` hardcodeado → bloqueado  
- [ ] [GREEN] Plugin detecta hardcodeo en write
- [ ] [RED]   Test: `edit` con contenido portable → permitido  
- [ ] [GREEN] Plugin no bloquea contenido válido
- [ ] [RED]   Test: `write` sobre `.claude/settings.local.json` con hardcodeo → permitido  
- [ ] [GREEN] Plugin respeta allowlist

**Integración**
- [ ] Test: Flujo completo: agente intenta escribir hardcodeo → bloqueado → corrige → escribe portable → permitido

### US-03 — Documentación en CLAUDE.md

**Validación estática**
- [ ] [RED]   Test: `grep -c "hardcodeo" CLAUDE.md` retorna al menos las menciones necesarias  
- [ ] [GREEN] CLAUDE.md documenta patrones prohibidos y sistema de prevención

---

## Definition of Done

- [x] `scripts/validate-hardcodes.sh` existe y detecta al menos 4 patrones de hardcodeo
- [x] `.opencode/pipeline/pre-commit.sh` invoca `validate-hardcodes.sh` sobre staged files
- [x] `.opencode/plugins/pipeline-enforcer.js` bloquea `edit`/`write` con hardcodeos
- [x] El plugin muestra mensajes de error útiles con sugerencias de corrección
- [x] Existe allowlist para archivos que legítimamente contienen paths absolutos
- [x] `CLAUDE.md` documenta el sistema de prevención
- [x] Los tests de portabilidad existentes (`test-portabilidad-harness.sh`) siguen pasando
- [x] La suite de tests del proyecto (174 tests) sigue pasando

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | Ninguna — todos los cambios son en scripts y plugins del repositorio |
| Riesgo técnico | El plugin de opencode podría interferir con ediciones legítimas si los patrones son demasiado amplios (falsos positivos) |
| Riesgo técnico | Si `validate-hardcodes.sh` es muy lento, el pre-commit hook podría degradar la experiencia de commit |
| Suposición a validar | Los patrones definidos en el script de validación cubren todos los casos de hardcodeo que queremos prevenir |

---

## Resultado

**Fecha de finalización:** 2026-06-04
**Status del spec:** completed

### Implementado
- [x] US-01: Script de validación `validate-hardcodes.sh` + integración con pre-commit hook
- [x] US-02: Plugin pipeline-enforcer con detección de hardcodeos en tiempo real
- [x] US-03: Documentación del sistema de prevención en CLAUDE.md

### No implementado / Desviaciones
- El plugin comparte los patrones vía archivo JSON pero no invoca el script bash (lee los patrones del mismo JSON). Esto es suficiente para mantener sincronización.
- La allowlist usa `# hardcode-ok:` como comentario inline; no se implementó un archivo `.hardcode-allowlist` separado porque el JSON de patrones ya centraliza la configuración.

### Archivos creados/modificados
| Archivo | Cambio |
|---|---|
| `.opencode/pipeline/hardcode-patterns.json` | **Nuevo** — patrones compartidos (3 patrones, allowlist) |
| `scripts/validate-hardcodes.sh` | **Nuevo** — script standalone de validación |
| `.opencode/pipeline/pre-commit.sh` | Extendido — invoca validate-hardcodes.sh sobre staged files |
| `.opencode/plugins/pipeline-enforcer.js` | Extendido — detecta hardcodeos en `edit`/`write` en tiempo real |
| `CLAUDE.md` | Nueva sección "Validaciones automáticas" + fix de comando Podman |
| `spec/2026-06-04-prevencion-hardcodeos-harness.spec.md` | **Nuevo** — spec completo con REASONS Canvas |
| `scripts/test-prevencion-hardcodeos.sh` | **Nuevo** — 7 tests de verificación del sistema |

### Tests
- Prevención de hardcodeos: 7/7 pasando
- Suite del proyecto: 174/174 pasando
- Typecheck: 6/6 OK
- Validación de hardcodeos en archivos propios: 7/7 limpios
