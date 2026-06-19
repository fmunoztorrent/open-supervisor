---
name: pipeline
description: Orquestador del pipeline de desarrollo de open-supervisor. Clasifica la tarea, ejecuta pre-spec.sh, lanza spec/architect/QA/implementador/cierre en orden obligatorio con el harness del proyecto. Usar con /pipeline "descripción de la tarea".
---

# pipeline — Orquestador del Harness

Ejecuta el pipeline correcto según el tipo de tarea. **El orden no es negociable.**

---

## Paso 0 — Clasificar la tarea

Analiza `$ARGUMENTS` y clasifica en **una** de estas categorías:

| Tipo | Señales | Pipeline |
|---|---|---|
| `feature` | nueva funcionalidad, nuevo endpoint, nuevo componente, nuevo script | 6 pasos |
| `bugfix` | "bug:", "fix:", "no funciona", "falla", "error en X" | 6 pasos (variante) |
| `debug` | "por qué", "investigar", "entender", "trazar" | triage → análisis → reporte |
| `chore` | cambiar variable, renombrar, actualizar config, LOG_LEVEL | scope → ejecutar → verify → close |
| `question` | "qué es", "cómo está estructurado", "dónde está", "cuántos" | responder directamente |

Si la clasificación no es clara, preguntar al usuario antes de continuar.

Anuncia la clasificación:
```
Tipo detectado: {tipo}
Pipeline: {nombre del pipeline}
```

---

## Paso 0.5 — TodoWrite INMEDIATO

**Antes de cualquier otra acción**, crear el TodoWrite con todos los pasos del pipeline.

Usar el prefijo `[scope.id]` donde `id` es `feature-<slug>`, `bugfix-<slug>`, o `chore-<slug>` (kebab, sin `/`). El harness usa este board para el enforcement de edición — sin scope activo en TodoWrite, `Edit`/`Write` están bloqueados mecánicamente.

**Feature / Bugfix:**
```
[feature.mi-feature]
[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect → validar viabilidad
[ ] 3/6 QA (RED) → tests que fallan
[ ] 4/6 Backend / Frontend → implementar
[ ] 5/6 QA (GREEN) → suite completa
[ ] 5b/6 Validación Empírica → checks reales
[ ] 6/6 Cierre → close.md
```

**Chore:**
```
[chore.mi-chore]
[▶] 1/4 Scope → delimitar cambio exacto
[ ] 2/4 Ejecutar → cambio mínimo
[ ] 3/4 Verify → typecheck + tests del área
[ ] 4/4 Cierre → close.md
```

---

## Paso 0.6 — Pre-flight del harness

Leer `.opencode/pipeline/start.md` y ejecutar:

```bash
bash .opencode/pipeline/pre-spec.sh
```

Si el script retorna error: **STOP**. Resolver cada issue según la tabla de `start.md` antes de continuar. Issues comunes:

| Issue | Cómo resolverlo |
|---|---|
| Working tree sucio | `git add . && git commit` o `git stash -u` |
| PRs abiertos | Mergear, cerrar o esperar |
| Commits huérfanos en dev (feat/fix) | `gh pr create --base main --head dev` |
| Cierre pendiente | Ejecutar `close.md` para el scope indicado |
| dev detrás de origin/main | `git checkout dev && git merge origin/main --no-edit` |

Crear rama desde `origin/main`:
```bash
git fetch origin main
git checkout -b <tipo>/<slug> origin/main
```

⚠️ Nunca desde `dev`, `main` local, ni desde otra feature branch.

---

## Pipeline FEATURE (6 pasos)

### REGLA ABSOLUTA

> El harness bloquea `Edit`/`Write` si no hay scope activo en TodoWrite.
> Si ves el error de enforcement: `todowrite` primero, luego editar.

---

### PASO 1 — Spec Generator

Invocar el skill `spec-generator` con la descripción de la tarea:

```
Skill("spec-generator", "$ARGUMENTS")
```

**GATE 1 — No avanzar hasta que:**
- [ ] Archivo spec existe en `spec/` con nombre `YYYY-MM-DD-{nombre}.spec.md`
- [ ] Contiene sección `## REASONS Canvas` con bloque `<REASONS>` en XML
- [ ] El usuario aprobó el spec explícitamente

Si el usuario pide cambios → modificar spec y volver a presentar. No avanzar sin aprobación.

Marcar Paso 1 ✓ en TodoWrite solo cuando los tres criterios estén cumplidos.

---

### PASO 2 — Architect

Lanzar el agente `architect` con:
- Path del spec aprobado
- Stack: NestJS + React Native + pnpm workspaces + Kafka + Redis
- Instrucciones: validar viabilidad técnica, enriquecer con paths concretos, identificar escenarios de test, reportar orden de trabajo

Si el spec tiene ≥3 USTs independientes: el architect identifica capas topológicas y recomienda descomposición en scopes paralelos (ver sección "Descomposición" en CLAUDE.md).

**GATE 2 — No avanzar hasta que:**
- [ ] Architect entregó su reporte
- [ ] Sin bloqueadores técnicos sin resolver

---

### PASO 3 — QA (RED)

Lanzar el agente `qa` con instrucción: **escribir tests que fallen por la razón correcta**.

