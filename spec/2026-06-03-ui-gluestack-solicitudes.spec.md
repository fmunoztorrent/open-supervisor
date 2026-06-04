# Spec: Interfaz UI de solicitudes con Gluestack UI

**Fecha:** 2026-06-03  
**Stack inferido:** React Native 0.76 (Android) + TypeScript + pnpm workspaces  
**Estado:** Completed  

---

## Contexto

La app móvil ya tiene implementada la lógica funcional completa: conexión SSE, carga inicial de solicitudes, hook `useDecision` y navegación entre listado y detalle. Los componentes actuales (`AuthorizationCard`, `AuthorizationList`, `AuthorizationDetailScreen`, `App.tsx`) usan exclusivamente primitivos de React Native (`View`, `Text`, `TouchableOpacity`, `StyleSheet`) sin un sistema de diseño.

Esta feature reemplaza esos primitivos por componentes de **Gluestack UI** (`@gluestack-ui/themed`), obteniendo: tokens de diseño consistentes, accesibilidad built-in, variantes de estado (loading, disabled) sin estilos ad-hoc, y una base mantenible para iteraciones futuras de UI.

El scope es puramente de presentación. **No se toca ningún hook, API client, contexto ni lógica de negocio.** Todos los tests existentes deben seguir pasando tras la migración.

**Ambigüedades identificadas:**
- Versión de Gluestack: se usa `@gluestack-ui/themed` (v1) — la única versión validada end-to-end para React Native Android sin dependencias de RSC o web.
- Los componentes `Badge` y `Spinner` de Gluestack deben elegirse de la API pública de `@gluestack-ui/themed`; si un componente no existe en esa versión, se usa el primitivo equivalente de Gluestack (`Box` + `Text`).

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    Los primitivos actuales de React Native requieren StyleSheet manual para cada estado
    (disabled, loading, color por tipo). Mantener estilos ad-hoc en 3+ componentes
    introduce inconsistencia visual y deuda de diseño que crece con cada nueva pantalla.
    Gluestack aporta un sistema de tokens, variantes y accesibilidad que elimina esa deuda.
  </Rationale>
  <Explanation>
    Se instala @gluestack-ui/themed junto con sus peerDependencies
    (@gluestack-style/react, @gluestack-ui/config, react-native-svg, @legendapp/motion).
    Se envuelve la app en GluestackUIProvider con la config por defecto.
    Cada componente existente se reescribe reemplazando los primitivos de RN por los
    equivalentes de Gluestack (Box, HStack, VStack, Text, Button, ButtonText,
    ButtonSpinner, Badge, BadgeText, Spinner, Pressable).
    La lógica (props, handlers, condicionales) permanece idéntica.
  </Explanation>
  <Assumptions>
    - @gluestack-ui/themed v1 es compatible con React Native 0.76 y el entorno Android del proyecto.
    - Los peerDependencies (react-native-svg, @legendapp/motion) son instalables sin conflictos
      en el workspace pnpm actual.
    - Los tests existentes usan @testing-library/react-native, que renderiza Gluestack
      sin necesidad de mocks adicionales más allá del jest.setup.js ya configurado.
    - GluestackUIProvider puede envolverse en el renderCustom del jest.setup si los tests lo requieren.
    - El metro bundler actual soporta el build de Gluestack sin configuración adicional.
  </Assumptions>
  <Scrutiny>
    ¿Vale la pena introducir una dependencia de UI en este punto del MVP?
    Sí: el MVP ya tiene la lógica completa; la siguiente iteración agrega pantallas nuevas
    (autenticación, historial) — tener Gluestack instalado desde ahora evita migrar en medio
    del desarrollo activo.
    ¿Por qué v1 y no v2? v2 usa RSC como primitivo de styling, lo que agrega complejidad
    innecesaria en un contexto Android-only sin Next.js.
  </Scrutiny>
  <Objections>
    - "Los tests pueden romperse por el provider": se agrega GluestackUIProvider al wrapper
      del renderCustom en jest.setup.js. Si algún test falla, el fix es mínimo (wrappear el render).
    - "Gluestack agrega peso al bundle": el tree-shaking de Gluestack v1 es comparable a otros
      sistemas de diseño de RN; aceptable para MVP.
    - "Las props de accesibilidad actuales se perderán": los componentes de Gluestack tienen
      accessibilityRole y accessibilityState built-in; donde se necesite granularidad extra
      se pasan como props adicionales.
  </Objections>
  <Novelty>
    - Primera dependencia de UI system en apps/mobile.
    - GluestackUIProvider en App.tsx como wrapper global.
    - Reemplazo de StyleSheet por sx/style props de Gluestack en todos los componentes visuales.
    - Spinner de Gluestack reemplaza al Text "Cargando..." en AuthorizationList.
    - Button con ButtonSpinner reemplaza al TouchableOpacity con estado isLoading manual en DetailScreen.
  </Novelty>
  <Substitutes>
    - NativeBase: descartado, en fin de vida (mantenido por el mismo equipo que migró a Gluestack).
    - React Native Paper: Material Design; inconsistente con el diseño actual de la app (colores por tipo de solicitud).
    - Tamagui: mayor complejidad de setup (compilador) para un proyecto sin Next.js.
    - Mantener primitivos de RN: descartado; la deuda de estilos manuales ya es visible en 3 componentes.
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: Setup de Gluestack UI en el proyecto `[Must]`

