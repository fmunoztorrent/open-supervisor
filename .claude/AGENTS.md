# AGENTS.md — Instrucciones y Accionables por Agente

Este archivo contiene instrucciones base y accionables para cada agente del pipeline de open-supervisor. Los accionables bloqueantes (nivel 3) son generados automáticamente por `scripts/extract-learnings.ts` cuando un aprendizaje se repite 3 veces. El resto son mantenidos manualmente.

---

## Accionables bloqueantes (Nivel 3 — Auto-generados)

| ID | Agente | Condición | Acción |
|----|--------|-----------|--------|
| *(vacío — se llena automáticamente cuando un slug alcanza 3 ocurrencias)* | | | |

---

## Agente `explore`

**Responsable de:** leer y reportar el estado del código.

### Accionables

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A1** | Antes de reportar contenido de un archivo, ejecutar `git log --oneline -1 -- <file>` en la rama actual para confirmar que el archivo leído corresponde al HEAD | **ALTA** |
| **A2** | Cuando el prompt pide "explorar a fondo", incluir en el reporte el hash del commit base (`git rev-parse HEAD`) y la rama activa | **MEDIA** |
| **A3** | Para verificar si una dependencia está instalada, siempre consultar `package.json` directamente, nunca inferir de import statements o LSP | **MEDIA** |

---

## Agente `architect`

**Responsable de:** validar viabilidad técnica antes de implementar.

### Accionables

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A4** | Para toda dependencia nativa nueva (Android/iOS), verificar compatibilidad con la versión de Kotlin/Gradle del proyecto. Leer `android/build.gradle` y `android/gradle.properties` antes de aprobar la adición | **ALTA** |
| **A5** | Validar rutas de endpoints contra los `@Controller()` prefixes reales del código. Leer los controllers existentes y documentar las rutas esperadas en el spec | **ALTA** |
| **A6** | Especificar versiones exactas de dependencias en el plan de arquitectura, no rangos con `^`. Incluir la versión específica en la sección "Archivos a crear/modificar" | **MEDIA** |

---

## Agente `qa`

**Responsable de:** escribir tests en rojo y validar en verde.

### Accionables

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A7** | Usar `jq` en vez de `python3 -c` para verificar respuestas JSON en bash. `jq 'type'` discrimina array/object; `jq 'length'` es inequívoco | **MEDIA** |
| **A8** | En fase GREEN, verificar que los endpoints nuevos responden con `curl -s -o /dev/null -w "%{http_code}"` ANTES de marcar como passing. No confiar solo en tests unitarios | **ALTA** |
| **A9** | Agregar al checklist de QA GREEN: ejecutar `git merge --no-commit --no-ff origin/dev` como dry-run para detectar conflictos antes del cierre | **MEDIA** |

---

## Agente `backend` y `frontend`

**Responsable de:** escribir código que hace pasar los tests.

### Accionables

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A10** | Durante resolución de conflictos de merge, usar `git merge --strategy-option=theirs` para archivos no conflictivos en vez de edit manual | **BAJA** |
| **A11** | Al modificar cualquier archivo `.ts` en servicios NestJS, el paso final del agente DEBE ser: `nest build && pkill -f "node dist/main" && node dist/main &`. No marcar la tarea como completada sin rebuild + restart | **ALTA** |
| **A12** | Después de restart, verificar con `lsof -i :<port> -P | grep LISTEN` + `curl -s -o /dev/null -w "%{http_code}" <healthcheck>` que el servicio responde antes de continuar | **ALTA** |

---

## Agente `task` (subagentes de implementación)

**Responsable de:** ejecutar tareas de implementación independientes.

### Accionables

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A13** | Antes de `pnpm add`, verificar en `package.json` si la dependencia ya existe. Si existe, NO reinstalar con versión diferente. Si no existe, leer `android/build.gradle` para verificar kotlinVersion y buscar la versión máxima compatible | **ALTA** |
| **A14** | Regla: NUNCA simplificar o reemplazar archivos existentes que no están en el scope de la tarea. Si un archivo necesita cambios, aplicar la mínima modificación posible con `edit` (no `write` completo) | **ALTA** |
| **A15** | El prompt del task agent debe incluir el hash del commit base (`HEAD`) para que pueda hacer `git diff` y ver qué ya fue modificado por otros agents | **MEDIA** |

---

## Pipeline Enforcer (plugin)

**Responsable de:** bloquear ediciones sin pipeline activo.

### Accionables

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A16** | Agregar excepción en el plugin: si `git status` muestra `UU` (unmerged) en algún archivo, permitir ediciones sin pipeline activo (el usuario está resolviendo conflictos) | **MEDIA** |
| **A17** | El plugin debe ignorar cambios en `.opencode/pipeline/state.json` para el hook `tool.execute.before` — este archivo es interno y sus modificaciones no deben bloquear operaciones de git | **BAJA** |

---

## Agente Principal (orquestador)

**Responsable de:** coordinar el pipeline completo.

### Accionables

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A18** | Al iniciar cualquier paso del pipeline, verificar si Plan Mode está activo. Si lo está, anunciarlo EXPLÍCITAMENTE y preguntar si se debe salir. No asumir que el usuario sabe que está en Plan Mode | **ALTA** |
| **A19** | Después de recibir un reporte de exploration agent, validar 1-2 claims clave con `read` o `git show` antes de diseñar arquitectura sobre ellas | **ALTA** |
| **A20** | Después de que un task agent instala dependencias, ejecutar `git diff package.json` para ver exactamente qué cambió y validar que las versiones son compatibles | **ALTA** |
| **A21** | En el paso 5 (QA GREEN), siempre incluir rebuild + restart de servicios como paso obligatorio ANTES de correr `curl` de verificación | **ALTA** |
| **A22** | Ejecutar paso 5b Validación Empírica (`.opencode/pipeline/validate-empirica.md`) cuando la feature toca mobile, endpoints, SSE o infra. Si los checks fallan, volver a QA RED | **ALTA** |

---

## Referencia cruzada agentes → accionables

| Agente | Accionables asignados |
|---|---|
| explore | A1, A2, A3 |
| architect | A4, A5, A6 |
| qa | A7, A8, A9 |
| backend / frontend | A10, A11, A12 |
| task (subagentes) | A13, A14, A15 |
| pipeline-enforcer | A16, A17 |
| principal (orquestador) | A18, A19, A20, A21, A22 |
