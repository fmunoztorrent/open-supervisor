# Spec: Test fixture — Descomposición y paralelización de scopes

**Fecha:** 2026-06-04
**Stack inferido:** opencode harness + bash + jq
**Estado:** completed — fixture de validación, no requiere implementación

> **Nota:** este spec es un **fixture de prueba** para validar el comportamiento del orquestador multi-scope descrito en `2026-06-04-descomposicion-paralelizacion-scopes.spec.md`. No es una feature real — sus "implementaciones" son triviales (crear archivos marcadores) y existen solo para forzar al agente a poblar `state.json` con scopes paralelos.

---

## Contexto

Para validar empíricamente que la mejora de descomposición + paralelización funciona, necesitamos un spec de prueba que:
1. Tenga ≥3 USTs independientes (dispara descomposición por la regla)
2. Tenga USTs con dependencias (verifica análisis topológico)
3. Los cambios pedidos sean triviales (para que el agente pueda ejecutarlos rápido sin contaminar el codebase real)

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>El spec principal de descomposición necesita un test empírico que confirme que el orquestador multi-scope funciona end-to-end. Sin este fixture, la mejora queda en "documentada pero no validada".</Rationale>
  <Explanation>El fixture tiene 4 USTs distribuidas en 2 capas topológicas: capa 1 = US-01 + US-02 (independientes), capa 2 = US-03 (depende de US-01) + US-04 (depende de US-02). El agente debe procesar US-01 y US-02 en paralelo, luego US-03 y US-04 en paralelo. Las implementaciones son crear archivos `.decomposition-test-marker-{ust-id}` en una carpeta `tmp/`, lo que mantiene el repo limpio.</Explanation>
  <Assumptions>(1) El spec se procesa en un entorno donde el fix del plugin (US-00 del spec principal) ya está aplicado. (2) `jq` está disponible en el sistema. (3) La carpeta `tmp/` está en `.gitignore` o se limpia después de la prueba.</Assumptions>
  <Scrutiny>¿Las 4 USTs son suficientes para validar la paralelización? — Sí: 2 scopes en capa 1 + 2 scopes en capa 2 = ejercicio real de topología. ¿El spec de prueba podría ejecutarse de forma "fake" sin realmente paralelizar? — El script de validación compara `started_at` de los scopes de capa 1: si difieren en <2s, se asume paralelización. Esto es una heurística, no prueba absoluta, pero es la mejor que podemos hacer con `state.json` solamente.</Scrutiny>
  <Objections>"Es un fixture, no código de producción" — Correcto. Se documenta como tal y se mantiene separado. "Los archivos `tmp/` ensucian el repo" — Se crean en una carpeta ignorada por git y se limpian en step 5 (QA GREEN).</Objections>
  <Novelty>Es un fixture nuevo — no hay precedente en el repo de specs de prueba controlada. La sección `## Dependencias entre USTs` es lo que lo hace útil como test: sin ella, no se puede validar la paralelización por capas.</Novelty>
  <Substitutes>(A) Test Jest con mocks de `state.json` — descartado porque no validaría el flujo real del agente. (B) Spec de producción real (no fixture) — descartado porque contaminaría el codebase con cambios no relacionados a la feature.</Substitutes>
</REASONS>
```

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|-----|-----------|-----------------|
| US-01 | — | sí (capa 1) |
| US-02 | — | sí (capa 1) |
| US-03 | US-01 | sí dentro de capa 2 |
| US-04 | US-02 | sí dentro de capa 2 |

**Topología esperada:**
- **Capa 1** (paralela): US-01, US-02
- **Capa 2** (paralela, después de capa 1): US-03, US-04

---

## Historias de Usuario

### US-01: Marker file para US-01 `[Must]`

> Como **orquestador de prueba**, quiero **que el sub-agente del scope `feature-test-us-01` cree el archivo `tmp/.decomposition-test-marker-us-01`**, para **validar que el scope US-01 se ejecutó en capa 1**.

**Criterios de aceptación:**
- [ ] Existe el archivo `tmp/.decomposition-test-marker-us-01` con contenido `US-01 executed at <ISO timestamp>`
- [ ] El scope `feature-test-us-01` está en `state.json` con `completed_at` set

---

### US-02: Marker file para US-02 `[Must]`

> Como **orquestador de prueba**, quiero **que el sub-agente del scope `feature-test-us-02` cree el archivo `tmp/.decomposition-test-marker-us-02`**, para **validar que el scope US-02 se ejecutó en capa 1 (en paralelo con US-01)**.

**Criterios de aceptación:**
- [ ] Existe el archivo `tmp/.decomposition-test-marker-us-02` con contenido `US-02 executed at <ISO timestamp>`
- [ ] El scope `feature-test-us-02` está en `state.json` con `completed_at` set
- [ ] El `started_at` de `feature-test-us-02` y `feature-test-us-01` difieren en menos de 2 segundos (paralelización)

---

### US-03: Marker file para US-03 (depende de US-01) `[Must]`

> Como **orquestador de prueba**, quiero **que el sub-agente del scope `feature-test-us-03` cree el archivo `tmp/.decomposition-test-marker-us-03` SOLO después de que US-01 haya terminado**, para **validar que la dependencia se respeta**.

**Criterios de aceptación:**
- [ ] Existe el archivo `tmp/.decomposition-test-marker-us-03` con contenido `US-03 executed at <ISO timestamp>`
- [ ] El scope `feature-test-us-03` está en `state.json` con `completed_at` set
- [ ] El `started_at` de `feature-test-us-03` es **posterior** al `completed_at` de `feature-test-us-01` (dependencia respetada)

---

### US-04: Marker file para US-04 (depende de US-02) `[Must]`

> Como **orquestador de prueba**, quiero **que el sub-agente del scope `feature-test-us-04` cree el archivo `tmp/.decomposition-test-marker-us-04` SOLO después de que US-02 haya terminado**, para **validar que la dependencia se respeta**.

**Criterios de aceptación:**
- [ ] Existe el archivo `tmp/.decomposition-test-marker-us-04` con contenido `US-04 executed at <ISO timestamp>`
- [ ] El scope `feature-test-us-04` está en `state.json` con `completed_at` set
- [ ] El `started_at` de `feature-test-us-04` es **posterior** al `completed_at` de `feature-test-us-02` (dependencia respetada)

---

## Plan de implementación

Por cada UST:
- Crear scope `[feature-test-us-XX]` con sus 6 pasos
- En el paso 4 (implementación): crear `tmp/.decomposition-test-marker-us-XX` con timestamp
- En el paso 5 (cierre): scope se marca como completado en `state.json`

---

## Definition of Done

- [ ] Los 4 marker files existen en `tmp/`
- [ ] Los 4 scopes están en `state.json` con `completed_at`
- [ ] Los scopes de capa 1 tienen `started_at` con diferencia <2s
- [ ] Los scopes de capa 2 tienen `started_at > completed_at` de sus dependencias
- [ ] `scripts/validate-decomposition.sh` corre y sale con código 0

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Prerrequisito | US-00 del spec principal (fix del plugin `todo.updated` → `tool.execute.after`) debe estar aplicado para que este fixture funcione end-to-end |
| Setup | `tmp/` debe existir; si no, crearla con `mkdir -p tmp` |
| Limpieza | Después de validar, los marker files se eliminan con `rm tmp/.decomposition-test-marker-*` |