> Como **desarrollador**, quiero **tener Gluestack UI instalado y configurado**, para que **los componentes puedan usar su sistema de diseño**.

**Criterios de aceptación:**
- [x] `@gluestack-ui/themed`, `@gluestack-style/react`, `@gluestack-ui/config`, `react-native-svg` y `@legendapp/motion` están en `dependencies` de `apps/mobile/package.json`.
- [x] `App.tsx` envuelve toda la aplicación en `<GluestackUIProvider config={config}>`.
- [ ] `pnpm android` compila sin errores de imports de Gluestack. *(pendiente: build nativo no verificado, requiere emulador)*
- [x] Los tests existentes (`pnpm test`) siguen pasando tras el setup.

**Notas:** Si los tests de hooks/componentes requieren provider, se actualiza el `renderCustom` en `jest.setup.js`.

---

### US-02: AuthorizationCard migrada a Gluestack `[Must]`

> Como **supervisor**, quiero **ver las cards de solicitudes con un diseño más pulido**, para que **pueda identificar rápidamente cada solicitud**.

**Criterios de aceptación:**
- [x] `AuthorizationCard` usa `Pressable`, `VStack`, `Box`, `Text` de `@gluestack-ui/themed`.
- [x] El indicador de color por tipo sigue diferenciando visualmente cada `RequestType`.
- [x] El badge de estado (Pendiente / Autorizada / Rechazada) usa `Badge` y `BadgeText` de Gluestack.
- [x] No hay `StyleSheet.create` en el archivo — los estilos van en props `style` de Gluestack.
- [x] El `testID="authorization-card"` se preserva para que los tests existentes sigan funcionando.

**Notas:** El `typeColor` por `RequestType` se puede seguir aplicando via `style={{ backgroundColor: typeColor }}` en un `Box`.

---

### US-03: AuthorizationList migrada a Gluestack `[Must]`

> Como **supervisor**, quiero **ver el listado de solicitudes con spinner de carga y estado vacío visuales**, para que **el feedback de estado sea claro**.

**Criterios de aceptación:**
- [x] `AuthorizationList` usa `ScrollView`, `Center`, `Spinner`, `Text` de `@gluestack-ui/themed`.
- [x] El estado de carga muestra un `<Spinner testID="list-spinner" />` de Gluestack.
- [x] El estado vacío muestra un `<Center>` con `<Text>` "Sin solicitudes pendientes".
- [x] No hay `StyleSheet.create` en el archivo.
- [x] El test nuevo verifica `getByTestId('list-spinner')` (el test de "Cargando..." no existía — se creó uno nuevo).

**Notas:** `Spinner` de Gluestack v1 acepta `size` y `color` como props.

---

### US-04: AuthorizationDetailScreen migrada a Gluestack `[Must]`