El agente QA debe:
1. Cargar el skill `qa-learnings` antes de empezar
2. Escribir los tests antes de que exista implementación
3. Ejecutar y confirmar que fallan
4. Confirmar que el error es el esperado (no syntax/import error)

**GATE 3 — No avanzar hasta que:**
- [ ] Tests existen en el repositorio
- [ ] Tests fallan al ejecutarse
- [ ] El fallo es por la razón correcta (no setup)

---

### PASO 4 — Implementación

Lanzar el agente correspondiente según el área:
- Backend (authorization-service, sse-server, bff) → agente `backend`
- Mobile (apps/mobile) → agente `frontend`
- Ambos → primero `backend`, luego `frontend`

Los agentes deben cargar su skill de learnings (`backend-learnings` / `frontend-learnings`) al inicio.

**GATE 4 — No avanzar hasta que:**
- [ ] Tests del Paso 3 pasan en verde
- [ ] `pnpm typecheck` sin errores
- [ ] `pnpm lint` sin errores
- [ ] Si es mobile: app carga en emulador sin red screen (Metro activo, `pnpm android`, `adb logcat | grep ReactNativeJS` sin errores críticos)

---

### PASO 5 — QA (GREEN)

Lanzar el agente `qa` con instrucción: **correr la suite completa y reportar**.

El agente QA debe:
1. Ejecutar todos los tests del área afectada
2. Ejecutar `pnpm typecheck` y `pnpm lint`
3. Ejecutar mutation testing: `pnpm test:mutation` (threshold `low` = 50%)
4. Si hay regresiones o mutation score < 50% → volver al Paso 3 (QA RED)
5. Reportar: N tests pasando, N fallando, mutation score

**GATE 5 — No avanzar hasta que:**
- [ ] Suite completa en verde (cero fallos)
- [ ] Sin regresiones
- [ ] Mutation score ≥ 50%

---

### PASO 5b — Validación Empírica

Leer `.opencode/pipeline/validate-empirica.md` y ejecutar los checks que correspondan:

| La feature toca... | Checks a ejecutar |
|---|---|
| `apps/mobile/` | A — Mobile UI |
| Nuevos `@Get/@Post/@Put/@Delete` | B — Endpoints REST |
| SSE o `apps/sse-server/` | C — SSE / Real-time |
| `package.json`, compose, Makefile | D — Infra / Dependencias |

**Este paso es un gate bloqueante.** Si falla cualquier check → volver a Paso 3 (QA RED) con el output exacto del check fallido como especificación del bug. No se puede cerrar con checks fallidos.

---

### PASO 6 — Cierre

Leer `.opencode/pipeline/close.md` y ejecutar **todos** los pasos en orden:

1. Actualizar spec en `spec/` (marcar `[x]` criterios, cambiar status a `completed`, mover a `spec/archived/`)
2. Fusionar rama a `dev` local: `bash .opencode/pipeline/merge-to-dev.sh`
3. Verificar commits capturados: `git log origin/main..HEAD --no-merges --oneline`
4. Crear Pull Request apuntando a `main`: `git push -u origin HEAD && gh pr create --base main`
5. Entrada en `.claude/LEARNINGS.md` con template estándar
6. Extraer learning: `npx tsx scripts/extract-learnings.ts`
7. Revisar `CLAUDE.md` si hay cambio arquitectural o nueva convención
8. Limpiar: `rm -f .opencode/pipeline/close-pending.json && git add .opencode/pipeline/close-pending.json`
9. Anunciar cierre con el formato de `close.md`

---

## Pipeline BUGFIX (variante 6 pasos)

Mismo flujo que feature con estas diferencias:

- **Paso 1** → Triage en vez de spec: confirmar bug con evidencia (logs, stack trace, test que falla), describir comportamiento actual vs esperado, identificar componente afectado. Spec es opcional si el fix es directo.
- **Paso 2** → Architect solo si el fix requiere cambios arquitecturales.
- **Paso 3** → Escribir test que reproduzca el bug y falle en rojo.
- **Paso 4** → Fix mínimo hasta que el test pase.
- Pasos 5, 5b y 6 → igual que feature.

---

## Pipeline DEBUG

1. Recolectar evidencias: logs, outputs, configuración relevante
2. Formular hipótesis ordenadas por probabilidad
3. Verificar cada hipótesis (bash, grep, lectura de archivos)
4. Reportar causa raíz + solución recomendada (sin implementar a menos que el usuario lo pida explícitamente)

---

## Pipeline CHORE

El harness también requiere pipeline activo para chores que modifican archivos. El TodoWrite con `[chore.slug]` activa el enforcement.

1. Delimitar scope exacto del cambio
2. Ejecutar el cambio mínimo
3. Verificar: `pnpm typecheck` + tests del área afectada
4. Ejecutar `close.md` (pasos 2-3-6 obligatorios; spec y LEARNINGS solo si el chore fue complejo)

---

## Visibilidad obligatoria en cada transición

Cada vez que se inicia, avanza o termina un paso:

```
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Paso N/M · <Agente>
  Tarea: <descripción>
  Estado: iniciado | validando | bloqueado | completado
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

Y actualizar el TodoWrite con el estado completo de todos los pasos.
