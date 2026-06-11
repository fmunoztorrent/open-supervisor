# Spec: Mejora del harness de agentes (Agents DX)

**Fecha:** 2026-06-03
**Stack inferido:** Node.js / pnpm monorepo
**Estado:** completed

---

## Contexto

El proyecto open-supervisor tiene un pipeline de 6 pasos para features y un conjunto de agentes especializados (spec, architect, qa, backend, frontend). Sin embargo, una auditoría contra las mejores prácticas de Anthropic para Claude Code en codebases grandes reveló 6 gaps que limitan la eficiencia del equipo:

1. No existe `.claudeignore` → Claude escanea `node_modules`, `dist`, etc.
2. El root `CLAUDE.md` mezcla arquitectura, comandos y flujo sin un codebase map escaneable.
3. Solo hay un `Stop` hook básico; no hay `Start` hook ni hooks de lint/format.
4. No hay LSP configurado para TypeScript → búsquedas textuales en vez de por símbolo.
5. No hay skills locales del proyecto (`.opencode/skills/`) para patrones recurrentes.
6. No hay cadencia de revisión periódica de la configuración.

Fuera de scope: modificar el flujo de pipeline existente, cambiar agentes de `.claude/agents/`, o migrar a otro tooling.

**Ambigüedades identificadas:**
- LSP requiere un plugin de code intelligence — verificar disponibilidad exacta antes de implementar.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>El artículo "How Claude Code works in large codebases" de Anthropic (May 2026) documenta patrones probados en despliegues enterprise. Nuestro proyecto tiene 6 gaps respecto a esos patrones. Cerrarlos reduce fricción en sesiones y mejora la calidad del contexto que reciben los agentes.</Rationale>
  <Explanation>Cada gap se resuelve con un cambio de configuración o archivo nuevo, sin modificar el pipeline existente. Se implementan en orden de impacto/bajo-esfuerzo primero: `.claudeignore` → codebase map → hooks → LSP → skills locales → revisión periódica.</Explanation>
  <Assumptions>El equipo usa opencode como harness principal. LSP está disponible via plugin/code-intelligence. Los skills locales serán adoptados por los agentes al estar en `skills.paths` del `opencode.json`.</Assumptions>
  <Scrutiny>¿Realmente necesitamos skills locales o el CLAUDE.md por subdirectorio ya cubre ese conocimiento? ¿El LSP vale el esfuerzo de setup o el grep textual es suficiente en un monorepo de este tamaño?</Scrutiny>
  <Objections>"Son solo 6 microservicios, no es un codebase enorme." — El tamaño actual no es el problema, es la base para escalar sin fricción. Cada gap resuelto ahora cuesta menos que cuando el proyecto tenga 20 microservicios.</Objections>
  <Novelty>No hay cambios en el pipeline ni en los agentes existentes. Todo es configuración del harness — archivos nuevos o modificaciones a archivos de config existentes.</Novelty>
  <Substitutes>No hacer nada (seguir con la fricción actual). Hacer solo los 3 de bajo esfuerzo y dejar LSP/skills para después.</Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: Excluir artefactos de build del escaneo `[Must]`

> Como **agente (Claude/opencode)**, quiero **no perder contexto escaneando `node_modules`, `dist` y build artifacts**, para que **cada sesión use su ventana de contexto en código relevante**.

**Criterios de aceptación:**
- [x] Existe `.claudeignore` en la raíz del proyecto
- [x] Excluye `node_modules/`, `dist/`, `coverage/`, `.pnpm-store/`, `android/app/build/`
- [x] Los agentes respetan las exclusiones en búsquedas

---

### US-02: Codebase map escaneable `[Must]`

> Como **agente**, quiero **un bloque `## Codebase map` al inicio de `CLAUDE.md` con tabla de directorios y propósito**, para que **pueda orientarme sin leer todo el archivo**.

**Criterios de aceptación:**
- [x] El root `CLAUDE.md` tiene sección `## Codebase map` antes de Arquitectura
- [x] Cada fila tiene directorio + descripción de una línea

---

### US-03: Start hook + lint hook `[Should]`

> Como **desarrollador**, quiero que **al iniciar una sesión se verifique el entorno y al editar código se corra lint automáticamente**, para que **los errores se detecten antes del typecheck manual**.

**Criterios de aceptación:**
- [x] Start hook existe (verifica entorno en cada sesión)
- [x] Stop hook actualizado con recordatorio de spec

---

### US-04: LSP para TypeScript `[Could]`

> Como **agente**, quiero **tener navegación por símbolo (go-to-definition, find-references) via LSP**, para que **no tenga que hacer grep textual de nombres comunes en todo el monorepo**.

**Criterios de aceptación:**
- [x] `opencode.json` incluye `"lsp": true` (built-in tsserver)
- [x] `~/.claude/settings.json` incluye `ENABLE_LSP_TOOL` + `typescript-lsp@claude-plugins-official`
- [x] `typescript-language-server` instalado globalmente en el sistema
- [x] El agente puede seguir referencias de símbolos entre archivos del monorepo

