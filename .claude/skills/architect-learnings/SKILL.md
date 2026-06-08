---
name: architect-learnings
description: Aprendizajes acumulados del architect. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

## Reglas activas (validadas ≥2 veces)
*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea. Cuando un mismo patrón aparece en ≥2 entradas de LEARNINGS.md, se promueve aquí.*

### Accionables del agente architect

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A4** | Para toda dependencia nativa nueva (Android/iOS), verificar compatibilidad con la versión de Kotlin/Gradle del proyecto. Leer `android/build.gradle` y `android/gradle.properties` antes de aprobar la adición | **ALTA** |
| **A5** | Validar rutas de endpoints contra los `@Controller()` prefixes reales del código. Leer los controllers existentes y documentar las rutas esperadas en el spec | **ALTA** |
| **A6** | Especificar versiones exactas de dependencias en el plan de arquitectura, no rangos con `^`. Incluir la versión específica en la sección "Archivos a crear/modificar" | **MEDIA** |

## Lecciones recientes
- [2026-06-06] learnings-skills-self-improvement-loop — **Lección**: para que un sistema de auto-mejora sea efectivo, debe ser **automático** (el agente no necesita recordar ej

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*