> Como **supervisor**, quiero **ver el detalle de la solicitud con botones de Gluestack**, para que **el feedback de loading y disabled sea nativo del sistema de diseño**.

**Criterios de aceptación:**
- [x] `AuthorizationDetailScreen` usa `Box`, `VStack`, `HStack`, `Text`, `Button`, `ButtonText`, `ButtonSpinner` de `@gluestack-ui/themed`.
- [x] El botón "Autorizar" en estado `isLoading` muestra `<ButtonSpinner testID="approve-button-spinner" />`.
- [x] La prop `isDisabled` de `Button` reemplaza al `disabled` manual de `TouchableOpacity`.
- [x] No hay `StyleSheet.create` en el archivo.
- [x] Los tests verifican `accessibilityLabel="Autorizar"` y `accessibilityLabel="Rechazar"` — pasan (50/50).

**Notas:** El indicador de estado resuelto ("Ya autorizada" / "Ya rechazada") puede usar `Text` con color de token Gluestack (`$success600` / `$error600`).

---

### US-05: App.tsx header migrado a Gluestack `[Should]`

> Como **supervisor**, quiero **ver el header de la app (título, botón Volver, banner de reconexión) con componentes Gluestack**, para que **la interfaz sea visualmente consistente**.

**Criterios de aceptación:**
- [ ] El header en `App.tsx` usa `HStack`, `Text`, `Pressable` de Gluestack en lugar de `View` + `StyleSheet`. *(no implementado — postergado)*
- [ ] El banner "Reconectando..." usa un `Box` con fondo de warning token de Gluestack. *(no implementado — postergado)*
- [x] `SafeAreaView` y `StatusBar` de React Native se mantienen.

**Notas:** —

---

## Escenarios BDD

```gherkin
Feature: Componentes visuales de la app usando Gluestack UI
  Como supervisor autenticado
  Quiero una interfaz visual consistente y accesible
  Para operar con eficiencia en las solicitudes de autorización

  Background:
    Given la app está compilada con @gluestack-ui/themed instalado
    And GluestackUIProvider envuelve toda la aplicación

  Scenario: Listado con Spinner durante carga inicial
    Given el hook useSSERequests está en estado isLoading=true
    When se renderiza AuthorizationList
    Then se muestra un componente Spinner de Gluestack
    And no se muestran cards de solicitudes

  Scenario: Card de descuento con badge Pendiente
    Given existe una solicitud de tipo DISCOUNT no resuelta
    When se renderiza AuthorizationCard con esa solicitud
    Then se ve el badge "Pendiente" usando componente Badge de Gluestack
    And el indicador lateral tiene el color asociado al tipo DISCOUNT

  Scenario: Botón Autorizar con spinner durante procesamiento
    Given el supervisor está en el detalle de una solicitud
    And se presionó el botón Autorizar (isLoading=true)
    When se renderiza AuthorizationDetailScreen
    Then el botón Autorizar muestra ButtonSpinner en lugar del texto "Autorizar"
    And el botón Rechazar tiene isDisabled=true

  Scenario: Botones deshabilitados en solicitud ya resuelta
    Given la solicitud tiene resolved="APPROVED"
    When el supervisor abre el detalle
    Then ambos botones tienen isDisabled=true
    And se muestra el texto de estado "Ya autorizada"
```

---

## Plan de Tests TDD

### US-01 — Setup

**Unitarios**
- [ ] [RED]   `App.tsx` falla si `GluestackUIProvider` no está disponible (import válido)
- [ ] [GREEN] Instalar dependencias y agregar provider

**Integración**
- [ ] Ejecutar `pnpm test` completo tras setup y confirmar 0 fallos

---

### US-02 — AuthorizationCard

**Unitarios**
- [ ] [RED]   `AuthorizationCard` importa de `@gluestack-ui/themed` (verificar que el import no rompe en Jest)
- [ ] [GREEN] Agregar wrapper en jest.setup.js si es necesario
- [ ] Verificar que `testID="authorization-card"` sigue siendo encontrable con `getByTestId`
- [ ] Verificar que badge "Pendiente" renderiza con `BadgeText` buscable por texto

