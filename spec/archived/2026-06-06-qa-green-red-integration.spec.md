# Spec: QA GREEN → RED Loop + Integración CLAUDE.md

**Fecha**: 2026-06-06
**Scope**: `qa-green-red-integration`
**Tipo**: chore
**Capa**: 2 (depende de mutation-testing-setup y learnings-skills-setup)

## Objetivo

1. Modificar los QA agents para que en FASE GREEN verifiquen mutation testing y devuelvan el pipeline a RED si los tests son débiles
2. Consolidar todos los cambios en CLAUDE.md

## Dependencias satisfechas (capa 1 completada)

- `mutation-testing-setup`: Stryker instalado, configurado, skill `mutation-testing` creado
- `learnings-skills-setup`: Skills de learnings creados, agentes actualizados con pre-read

## Archivos a modificar

| # | Archivo | Cambio |
|---|---|---|
| 1 | `.claude/agents/qa.md` | FASE GREEN: agregar step de mutation testing + loop RED |
| 2 | `.opencode/agents/qa.md` | FASE GREEN: agregar step de mutation testing + loop RED |
| 3 | `CLAUDE.md` | Agregar comandos, skills, y documentar loop |

## Cambios específicos en QA agents

### En FASE GREEN, después del paso 4 actual (mobile E2E):

```markdown
5. Correr mutation testing: `pnpm test:mutation --filter <service>`
   - Si el mutation score < threshold `low` (50): reportar como falla,
     reforzar tests para mutantes sobrevivientes, volver a FASE RED
   - Si el score está entre `low` y `high`: advertir, no bloquear
   - Si el score >= `high` (80): OK

6. **Decisión de loop**:
   - Si typecheck, build, tests, o mutation score están rotos → 
     reportar fallas concretas y volver a FASE RED
   - Si todo OK → reportar "GREEN completo, listo para cierre"
```

### En "Mejora continua", agregar pre-read de skills:

```markdown
- **Al comenzar**: carga `Skill(qa-learnings)` y 
  `Skill(mutation-testing)` para recordar patrones validados
  y el contrato de mutation testing.
```

## Cambios en CLAUDE.md

Agregar 3 secciones:

### 1. Tabla de comandos (nuevo entry)
```
pnpm test:mutation              # Stryker mutation testing en servicios backend
```

### 2. Tabla de skills (nuevos entries)
```
| `qa-learnings` | `.claude/skills/qa-learnings/` | Aprendizajes acumulados del QA |
| `backend-learnings` | `.claude/skills/backend-learnings/` | Aprendizajes del backend |
| `frontend-learnings` | `.claude/skills/frontend-learnings/` | Aprendizajes del frontend |
| `architect-learnings` | `.claude/skills/architect-learnings/` | Aprendizajes del arquitecto |
| `mutation-testing` | `.claude/skills/mutation-testing/` | Stryker mutation testing |
```

### 3. Loop QA GREEN → RED
```markdown
### Loop QA GREEN → RED

Si en FASE GREEN algún test falla o el mutation score está por debajo del
threshold bajo, QA no avanza a cierre: reporta las fallas y vuelve a FASE RED
para que se refuercen los tests antes de volver a intentar GREEN.
```

## Verificación

1. `pnpm typecheck` pasa
2. `pnpm lint` pasa
3. Revisión visual de CLAUDE.md: secciones agregadas, sin duplicados
4. Los QA agents referencian correctamente los skills creados en capa 1

## Resultado

**Completado**: 2026-06-06
**Estado**: ✅ Completado

**Implementado**:
- [x] QA agents actualizados con mutation testing + loop RED
- [x] CLAUDE.md con comandos, skills y loop documentados

**Desviaciones**: Ninguna.

**Tests**: Typecheck 6/6 limpio.

## Dependencias entre scopes

| Scope | Depende de | Capa |
|---|---|---|
| `mutation-testing-setup` | — | 1 |
| `learnings-skills-setup` | — | 1 |
| `qa-green-red-integration` | mutation-testing-setup, learnings-skills-setup | 2 |
