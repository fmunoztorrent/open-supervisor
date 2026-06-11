# Spec: Background Refresh automático al recibir SSE con indicador no bloqueante

**Fecha:** 2026-06-04
**Stack inferido:** React Native (Android) + NestJS + TypeScript
**Estado:** Completed

---

## Contexto

Actualmente, cuando la app móvil recibe un evento SSE `authorization_request`, el hook `useSSERequests` hace un prepend directo del payload del evento al array local de solicitudes. Esto tiene dos problemas:

1. **Inconsistencia potencial:** El payload del SSE puede diferir del estado real en el servidor (por ejemplo, si hubo cambios mientras el evento viajaba, o si el evento se perdió y el SSE reconecta).
2. **Sin retroalimentación visual:** El supervisor no tiene indicación de que la app está sincronizando datos en segundo plano.

Esta feature introduce un **refetch completo no bloqueante** del endpoint `GET /authorization/store/:storeId/pending` del BFF cada vez que se recibe un SSE `authorization_request`. El refetch ocurre en background (no bloquea la UI) y se muestra un indicador sutil en el pie de la pantalla con un spinner.

**Queda fuera de scope:**
- Pull-to-refresh manual (se puede agregar en el futuro)
- Refetch al reconectar SSE (feature separada)
- Cambios en backend/BFF — solo se modifica la app mobile
- Cache offline o persistencia de datos
- Manejo de conflictos si una solicitud se resuelve mientras se refresca

**Ambigüedades identificadas:**
- ¿Qué sucede si el refetch falla? → Se mantienen los datos actuales sin cambios y se oculta el indicador. No se muestra error al usuario para no interferir.
- ¿Conviene hacer prepend optimista del evento + refetch? → No. Se opta por refetch puro: siempre se obtiene el estado verdadero del servidor. Esto evita conflictos de estado.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    El supervisor necesita ver el estado real de las solicitudes pendientes en todo momento.
    El prepend directo de eventos SSE confía ciegamente en que el evento refleja el estado actual
    del servidor, lo cual es frágil cuando hay reconexiones, eventos perdidos, o múltiples
    supervisores actuando sobre las mismas solicitudes. Un refetch completo asegura consistencia.
    Además, el indicador sutil le da confianza al supervisor de que la app está activa y
    sincronizando datos, sin interrumpir su flujo de trabajo.
  </Rationale>
  <Explanation>
    Al recibir un evento `authorization_request` por SSE, el hook `useSSERequests` no hará
    prepend directo. En su lugar, disparará una petición asíncrona GET a
    `/authorization/store/:storeId/pending`. Durante la petición, una bandera `isRefreshingBackground`
    se establece a `true`, lo que renderiza un indicador sutil (Box con Spinner y texto
    "Sincronizando...") en el pie del listado. Al completar la petición, se actualiza el estado
    `requests` con la respuesta y `isRefreshingBackground` vuelve a `false`.
    Si la petición falla, simplemente se oculta el indicador sin alterar los datos actuales.
    El indicador no bloquea la interacción: el supervisor puede seguir viendo el listado,
    hacer scroll, y tocar tarjetas para ver detalle mientras el refetch está en curso.
  </Explanation>
  <Assumptions>
    - El endpoint GET /pending del BFF está disponible y responde en tiempo razonable (&lt;5s).
    - El volumen de solicitudes pendientes por tienda es manejable (&lt;200) para una respuesta rápida.
    - No hay eventos SSE de tipo "resolve" — solo llegan eventos de nuevas solicitudes.
    - El supervisor confía en que el indicador sutil es suficiente feedback de actividad en background.
  </Assumptions>
  <Scrutiny>
    - ¿Realmente necesitamos un refetch completo o basta con el prepend? Si el prepend es suficiente
      para el caso de uso actual, el refetch agrega latencia innecesaria. Decisión: refetch,
      porque es más robusto frente a eventos perdidos y múltiples supervisores.
    - ¿El spinner en el pie es la mejor UX? Alternativas: snackbar, badge en el header, toast.
      Se elige pie porque es discreto, está cerca del contenido, y no obstruye la navegación.
    - ¿Debería haber un throttle/debounce del refetch? Si llegan varios SSE seguidos
      (ej: ráfaga de solicitudes), cada uno dispararía un refetch. Considerar debounce de 2s.
  </Scrutiny>
  <Objections>
    - "El refetch completo es más lento que el prepend directo." → Cierto, pero la consistencia
      es más importante que la velocidad percibida en este contexto. El indicador sutil
      comunica que hay actividad.
    - "Agregar un indicador más es ruido visual." → El indicador es deliberadamente pequeño,
      al pie de la pantalla, con opacidad reducida, diseñado para ser notado sin distraer.
  </Objections>
  <Novelty>
    - Primer mecanismo de background refresh en la app mobile (no existía ningún refetch).
    - Primer indicador de actividad en background.
    - Cambio fundamental: el hook ya no confía en el payload del SSE como fuente de verdad.
  </Novelty>
  <Substitutes>
    - Prepending directo (estado actual): descartado por inconsistencia.
    - Pull-to-refresh manual: útil pero requiere acción del usuario; no resuelve el problema
      de mantener datos actualizados automáticamente.
    - WebSocket en lugar de SSE: el stack ya usa SSE, no hay razón para reemplazarlo.
    - Optimistic update + refetch silencioso: más complejo, el refetch puro es más simple y confiable.
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: Refetch automático al recibir SSE `[Must]`

