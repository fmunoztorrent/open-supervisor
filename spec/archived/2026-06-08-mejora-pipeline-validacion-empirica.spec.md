# Spec: Mejora del Pipeline — Validación Empírica + Automejora

**Fecha:** 2026-06-08
**Stack inferido:** Shell + Node.js + Markdown
**Estado:** Completed
**Revisión:** 2

---

## Contexto

El pipeline actual (6 pasos) cierra features tras `pnpm test` + `pnpm typecheck` en verde. Esto permitió que 4 bugs sobrevivieran en la feature `hamburger-menu`:
1. Dependencia `async-storage@^3.1.1` incompatible con Kotlin 1.9.25
2. Endpoint `/authorization/requests/history` 404 porque `dist/` no se rebuildó
3. Servicio crasheó silenciosamente tras restart
4. Ruta `/api/requests/history` en spec no coincidía con ruta real `/authorization/requests/history`

Todos eran detectables con validación en entorno real (build Android + curl + UIAutomator).

Además, los aprendizajes de cada feature se registran en LEARNINGS.md pero no se cierra el ciclo: lecciones recurrentes no se promueven automáticamente a reglas activas ni modifican el pipeline.

**Fuera de scope:** Refactor del plugin pipeline-enforcer más allá de A16/A17. Cambios en CI externa. Integración con Detox E2E.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    El pipeline debe hacerse más estricto con cada error que se repite. Sin un paso de validación
    empírica, bugs de integración (build, runtime, rutas) sobreviven a tests unitarios. Sin un
    ciclo de automejora, los mismos errores se repiten feature tras feature.
  </Rationale>
  <Explanation>
    Se agrega un paso 5b/6 Validación Empírica condicional (solo si la feature toca mobile,
    endpoints, SSE o infra). Se agrega un paso 7 Automejora post-cierre que lee LEARNINGS.md,
    detecta patrones recurrentes, y promueve lecciones: nivel 1 → skill, nivel 2 → regla activa,
    nivel 3 → bloqueante del pipeline. El script extract-learnings.ts existente se extiende
    para cubrir los 3 niveles.
  </Explanation>
  <Assumptions>
    - LEARNINGS.md es append-only con slugs únicos por aprendizaje.
    - Cada skill de agente tiene secciones "Reglas activas" y "Lecciones recientes".
    - El emulador Android y los servicios backend están disponibles durante validación empírica.
  </Assumptions>
  <Scrutiny>
    - ¿El paso 5b no ralentiza features triviales? → Es condicional: solo se activa si la feature toca ciertas áreas.
    - ¿La automejora introduce cambios no revisados? → El commit de automejora es separado y revisable en el PR.
  </Scrutiny>
  <Objections>
    - "Esto añade overhead al pipeline" → El overhead de 5b (~2 min) es menor que el costo de bugs en producción.
    - "La automejora podría degradar skills con reglas incorrectas" → Solo promueve slugs que aparecen 2+ veces; la primera vez es solo registro.
  </Objections>
  <Novelty>
    - Primer paso de validación condicional en el pipeline (5b).
    - Primer sistema de 3 niveles de promoción de aprendizajes.
    - Primera modificación del pipeline por el propio pipeline (meta-mejora).
  </Novelty>
  <Substitutes>
    - CI/CD con emulador en GitHub Actions: descartado por costo y complejidad. Validación local es más rápida y ya tiene el emulador configurado.
    - Detox E2E: complementario, no sustituto. Detox cubre flujos completos; 5b cubre checks puntuales post-implementación.
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: Paso 5b — Validación Empírica condicional `[Must]`

> Como **agente implementador**, quiero **que el pipeline incluya un paso de validación en entorno real cuando la feature toca mobile, endpoints, SSE o infra**, para que **bugs de integración se detecten antes del cierre**.

**Criterios de aceptación:**
- [x] Archivo `.opencode/pipeline/validate-empirica.md` con checklists A/B/C/D
- [x] `close.md` referencia el paso 5b entre QA GREEN y Cierre
- [x] 4 tipos de checks: A (Mobile UI), B (Endpoints REST), C (SSE/Real-time), D (Infra/Dependencias)
- [x] Cada check tiene: qué valida, comando, señal de fallo
- [x] Fallo en cualquier check → pipeline vuelve a QA RED

