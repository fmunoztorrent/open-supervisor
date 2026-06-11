---
name: frontend-learnings
description: Aprendizajes acumulados del frontend engineer. Patrones validados en el proyecto open-supervisor. 
  Cargar al iniciar tareas para aplicar lecciones de iteraciones anteriores.
---

## Reglas activas (validadas ≥2 veces)
*Esta sección se llena automáticamente por el script `scripts/extract-learnings.ts` al cierre de cada tarea. Cuando un mismo patrón aparece en ≥2 entradas de LEARNINGS.md, se promueve aquí.*

## Lecciones recientes
- [2026-06-10] detox-e2e-testids-y-mock-server-js-ts-declarations — **Lección**: Verificar que cada elemento interactivo de la UI targeteado por `by.id()` tenga un `testID` único. Para listas dinámicas usar IDs compuestos, no fijos. Crear `.d.ts` para imports JS desde suites TS.
- [2026-06-08] reintegrar-login-huerfano-en-app-tsx — **Lección**: Cuando un gate de auth envuelve la app, todos los tests que renderizan `<App/>` deben mockear sesión autenticada y usar `waitFor`. Verificar WIRING en el entrypoint tras merges concurrentes.
- [2026-06-08] header-solapado-status-bar-android — **Lección**: `SafeAreaView` es no-op en Android. Para inset superior usar `paddingTop: StatusBar.currentHeight ?? 0` leído en tiempo de render, no en `StyleSheet.create`.
- [2026-06-06] rn-asyncstorage-mock-jest-hoisting — **Lección**: En Jest + RN, los mocks de módulos nativos (AsyncStorage) deben definirse inline en la factory de `jest.mock`, no referenciando variables externas. Actualizar `toHaveBeenCalledWith` al agregar headers automáticos a fetch.
- [2026-06-04] debounce-async-refetch-useref — **Lección**: Usar `useRef<setTimeout>` para debounce en hooks con SSE listeners. Para flags de estado en closures de useEffect, usar `useRef<boolean>`, no `useState`.

## Promovidas a CLAUDE.md
*Entradas que ya han sido migradas a reglas permanentes en CLAUDE.md. Hacer tracking aquí evita duplicar.*

### Accionables del agente frontend

| ID | Accionable | Severidad |
|----|-----------|-----------|
| **A10** | Durante resolución de conflictos de merge, usar `git merge --strategy-option=theirs` para archivos no conflictivos en vez de edit manual | **BAJA** |
| **A11** | Al modificar cualquier archivo `.ts` en servicios NestJS, el paso final del agente DEBE ser: `nest build && pkill -f "node dist/main" && node dist/main &`. No marcar la tarea como completada sin rebuild + restart | **ALTA** |
| **A12** | Después de restart, verificar con `lsof -i :<port> -P | grep LISTEN` + `curl -s -o /dev/null -w "%{http_code}" <healthcheck>` que el servicio responde antes de continuar | **ALTA** |
| **E1** | Validación empírica mobile: build Android, no red screen, UI elements, SSE flow, no regressions. Ver `.opencode/pipeline/validate-empirica.md` | **ALTA** |