> Como **supervisor de tienda**, quiero que **la app refresque automáticamente el listado de solicitudes al recibir una nueva notificación SSE**, para que **siempre vea el estado real de las solicitudes pendientes en el servidor, no solo lo que llegó por el evento**.

**Criterios de aceptación:**
- [x] Al recibir un evento SSE `authorization_request` válido, el hook dispara una petición GET a `/authorization/store/:storeId/pending`
- [x] Los datos del listado se actualizan con la respuesta del servidor (no con el payload del evento)
- [x] El refetch no interfiere con la navegación ni la interacción del usuario
- [x] Si el refetch falla (network error, HTTP error), los datos actuales se mantienen sin cambios
- [x] Múltiples eventos SSE consecutivos no disparan refetches duplicados — hay un debounce de 2s

**Notas:** El SSE event listener no debe hacer prepend directo. Solo dispara el refetch.

---

### US-02: Indicador sutil de background refresh `[Must]`

> Como **supervisor de tienda**, quiero **ver un indicador discreto en el pie de la pantalla cuando la app está sincronizando datos en segundo plano**, para **saber que hay actividad sin que interrumpa mi trabajo**.

**Criterios de aceptación:**
- [x] Cuando `isRefreshingBackground` es `true`, se muestra un Box en el pie del listado con un Spinner y texto "Sincronizando..."
- [x] El indicador tiene opacidad reducida (0.7) y ocupa el ancho completo pero con altura mínima (~32px)
- [x] El indicador no bloquea el scroll ni los taps en las tarjetas del listado
- [x] Cuando `isRefreshingBackground` pasa a `false`, el indicador desaparece
- [x] Si el refetch falla, el indicador desaparece sin mostrar error

**Notas:** El indicador es puramente informativo. No es interactivo.

---

### US-03: Mantener comportamiento existente en carga inicial `[Must]`

> Como **supervisor de tienda**, quiero que **la carga inicial del listado (al abrir la app) siga mostrando el spinner de carga completo**, para **saber que la app está obteniendo datos por primera vez**.

**Criterios de aceptación:**
- [x] El estado `isLoading` (carga inicial con spinner full-screen) se mantiene sin cambios
- [x] El indicador de background refresh solo aparece después de la carga inicial, cuando ya hay datos y llega un SSE
- [x] No hay regresión en el comportamiento de carga inicial existente

**Notas:** Esto asegura que la feature no rompe el flujo actual de primera carga.

---

## Escenarios BDD

```gherkin
Feature: Background Refresh on SSE — US-01 y US-02
  Como supervisor de tienda
  Quiero que la app refresque el listado automáticamente al recibir SSE
  Para que siempre vea el estado real de las solicitudes

  Background:
    Given el hook useSSERequests está activo con storeId "store-1"
    And la carga inicial se ha completado (isLoading = false)
    And hay 3 solicitudes en el listado

  Scenario: Happy path — SSE event dispara refetch exitoso
    Given el SSE emite un evento "authorization_request" con datos válidos
    When el hook procesa el evento
    Then se establece isRefreshingBackground = true
    And se muestra el indicador "Sincronizando..." en el pie
    And se dispara GET /authorization/store/store-1/pending
    When el GET responde con 4 solicitudes (la nueva incluida)
    Then el listado se actualiza con 4 solicitudes
    And isRefreshingBackground = false
    And el indicador desaparece

  Scenario: Refetch falla por network error
    Given el SSE emite un evento "authorization_request"
    When el GET /pending falla con network error
    Then el listado mantiene las 3 solicitudes originales
    And isRefreshingBackground = false
    And el indicador desaparece
    And no se muestra ningún error al usuario

  Scenario: Múltiples SSE en ráfaga
    Given el SSE emite 3 eventos "authorization_request" en 1 segundo
    When el hook recibe los eventos
    Then solo se dispara 1 GET /pending (con debounce de 2s)
    And isRefreshingBackground = true durante todo el período
    When el GET responde
    Then isRefreshingBackground = false

  Scenario: SSE durante carga inicial
    Given el hook está en carga inicial (isLoading = true)
    When llega un evento SSE "authorization_request"
    Then NO se dispara refetch
    And isRefreshingBackground remains false
    And el indicador no se muestra
```