**No se requieren tests nuevos**: los existentes en `AuthorizationCard.test.tsx` validan el comportamiento; solo se actualiza el setup si el provider es requerido.

---

### US-03 — AuthorizationList

**Unitarios**
- [ ] [RED]   Test de "muestra Cargando" falla porque el componente ya no tiene ese texto
- [ ] [GREEN] Actualizar test para buscar `Spinner` por `testID="list-spinner"` o `role="progressbar"`
- [ ] Verificar que "Sin solicitudes pendientes" sigue encontrable por texto

---

### US-04 — AuthorizationDetailScreen

**Unitarios**
- [ ] Verificar que `accessibilityLabel="Autorizar"` sigue presente en el `Button` de Gluestack
- [ ] Verificar que `disabled` se mapea a `isDisabled` en la prop del Button (test de interacción)
- [ ] [RED]   Test que verifica spinner de carga en botón Autorizar (si no existía)
- [ ] [GREEN] ButtonSpinner visible cuando `isLoading=true`

---

## Definition of Done

- [ ] Todos los escenarios BDD pasan
- [ ] `pnpm test` (suite completa mobile) en verde — cero regresiones
- [ ] `pnpm typecheck` sin errores en `apps/mobile`
- [ ] `pnpm lint` sin errores en `apps/mobile`
- [ ] `pnpm android` compila y la app corre en el emulador sin crashes
- [ ] La pantalla de solicitudes se ve con componentes Gluestack (Spinner, Badge, Button con ButtonSpinner)
- [ ] Ningún `StyleSheet.create` queda en los 4 archivos migrados

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Riesgo técnico A (alto) | peerDependencies de Gluestack v1 incluyen `react-native-svg` y `@legendapp/motion` — pueden requerir linking nativo en Android; verificar con `pnpm android` tras instalar |
| Riesgo técnico B (medio) | Tests con RNTL pueden necesitar `GluestackUIProvider` en el wrapper — actualizar `jest.setup.js` con `renderCustom` si algún test falla por contexto faltante |
| Riesgo técnico C (bajo) | `Badge` de Gluestack v1 puede no existir como componente separado — usar `Box` + `Text` con tokens de color como fallback |
| Dependencia | @gluestack-ui/themed compatible con React Native 0.76 (verificado en su matriz de compatibilidad) |
| Fuera de scope | Temas personalizados, dark mode, animaciones avanzadas |

---

## Resultado

**Fecha de finalización:** 2026-06-03
**Status del spec:** Completed

### Implementado
- [x] US-01: Gluestack instalado (`@gluestack-ui/themed@1.1.73`, `@gluestack-ui/config@1.1.20`, `@gluestack-style/react@1.0.57`, `react-native-svg@15.15.5`). `GluestackUIProvider` envuelve la app en `App.tsx`.
- [x] US-02: `AuthorizationCard` migrada a Pressable, VStack, Box, Badge, BadgeText. `testID` preservados.
- [x] US-03: `AuthorizationList` migrada a Center, Spinner, ScrollView. Test nuevo de `list-spinner` creado.
- [x] US-04: `AuthorizationDetailScreen` migrada a Button, ButtonText, ButtonSpinner (`testID="approve-button-spinner"`). `isDisabled` + `accessibilityState` explícito.

### No implementado / Desviaciones
- US-05 (Should): header de `App.tsx` postergado — `StyleSheet.create` permanece en App.tsx para el header y navegación. La migración de App.tsx header requiere más testing manual y no tiene cobertura de tests unitarios.
- Spec US-03 decía "actualizar test de Cargando...": ese test no existía. Se creó un test nuevo en su lugar (detectado por el architect).
- `@expo/html-elements` (dep transitiva de themed) requirió agregar `@expo` al `transformIgnorePatterns` de jest.config.js — no estaba documentado en el spec.

### Tests
- Unitarios: 50/50 pasando (48 pre-existentes + 2 nuevos: Spinner, ButtonSpinner)
- Integración: no aplica (pure UI migration)
- E2E: no corrido (`pnpm android` build nativo pendiente de verificar)