---

### US-05: Skills locales del proyecto `[Should]`

> Como **agente**, quiero **tener skills locales en `.opencode/skills/` para patrones recurrentes (NestJS hexagonal, Kafka topics, SSE en RN)**, para que **pueda aplicar la convención correcta sin tenerla en el contexto de cada sesión**.

**Criterios de aceptación:**
- [x] Existe `.opencode/skills/nestjs-hexagonal/SKILL.md`
- [x] Existe `.opencode/skills/kafka-topic/SKILL.md`
- [x] Existe `.opencode/skills/react-native-sse/SKILL.md`
- [x] `opencode.json` incluye `skills.paths` apuntando a `.opencode/skills`

---

### US-06: Revisión periódica documentada `[Could]`

> Como **equipo**, quiero **tener documentado en `CLAUDE.md` que la configuración se revisa cada 3-6 meses**, para que **no se acumule deuda de configuración**.

**Criterios de aceptación:**
- [x] El root `CLAUDE.md` tiene sección `### Mantenimiento de la configuración` con cadencia 3-6 meses

---

## Escenarios BDD

```gherkin
Feature: Exclusion de artefactos — US-01
  Como agente
  Quiero no escanear build artifacts
  Para que el contexto no se desperdicie

  Scenario: node_modules no se indexa
    Given un agente busca "express" en el proyecto
    When usa grep en la raíz
    Then no debe devolver resultados dentro de node_modules/

Feature: Codebase map — US-02
  Como agente
  Quiero un mapa escaneable del monorepo
  Para orientarme rápido

  Scenario: agente lee el root CLAUDE.md
    Given un agente inicia una sesión
    When lee la seccion Codebase map
    Then encuentra 6+ filas con directorio y descripcion

Feature: Skills locales — US-05
  Como agente
  Quiero cargar un skill local cuando el tema es relevante
  Para no depender del contexto global

  Scenario: skil de NestJS hexagonal se activa
    Given un agente trabajando en authorization-service
    When menciona "nuevo use-case"
    Then el skill nestjs-hexagonal debe estar disponible
```

---

## Plan de implementación

### US-01 — `.claudeignore` (bajo esfuerzo)

**Archivos a modificar:**
- Crear `.claudeignore` en la raíz

### US-02 — Codebase map (bajo esfuerzo)

**Archivos a modificar:**
- `CLAUDE.md` — agregar `## Codebase map` antes de `## Arquitectura`

### US-03 — Hooks (medio esfuerzo)

**Archivos a modificar:**
- `.claude/settings.json` — agregar Start hook

### US-04 — LSP (medio esfuerzo, depende de plugin)

**Archivos a modificar:**
- `opencode.json` o `.claude/settings.json` según plugin

### US-05 — Skills locales (medio esfuerzo)

**Archivos a crear:**
- `.opencode/skills/nestjs-hexagonal/SKILL.md`
- `.opencode/skills/kafka-topic/SKILL.md`
- `.opencode/skills/react-native-sse/SKILL.md`

**Archivos a modificar:**
- `opencode.json` — agregar `skills.paths`

### US-06 — Revisión periódica (bajo esfuerzo)

**Archivos a modificar:**
- `CLAUDE.md` — agregar nota de cadencia

---

## Definition of Done

- [x] `.claudeignore` creado con exclusiones correctas
- [x] Codebase map visible en root `CLAUDE.md`
- [x] Start hook funcionando
- [x] 3 skills locales creados y registrados en `opencode.json`
- [x] Cadencia de revisión documentada
- [x] typecheck y lint sin regresiones (errores pre-existentes documentados)

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | ~~Plugin de code intelligence para LSP — verificar compatibilidad con opencode~~ (Resuelto: LSP es built-in en opencode v1.15+, plugin oficial Anthropic para Claude Code) |
| Riesgo técnico | opencode puede no soportar hooks de la misma forma que Claude Code — validar |
| Suposición a validar | Que `skills.paths` en `opencode.json` funciona para skills locales del proyecto |

## Resultado

**Fecha de finalización:** 2026-06-03
**Status del spec:** completed

### Implementado
- [x] US-01: `.claudeignore` con exclusiones de build artifacts
- [x] US-02: Codebase map escaneable en root CLAUDE.md
- [x] US-03: Start hook agregado + Stop hook actualizado con recordatorio de spec
- [x] US-04: LSP para TypeScript — opencode (built-in tsserver via `"lsp": true`), Claude Code (plugin oficial Anthropic via `ENABLE_LSP_TOOL`)
- [x] US-05: 3 skills locales (nestjs-hexagonal, kafka-topic, react-native-sse)
- [x] US-06: Mantenimiento de configuración documentado (cadencia 3-6 meses)

### Tests
- No aplica (cambios de configuración, no de código)
- typecheck: errores pre-existentes (TS2307 en workspace packages, documentados en LEARNINGS.md) — sin regresiones nuevas
