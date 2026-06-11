# Spec: Página de detalle de la solicitud de autorización (app móvil)

**Fecha:** 2026-06-04  
**Stack inferido:** React Native (Android) + TypeScript + Gluestack UI v1 + NestJS BFF  
**Estado:** completed

> **Scope de esta feature:** componente `AuthorizationDetailScreen`, hook `useDecision` y su integración en `App.tsx`. No requiere cambios en backend ni en la conexión SSE — esos elementos pertenecen al spec [listado-detalle-solicitudes-mobile](./2026-06-03-listado-detalle-solicitudes-mobile.spec.md).

---

## Contexto

Cuando el supervisor toca una card del listado de solicitudes, la app navega a la pantalla de detalle. Esta pantalla debe mostrar toda la información de la solicitud (campos comunes y campos específicos por tipo), permitir que el supervisor tome una decisión (autorizar o rechazar), y comunicar esa decisión al BFF vía REST. La respuesta viaja por Kafka hasta el POS que originó la solicitud.

La pantalla es **puramente presentacional**: recibe `request`, `isLoading`, `onDecide` y `error` como props y no gestiona estado de red propio. El estado de red vive en `useDecision`, que se instancia en el componente orquestador `DetailView` dentro de `App.tsx`. Esta separación facilita el testeo unitario del componente sin mocks de fetch.

