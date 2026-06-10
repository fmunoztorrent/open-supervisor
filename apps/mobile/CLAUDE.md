# mobile

App React Native (Android) para supervisores de supermercado. Recibe solicitudes de autorización en tiempo real vía SSE desde el BFF, las muestra en un listado de cards y permite al supervisor autorizarlas o rechazarlas. La decisión viaja al BFF por REST.

## Flujo de trabajo obligatorio

Ver flujo completo en el CLAUDE.md raíz del repositorio. **No omitir ningún paso.**

## Responsabilidades

- Conectar al BFF vía SSE y mostrar solicitudes en tiempo real
- Cargar solicitudes pendientes pre-existentes al montar (GET inicial)
- Navegar al detalle de una solicitud y enviar la decisión del supervisor
- Reconectar automáticamente el stream SSE si se interrumpe

## Arquitectura interna

```
App.tsx                              # Entry point: GluestackUIProvider > SessionProvider > SupervisorApp

src/
  api/
    bffClient.ts                     # Cliente HTTP centralizado (BFF_BASE_URL via react-native-config)

  context/
    SessionContext.tsx               # Provee storeId y supervisorId (mockeados; pendiente auth real)

  hooks/
    useSSERequests.ts                # GET /pending + EventSource SSE; expone requests, isLoading, isReconnecting
    useDecision.ts                   # POST /authorization/:id/resolve; expone decide, isLoading, error

  components/
    AuthorizationCard.tsx            # Card de solicitud: tipo, POS ID, fecha, badge de estado
    AuthorizationList.tsx            # Lista scrolleable de cards + estados de carga/vacío

  screens/
    AuthorizationDetailScreen.tsx    # Detalle de solicitud con botones Autorizar / Rechazar

  types/
    index.ts                         # Tipos locales adicionales
```

## UI — Gluestack UI v1

Todos los componentes visuales usan `@gluestack-ui/themed`. **No usar `StyleSheet.create` en componentes de la app.**

| Componente Gluestack | Uso |
|---|---|
| `GluestackUIProvider` | Wrapper raíz en `App.tsx` — `config` de `@gluestack-ui/config` |
| `Box` | Contenedor genérico con estilo inline |
| `HStack` / `VStack` | Layouts horizontal / vertical |
| `Pressable` | Reemplaza `TouchableOpacity` |
| `Text` | Todo el texto de la app |
| `Badge` + `BadgeText` | Badge de estado en `AuthorizationCard` (Pendiente / Autorizada / Rechazada) |
| `Center` | Centra el `Spinner` y el estado vacío en `AuthorizationList` |
| `Spinner` | Estado de carga (`testID="list-spinner"`) |
| `ScrollView` | Lista de cards |
| `Button` + `ButtonText` | Botones Autorizar / Rechazar en `AuthorizationDetailScreen` |
| `ButtonSpinner` | Spinner dentro del botón Autorizar cuando `isLoading=true` (`testID="approve-button-spinner"`) |

`SafeAreaView` y `StatusBar` de React Native se mantienen — no tienen equivalente en Gluestack v1.

> ⚠️ **Inset superior en Android:** `SafeAreaView` de `react-native` es un **no-op en Android** (solo aplica insets en iOS). Con `targetSdkVersion = 35` la status bar es edge-to-edge y el header se solapa. Por eso cada `SafeAreaView` en `App.tsx` lleva `paddingTop: StatusBar.currentHeight ?? 0` (Android-only; en iOS es `undefined` → `0`). Leer `StatusBar.currentHeight` en tiempo de render, nunca dentro de `StyleSheet.create`.

## Endpoints del BFF que consume

| Operación | Ruta | Descripción |
|---|---|---|
| Carga inicial | `GET /authorization/store/:storeId/pending` | Solicitudes pendientes al montar |
| Stream SSE | `GET /stream/store/:storeId` | Eventos `authorization_request` en tiempo real |
| Enviar decisión | `POST /authorization/:id/resolve` | Body: `{ decision: 'APPROVE'\|'REJECT', supervisor_id }` |

El BFF retorna errores genéricos (5xx) para cualquier fallo upstream. La app no distingue el motivo — trata todo non-2xx como error y re-habilita los botones.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `BFF_BASE_URL` | URL base del BFF (ej. `http://10.0.2.2:3000` en emulador Android) |

Configuradas en `apps/mobile/.env` vía `react-native-config`.

## Testing

- Tests unitarios y de integración: Jest + `@testing-library/react-native`
- **Usar `renderWithProvider`** (definido en `jest.setup.js`) en lugar de `render` directo para componentes que usen Gluestack — necesitan el `GluestackUIProvider` en el wrapper
- `jest.config.js` incluye `@gluestack-ui|@gluestack-style|@legendapp|@expo` en `transformIgnorePatterns` (ESM puro)
- E2E: Detox (pendiente de configuración)

## Convenciones

- `useSSERequests` instancia `EventSource<'authorization_request'>` con el nombre del evento custom en el generic — requerido por `react-native-sse`
- El cleanup de SSE siempre llama `removeAllEventListeners()` + `close()` en el return del `useEffect`
- `SessionContext` provee `storeId` y `supervisorId` hardcodeados — reemplazar cuando se implemente autenticación real
- `bffClient` centraliza la `BASE_URL` y el manejo de errores HTTP; no hacer `fetch` directo en hooks ni componentes
- Los colores por `RequestType` en `AuthorizationCard` se aplican via `style={{ backgroundColor: typeColor }}` en un `Box` — los tokens Gluestack no cubren los 5 colores custom del dominio

## Separación de concerns

La app sigue el modelo de React Native: hooks para lógica, componentes para presentación. Los hooks son la capa de abstracción — no hay "ports" formales como en el backend, pero la separación de capas es igualmente estricta.

| Capa | Archivos | Puede hacer | NO puede hacer |
|---|---|---|---|
| **API adapter** | `api/bffClient.ts` | Centralizar BASE_URL, headers, manejo de errores HTTP | Lógica de negocio, estado local |
| **Hooks** | `hooks/use*.ts` | Lógica de datos (fetch, SSE, decisiones), estado | Renderizar JSX |
| **Componentes** | `components/*.tsx` | Renderizar props, disparar callbacks | Llamar `bffClient` directamente, conocer URLs |
| **Screens** | `screens/*.tsx` | Componer hooks + componentes, orquestar layout | Lógica de negocio, llamadas HTTP directas |

### Reglas taxativas

```typescript
// ❌ PROHIBIDO — fetch directo en un componente o screen
function AuthorizationCard({ id }: Props) {
  useEffect(() => { fetch(`/authorization/${id}`) }, []);  // violación de capas
}

// ✅ CORRECTO — hook encapsula la lógica; componente recibe solo callback
function useDecision(correlationId: string) {
  const decide = async (d: 'APPROVE' | 'REJECT') =>
    bffClient.post(`/authorization/${correlationId}/resolve`, { decision: d });
  return { decide };
}

function DetailScreen() {
  const { decide } = useDecision(correlationId); // lógica en el hook
  return <Button onPress={() => decide('APPROVE')} />;  // UI pura
}
```

### Single Responsibility en hooks

- `useSSERequests` → cambia solo si el protocolo SSE o el endpoint de pending cambia
- `useDecision` → cambia solo si el contrato de decisión cambia

Si un hook supera ~80 líneas, evaluar si tiene más de una responsabilidad y si corresponde separarlo.