### US-02: Paso 7 — Automejora post-cierre `[Must]`

> Como **equipo**, quiero **que el pipeline se auto-mejore después de cada feature, promoviendo lecciones recurrentes a reglas activas y bloqueantes**, para que **los mismos errores no se repitan**.

**Criterios de aceptación:**
- [x] `scripts/extract-learnings.ts` extendido con 3 niveles de promoción
- [x] Nivel 1 (1ª ocurrencia): agrega a "Lecciones recientes" en skill del agente
- [x] Nivel 2 (2ª ocurrencia): promueve a "Reglas activas" en skill del agente
- [x] Nivel 3 (3ª ocurrencia): agrega a "Accionables bloqueantes" en AGENTS.md
- [x] Paso 7 documentado en `close.md` como extensión del paso 6e

### US-03: 22 Accionables por agente `[Should]`

> Como **agente**, quiero **instrucciones claras y asignadas a mi rol para evitar errores conocidos**, para que **no dependa de mi memoria sino del sistema**.

**Criterios de aceptación:**
- [x] `.claude/AGENTS.md` con sección de accionables por agente
- [x] 22 accionables (A1-A22) asignados a 7 agentes
- [x] Cada skill de agente incluye sus accionables relevantes
- [x] `pipeline-enforcer.js` implementa A16 (excepción merge) y A17 (ignorar state.json)

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? | Capa |
|-----|-----------|-----------------|------|
| US-01 | — | sí | 1 |
| US-03 | — | sí | 1 |
| US-02 | US-01, US-03 | no (extiende el pipeline completo) | 2 |

---

## Definition of Done

- [x] `.opencode/pipeline/validate-empirica.md` existe con los 4 checklists
- [x] `.claude/AGENTS.md` existe con 22 accionables
- [x] `close.md` referencia pasos 5b y 7
- [x] 7 skills actualizados con sus accionables
- [x] `extract-learnings.ts` extendido con 3 niveles
- [x] `pipeline-enforcer.js` con A16 y A17
- [x] Mini-feature sintética pasa por el pipeline completo (incluyendo 5b)

---

## Riesgos

| Tipo | Detalle |
|------|---------|
| Riesgo técnico | `extract-learnings.ts` debe ser idempotente — ejecutar 2 veces no duplica reglas |
| Suposición | Los skills de agente tienen estructura Markdown predecible para que el script los actualice |

---

## Resultado

**Completado**: 2026-06-10
**Estado**: ✅ Completado
**Archivado**: true

### Implementado

- [x] US-01: Validación Empírica condicional — `validate-empirica.md` con 4 checklists, `close.md` con referencia 5b
- [x] US-02: Automejora post-cierre — `extract-learnings.ts` con 3 niveles de promoción, `close.md` con paso 7 documentado
- [x] US-03: 22 Accionables por agente — `AGENTS.md` con accionables, skills actualizados, `pipeline-enforcer.js` con A16/A17

### Desviaciones

- US-01: `validate-empirica.md` ya existía en origin/main; se corrigió bug de sintaxis shell en el bootstrap
- US-03: `AGENTS.md` y A16 ya existían en origin/main; se agregaron skills y A17
- US-02: Se agregó `extract-learnings.spec.ts` con 6 tests no contemplados en el spec original

### Tests

- Typecheck: 4/4 servicios ✅
- `validate-accionables.spec.sh`: 59/59 assertions ✅
- `extract-learnings.spec.ts`: 6/6 tests ✅
- `pnpm lint`: pre-existing issue (eslint no instalado en servicios) — sin cambios

### Commits

| Commit | Scope | Descripción |
|--------|-------|-------------|
| `70f79ab` | US-01 | fix: corregir sintaxis shell en bootstrap de validate-empirica |
| `89e256d` | US-03 | feat: 22 accionables por agente |
| `6c9cfb5` | US-02 | feat: 3 niveles de promoción en extract-learnings.ts |