```gherkin
Feature: Background Refresh Indicator — US-02
  Como supervisor de tienda
  Quiero ver un indicador sutil cuando hay sincronización en background

  Scenario: Indicador visible durante refetch
    Given isRefreshingBackground = true
    Then se renderiza un Box con testID "background-refresh-indicator"
    And el Box contiene un Spinner y texto "Sincronizando..."
    And el Box tiene opacidad 0.7
    And el listado sigue siendo scrolleable y las tarjetas son tappables

  Scenario: Indicador oculto cuando no hay refetch
    Given isRefreshingBackground = false
    Then no se renderiza el Box con testID "background-refresh-indicator"
```

---

## Plan de Tests TDD

### US-01 — Refetch automático al recibir SSE

**Unitarios — useSSERequests**
- [ ] [RED] Test: SSE event dispara refetch (GET /pending), no hace prepend directo
- [ ] [GREEN] Implementar refetch on SSE event en useSSERequests
- [ ] [RED] Test: isRefreshingBackground se activa durante refetch y se desactiva al completar
- [ ] [GREEN] Implementar estado isRefreshingBackground
- [ ] [RED] Test: refetch fallido mantiene datos actuales y oculta indicador
- [ ] [GREEN] Manejar errores de refetch sin mutar estado
- [ ] [RED] Test: debounce de 2s en refetch para eventos consecutivos
- [ ] [GREEN] Implementar debounce con useRef + setTimeout
- [ ] [RED] Test: SSE durante carga inicial no dispara refetch
- [ ] [GREEN] Condición: solo refetch si isLoading === false

**Integración**
- [ ] El hook se integra correctamente con App.tsx y AuthorizationList

### US-02 — Indicador sutil de background refresh

**Unitarios — AuthorizationList**
- [ ] [RED] Test: AuthorizationList renderiza background-refresh-indicator cuando isRefreshingBackground=true
- [ ] [GREEN] Pasar prop isRefreshingBackground a AuthorizationList y renderizar indicador
- [ ] [RED] Test: AuthorizationList no renderiza indicador cuando isRefreshingBackground=false
- [ ] [GREEN] Renderizado condicional del indicador
- [ ] [RED] Test: indicador no bloquea interacción (ScrollView sigue siendo scrolleable)
- [ ] [GREEN] Asegurar que el indicador está fuera del ScrollView o es un overlay no interactivo

**Unitarios — App.tsx**
- [ ] [RED] Test: App.tsx pasa isRefreshingBackground a AuthorizationList
- [ ] [GREEN] Conectar el estado en App.tsx

### US-03 — No afectar carga inicial

- [ ] [RED] Test: isLoading (carga inicial) permanece independiente de isRefreshingBackground
- [ ] [GREEN] Mantener isLoading como estado separado sin cambios en su lógica

---

## Definition of Done

- [ ] Todos los escenarios BDD pasan en pruebas unitarias
- [ ] useSSERequests.ts modificado: no hace prepend directo, dispara refetch con debounce
- [ ] AuthorizationList.tsx modificado: recibe y muestra indicador background
- [ ] App.tsx conecta isRefreshingBackground entre hook y componente
- [ ] Tests unitarios existentes siguen pasando (sin regresiones)
- [ ] Cobertura de tests unitarios ≥ 85% en las nuevas funcionalidades
- [ ] Code review aprobado por al menos 1 par

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | Ninguna — todo es interno al proyecto |
| Riesgo técnico | El debounce con useRef + setTimeout requiere limpieza correcta en useEffect para evitar memory leaks o refetches huérfanos |
| Suposición a validar | El endpoint GET /pending responde consistentemente en <2s con payloads de ~200 solicitudes |

---

## Resultado

**Fecha de finalización:** 2026-06-04
**Status del spec:** completed

### Implementado
- [x] US-01: Refetch automático al recibir SSE — el hook `useSSERequests` dispara un GET `/pending` con debounce de 2s en lugar de prepend directo
- [x] US-02: Indicador sutil de background refresh — `AuthorizationList` muestra un `Box` con `Spinner` + "Sincronizando..." en el pie durante el refetch, con opacidad 0.7
- [x] US-03: Carga inicial intacta — `isLoading` permanece independiente, el SSE listener se registra después de la carga inicial

### Desviaciones del spec
- El debounce de 2s se implementó con `useRef<setTimeout>` en lugar de una librería externa
- Se agregó `initialLoadDoneRef` como guard de seguridad adicional (no mencionado en el spec original, identificado durante architect review)
- El indicador no bloqueante usa `Box` fuera del `ScrollView` para no interferir con el scroll

### Tests
- Unitarios hook (useSSERequests): 12 tests nuevos + 11 existentes = 23 tests, todos pasando
- Unitarios componente (AuthorizationList): 2 tests nuevos + 8 existentes = 10 tests, todos pasando
- Suite completa mobile: 63/63 tests pasando (5 suites)
- Typecheck: 0 errores
- Regresiones: 0