**Ambigüedades resueltas:**
- El rechazo no requiere motivo libre — solo `decision: 'REJECT'`.
- El BFF no distingue entre tipos de error (retorna 5xx genérico para cualquier fallo upstream, incluyendo 409 ya resuelta). La app trata todo non-2xx como error genérico y re-habilita los botones.
- Las solicitudes resueltas permanecen visibles en el listado y en el detalle con estado final; no desaparecen.
- La navegación hacia atrás se implementa con un botón "← Volver" en la cabecera (`App.tsx`), fuera del componente presentacional.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    El supervisor necesita ver el contexto completo de una solicitud antes de decidir.
    Un listado de cards no tiene espacio para todos los campos relevantes (especialmente
    los específicos de tipo como product_id, original_price, employee_id). La pantalla
    de detalle centraliza esa información y ofrece las acciones de autorizar/rechazar
    con retroalimentación visual clara del estado de la operación.
  </Rationale>
  <Explanation>
    El componente AuthorizationDetailScreen es presentacional puro: recibe props y llama
    a callbacks. El hook useDecision encapsula el POST REST al BFF, exponiendo decide(),
    isLoading y error. En App.tsx, DetailView los compone: instancia useDecision con el
    correlation_id de la solicitud seleccionada, maneja la navegación de vuelta al listado
    solo si decide() retorna true (éxito). La barra de color lateral en el header y las
    etiquetas en español permiten identificar el tipo de solicitud de un vistazo.
  </Explanation>
  <Assumptions>
    - El BFF ya expone POST /authorization/:id/resolve con body { decision, supervisor_id }
      y responde 2xx en caso de éxito (verificado).
    - El correlation_id de la solicitud es el identificador correcto para el endpoint resolve
      (verificado — coincide con el :id del path).
    - El supervisor_id está disponible en SessionContext (mockeado para esta feature).
    - Los cinco RequestType conocidos son DISCOUNT, CANCEL, EMPLOYEE_BENEFIT, SUSPEND,
      PRICE_CHANGE; cualquier tipo desconocido usa color y label de fallback (#607D8B / raw type).
    - @gluestack-ui/themed v1 ya está configurado en el proyecto; el componente
      AuthorizationDetailScreen usa Box, HStack, ScrollView, Text, Button, ButtonText,
      ButtonSpinner de esa librería.
  </Assumptions>
  <Scrutiny>
    ¿Por qué el componente es presentacional puro y no maneja el hook internamente?
    Porque facilita el testing unitario: se puede verificar el renderizado de todos los
    estados (loading, error, resolved) sin necesidad de mockear fetch. El acoplamiento
    de red vive un nivel arriba (DetailView), donde la integración es más fácil de testear.
    ¿Por qué volver al listado solo si decide() retorna true y no siempre?
    Para que el supervisor pueda reintentar ante un error del BFF sin perder el contexto
    de la solicitud que estaba procesando.
  </Scrutiny>
  <Objections>
    - "Volver a la pantalla anterior tras error puede ser confuso": aceptable para MVP;
      la pantalla de detalle permanece abierta con el mensaje de error y los botones
      re-habilitados para reintento inmediato.
    - "No hay confirmación antes de la decisión": aceptado por diseño — el flujo operativo
      del supermercado asume que el supervisor ya tomó la decisión al presionar el botón.
      Un diálogo de confirmación añadiría fricción en contextos de alta presión.
  </Objections>
  <Novelty>
    - Componente presentacional puro separado del hook de red — patrón nuevo en la app.
    - Tabla TYPE_COLORS / TYPE_LABELS: mapeo exhaustivo de RequestType a color hex y
      etiqueta en español. Los colores son custom del dominio (no tokens de Gluestack).
    - formatDate(isoString): formatea fechas ISO en UTC como DD/MM/YYYY HH:MM para
      consistencia entre zonas horarias (todo UTC — sin conversión local).
    - Banner de estado resuelto (verde / rojo) renderizado solo cuando request.resolved
      está definido, con texto "Ya autorizada" / "Ya rechazada".
    - ButtonSpinner de Gluestack dentro del botón "Autorizar" durante isLoading
      (testID="approve-button-spinner") — el botón "Rechazar" solo muestra texto, sin spinner.
  </Novelty>
  <Substitutes>
    - React Navigation: descartado para MVP — la app usa navegación de estado local
      en App.tsx (selectedId). Simplifica el setup inicial; React Navigation se considera
      para cuando la app tenga más de dos pantallas.
    - Componente con estado de red interno: descartado en favor de la separación
      presentacional pura que facilita el testing unitario sin mocks de fetch.
  </Substitutes>
</REASONS>
```

---

## Contrato del componente

### `AuthorizationDetailScreen`

**Archivo:** `apps/mobile/src/screens/AuthorizationDetailScreen.tsx`

```typescript
export type RequestWithResolved = AuthorizationRequestDto & {
  resolved?: 'APPROVED' | 'REJECTED';
};

interface AuthorizationDetailScreenProps {
  request: RequestWithResolved;   // solicitud a mostrar (puede estar resuelta)
  isLoading: boolean;             // true mientras el POST /resolve está en vuelo
  onDecide: (decision: 'APPROVE' | 'REJECT') => void;  // callback de decisión
  error?: string | null;          // mensaje de error del BFF, null si no hay error
}
```

**Regla de habilitación de botones:** `isDisabled = isLoading || !!request.resolved`

Ambos botones comparten el mismo flag `isDisabled`. El botón "Autorizar" muestra `ButtonSpinner` cuando `isLoading=true`; el botón "Rechazar" mantiene su texto en todos los estados.

---

### `useDecision`

**Archivo:** `apps/mobile/src/hooks/useDecision.ts`

```typescript
function useDecision(
  correlationId: string,
  supervisorId: string,
): {
  decide: (decision: 'APPROVE' | 'REJECT') => Promise<boolean>;
  isLoading: boolean;
  error: string | null;
}
```

- `decide()` hace `POST /authorization/:correlationId/resolve` con body `{ decision, supervisor_id: supervisorId }` vía `bffClient`.
- Retorna `true` si la respuesta es 2xx, `false` en cualquier otro caso.
- Cualquier error (non-2xx o error de red) se expone en `error` como string. El llamador usa el booleano para decidir si navegar hacia atrás.
- `isLoading` es `true` desde que se lanza el POST hasta que llega la respuesta (éxito o error).

---

### Integración en `App.tsx`

`DetailView` es el componente orquestador que compone `useDecision` + `AuthorizationDetailScreen`:

```
App.tsx
  └── SupervisorApp (estado: selectedId)
        ├── [selectedId] → DetailView
        │     ├── useDecision(request.correlation_id, supervisorId)
        │     └── AuthorizationDetailScreen (props: request, isLoading, onDecide, error)
        └── [!selectedId] → SafeAreaView + AuthorizationList
```

La cabecera con "← Volver" y el título "Detalle" viven en `DetailView`, fuera del componente presentacional.

---

## Comportamiento visual por tipo de solicitud

### Paleta de colores

| `RequestType` | Etiqueta en español | Color hex | Uso |
|---|---|---|---|
| `DISCOUNT` | Descuento | `#2196F3` (azul) | Borde izquierdo del header |
| `CANCEL` | Cancelación | `#F44336` (rojo) | Borde izquierdo del header |
| `EMPLOYEE_BENEFIT` | Beneficio Empleado | `#9C27B0` (púrpura) | Borde izquierdo del header |
| `SUSPEND` | Suspensión | `#FF9800` (naranja) | Borde izquierdo del header |
| `PRICE_CHANGE` | Cambio de Precio | `#4CAF50` (verde) | Borde izquierdo del header |
| *(desconocido)* | *(raw type)* | `#607D8B` (gris azulado) | Fallback |

El color se aplica como `borderLeftWidth: 6, borderLeftColor: typeColor` en el header del componente. No usa tokens de Gluestack (los 5 colores son custom del dominio operativo del supermercado).

---

## Layout de la pantalla

```
┌─────────────────────────────────┐
│ ▌ Cambio de Precio              │  ← header: borde color + etiqueta legible
│   03/06/2026 10:30              │  ← fecha formateada (UTC, testID="detail-created-at")
├─────────────────────────────────┤
│ ScrollView                      │
│  POS          pos-1             │  ┐
│  Tienda       store-42          │  │ InfoRows comunes
│  Correlación  corr-99           │  ┘
│  ─────────────────────────────  │
│  Producto     prod-1            │  ┐
│  Precio original  1000          │  │ InfoRows específicos (PRICE_CHANGE)
│  Precio solicitado  600         │  ┘
│                                 │
│  ┌─────────────────────────┐   │  ← banner resolved (solo si está resuelto)
│  │    Ya autorizada        │   │    fondo #E8F5E9 / texto #388E3C
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │  ← banner error (solo si hay error)
│  │  Error al enviar...     │   │    fondo #FFEBEE / texto #D32F2F
│  └─────────────────────────┘   │
│                                 │
│  [  Autorizar  ] [ Rechazar  ] │  ← botones HStack (Gluestack Button)
└─────────────────────────────────┘
```

### Campos por tipo

| Campo | `PRICE_CHANGE` | `DISCOUNT` | `EMPLOYEE_BENEFIT` | `CANCEL` / `SUSPEND` |
|---|:---:|:---:|:---:|:---:|
| POS, Tienda, Correlación | ✓ | ✓ | ✓ | ✓ |
| Producto (`product_id`) | ✓ | — | — | — |
| Precio original (`original_price`) | ✓ | — | — | — |
| Precio solicitado (`requested_price`) | ✓ | — | — | — |
| Monto (`amount`) | — | si definido | — | — |
| Empleado (`employee_id`) | — | — | si definido | — |

Para `PRICE_CHANGE`, los tres campos de precio siempre se muestran (con `'-'` si son `undefined`). Para `DISCOUNT` y `EMPLOYEE_BENEFIT`, el campo opcional se muestra solo si está definido en la solicitud.

### Formato de fecha

`formatDate(isoString)` convierte una fecha ISO 8601 a `DD/MM/YYYY HH:MM` usando **UTC** (sin conversión a zona local). Ejemplo: `'2026-06-03T10:30:00.000Z'` → `'03/06/2026 10:30'`. Si el parsing falla, retorna el string original sin modificar.

---

## Estados de la pantalla

| Estado | Condición | Comportamiento visible |
|---|---|---|
| **Pendiente** | `!request.resolved && !isLoading && !error` | Botones habilitados, sin banners |
| **Procesando decisión** | `isLoading=true` | Ambos botones `disabled`; "Autorizar" muestra `ButtonSpinner` (testID=`approve-button-spinner`) |
| **Error del BFF** | `error != null` | Banner rojo con mensaje de error; botones re-habilitados para reintento |
| **Ya autorizada** | `request.resolved === 'APPROVED'` | Banner verde "Ya autorizada"; botones `disabled` |
| **Ya rechazada** | `request.resolved === 'REJECTED'` | Banner rojo "Ya rechazada"; botones `disabled` |

Los estados "error" y "resuelta" no son mutuamente excluyentes con el estado `isLoading=false`; la lógica `isDisabled = isLoading || !!request.resolved` garantiza que los botones solo se re-habilitan si la solicitud sigue pendiente.

---

## Historias de Usuario

### US-01: Ver detalle completo por tipo de solicitud `[Must]`

> Como **supervisor autenticado**, quiero **ver todos los campos relevantes de la solicitud según su tipo**, para que **pueda tomar una decisión informada sin necesidad de llamar al cajero**.

**Criterios de aceptación:**
- [x] La pantalla muestra el tipo en lenguaje natural (ej. "Cambio de Precio") con su color de acento como borde izquierdo.
- [x] La fecha de creación se muestra formateada como `DD/MM/YYYY HH:MM` (UTC) bajo el tipo.
- [x] Para **todos** los tipos se muestran: POS, Tienda y Correlación.
- [x] Para `PRICE_CHANGE` se muestran adicionalmente: Producto, Precio original y Precio solicitado.
- [x] Para `DISCOUNT` se muestra el Monto si está definido.
- [x] Para `EMPLOYEE_BENEFIT` se muestra el ID de Empleado si está definido.
- [x] Tipos desconocidos muestran el raw type como etiqueta y color gris de fallback.

---

### US-02: Autorizar o rechazar una solicitud `[Must]`

> Como **supervisor autenticado**, quiero **poder autorizar o rechazar la solicitud con un toque**, para que **el POS reciba la respuesta y pueda continuar la operación**.

**Criterios de aceptación:**
- [x] La pantalla tiene dos botones: "Autorizar" y "Rechazar".
- [x] Al presionar "Autorizar" se llama `onDecide('APPROVE')`.
- [x] Al presionar "Rechazar" se llama `onDecide('REJECT')`.
- [x] `useDecision` hace `POST /authorization/:correlationId/resolve` con `{ decision, supervisor_id }`.
- [x] Tras respuesta 2xx del BFF, `decide()` retorna `true` y la app navega de vuelta al listado.
- [x] Tras error del BFF, `decide()` retorna `false` y la app permanece en el detalle.

---

### US-03: Retroalimentación visual durante el procesamiento `[Must]`

> Como **supervisor**, quiero **saber que mi acción está siendo procesada**, para que **no presione el botón dos veces ni asuma que falló**.

**Criterios de aceptación:**
- [x] Durante el procesamiento (`isLoading=true`) ambos botones están deshabilitados.
- [x] El botón "Autorizar" muestra un `ButtonSpinner` (testID=`approve-button-spinner`) mientras procesa.
- [x] El botón "Rechazar" permanece visible (con texto) pero deshabilitado.
- [x] Al completarse la operación (éxito o error), `isLoading` vuelve a `false`.

---

### US-04: Manejo de errores del BFF `[Must]`

> Como **supervisor**, quiero **saber cuando algo falló y poder reintentar**, para que **no quede una solicitud sin respuesta por un fallo transitorio**.

**Criterios de aceptación:**
- [x] Ante cualquier respuesta non-2xx del BFF se muestra un banner rojo con el mensaje de error (testID=`detail-error`).
- [x] Los botones se re-habilitan tras el error para permitir reintento.
- [x] El banner de error no aparece cuando `error` es `null`.
- [x] Ante un error de red (fetch rechazado) el comportamiento es idéntico al error HTTP.

---

### US-05: Solicitud ya resuelta — estado de solo lectura `[Must]`

> Como **supervisor**, quiero **ver el estado final de una solicitud ya resuelta sin poder modificarla**, para que **no envíe una segunda respuesta por error**.

**Criterios de aceptación:**
- [x] Si `request.resolved === 'APPROVED'`, se muestra banner verde "Ya autorizada" y ambos botones están deshabilitados.
- [x] Si `request.resolved === 'REJECTED'`, se muestra banner rojo "Ya rechazada" y ambos botones están deshabilitados.
- [x] No se hace ningún POST al BFF al entrar a una solicitud resuelta.

---

## Escenarios BDD

```gherkin
Feature: Detalle de una solicitud de autorización
  Como supervisor autenticado en una tienda
  Quiero ver el detalle completo de una solicitud y poder decidir
  Para que el POS reciba la respuesta correcta

  Background:
    Given el supervisor está autenticado con store_id "store-42" y supervisor_id "sup-1"
    And ha tocado la card de la solicitud "corr-99" en el listado

  Scenario: Ver detalle de solicitud PRICE_CHANGE
    Given la solicitud "corr-99" es de tipo PRICE_CHANGE
    And tiene product_id "prod-1", original_price 1000 y requested_price 600
    When la pantalla de detalle se muestra
    Then el header muestra "Cambio de Precio" con borde verde (#4CAF50)
    And se muestran los campos: Producto "prod-1", Precio original "1000", Precio solicitado "600"
    And los botones "Autorizar" y "Rechazar" están habilitados

  Scenario: Ver detalle de solicitud DISCOUNT con monto
    Given la solicitud es de tipo DISCOUNT con amount 250
    When la pantalla de detalle se muestra
    Then el header muestra "Descuento" con borde azul (#2196F3)
    And se muestra el campo Monto con valor "250"

  Scenario: Ver detalle de solicitud EMPLOYEE_BENEFIT
    Given la solicitud es de tipo EMPLOYEE_BENEFIT con employee_id "emp-007"
    When la pantalla de detalle se muestra
    Then el header muestra "Beneficio Empleado" con borde púrpura (#9C27B0)
    And se muestra el campo Empleado con valor "emp-007"

  Scenario: El supervisor autoriza una solicitud exitosamente
    Given la solicitud "corr-99" está pendiente
    When el supervisor presiona "Autorizar"
    Then se muestra el spinner dentro del botón Autorizar
    And el botón Rechazar está deshabilitado
    And se envía POST /authorization/corr-99/resolve con {"decision":"APPROVE","supervisor_id":"sup-1"}
    And tras la respuesta 2xx el supervisor vuelve al listado

  Scenario: El supervisor rechaza una solicitud exitosamente
    Given la solicitud "corr-99" está pendiente
    When el supervisor presiona "Rechazar"
    Then se envía POST /authorization/corr-99/resolve con {"decision":"REJECT","supervisor_id":"sup-1"}
    And tras la respuesta 2xx el supervisor vuelve al listado

  Scenario: Error del BFF al enviar la decisión
    Given la solicitud "corr-99" está pendiente
    When el supervisor presiona "Autorizar"
    And el BFF responde con error 500
    Then se muestra el banner de error con el mensaje
    And ambos botones se re-habilitan para reintento
    And el supervisor permanece en la pantalla de detalle

  Scenario: Solicitud ya autorizada al abrir el detalle
    Given la solicitud "corr-99" ya tiene estado "APPROVED"
    When el supervisor abre el detalle
    Then se muestra el banner verde "Ya autorizada"
    And ambos botones están deshabilitados
    And no se hace ninguna llamada POST al BFF

  Scenario: Solicitud ya rechazada al abrir el detalle
    Given la solicitud "corr-99" ya tiene estado "REJECTED"
    When el supervisor abre el detalle
    Then se muestra el banner rojo "Ya rechazada"
    And ambos botones están deshabilitados
```

---

## Plan de Tests TDD

### `AuthorizationDetailScreen`

**Archivo:** `apps/mobile/src/screens/__tests__/AuthorizationDetailScreen.test.tsx`

**Renderizado por tipo**
- [x] Muestra `product_id`, `original_price` y `requested_price` para `PRICE_CHANGE`
- [x] Muestra `amount` para tipo `DISCOUNT`
- [x] Muestra `employee_id` para tipo `EMPLOYEE_BENEFIT`

**Botones de acción**
- [x] Ambos botones "Autorizar" y "Rechazar" están presentes
- [x] Presionar "Autorizar" llama a `onDecide('APPROVE')`
- [x] Presionar "Rechazar" llama a `onDecide('REJECT')`

**Estado de carga**
- [x] Ambos botones tienen `accessibilityState.disabled=true` cuando `isLoading=true`
- [x] Muestra `ButtonSpinner` (testID=`approve-button-spinner`) en botón Autorizar cuando `isLoading=true`
- [x] Los botones están habilitados cuando `isLoading=false` y la solicitud está pendiente

**Cabecera de tipo y fecha**
- [x] Muestra etiqueta legible "Cambio de Precio" para tipo `PRICE_CHANGE`
- [x] Muestra el `created_at` formateado en el encabezado (testID=`detail-created-at`)
- [x] Muestra la fecha como `DD/MM/YYYY` (`'2026-06-03T10:30:00.000Z'` → `'03/06/2026 10:30'`)
- [x] Muestra etiqueta "Descuento" para tipo `DISCOUNT`

**Banner de error**
- [x] No muestra el banner de error cuando `error` es `null`
- [x] Muestra el banner (testID=`detail-error`) con el mensaje cuando `error` es un string

**Solicitud ya resuelta**
- [x] Ambos botones deshabilitados cuando `resolved=APPROVED`
- [x] Muestra texto "Ya autorizada" cuando `resolved=APPROVED`
- [x] Ambos botones deshabilitados cuando `resolved=REJECTED`
- [x] Muestra texto "Ya rechazada" cuando `resolved=REJECTED`

---

### `useDecision`

**Archivo:** `apps/mobile/src/hooks/__tests__/useDecision.test.ts`

**Estado inicial**
- [x] Expone `isLoading=false` y `error=null` en el estado inicial

**decide APPROVE**
- [x] Hace `POST /authorization/:correlationId/resolve` con `decision=APPROVE` y `supervisor_id`
- [x] Establece `isLoading=true` mientras el POST está en vuelo
- [x] Establece `isLoading=false` y `error=null` tras respuesta exitosa

**decide REJECT**
- [x] Hace `POST` con `decision=REJECT` y `supervisor_id`

**Manejo de error**
- [x] Establece `isLoading=false` y `error` con mensaje tras respuesta non-2xx (500)
- [x] Establece `error` cuando fetch rechaza (error de red)

---

## Definition of Done

- [x] Todos los tests unitarios de `AuthorizationDetailScreen` y `useDecision` pasan en verde
- [x] `pnpm typecheck` sin errores en `apps/mobile`
- [x] La pantalla de detalle se muestra en el emulador Android sin pantalla roja
- [x] Los botones Autorizar/Rechazar envían la decisión correcta al BFF y navegan de vuelta al listado
- [x] Los estados de carga, error y solicitud resuelta son visibles en el emulador
- [x] Code review aprobado

---

## Resultado

**Fecha de finalización:** 2026-06-04  
**Status del spec:** completed

### Implementado

- [x] US-01: Detalle por tipo con campos específicos (`PRICE_CHANGE`, `DISCOUNT`, `EMPLOYEE_BENEFIT`)
- [x] US-02: Botones Autorizar/Rechazar con `useDecision` y navegación tras éxito
- [x] US-03: `ButtonSpinner` en botón Autorizar + ambos botones deshabilitados durante `isLoading`
- [x] US-04: Banner de error rojo con mensaje; botones re-habilitados para reintento
- [x] US-05: Banners "Ya autorizada" / "Ya rechazada" con botones bloqueados

### No implementado / Desviaciones

- Ninguna. El spec documenta la implementación real.

### Tests

- Unitarios `AuthorizationDetailScreen`: 13/13 pasando
- Unitarios `useDecision`: 7/7 pasando
- E2E Detox: pendiente de configuración de Detox en el proyecto

---

## Riesgos y Dependencias

| Tipo | Detalle |
|---|---|
| Dependencia activa | `SessionContext` provee `supervisorId` mockeado — integración real espera ciclo de autenticación |
| Limitación BFF | Errores upstream (ej. 409 ya resuelta) llegan como 5xx genérico; la app no puede distinguir el motivo — tratamiento uniforme como error genérico |
| Fuera de scope | Autenticación real, confirmación de decisión, motivo de rechazo, historial de solicitudes |
