---
name: react-native-sse
description: Use when working with Server-Sent Events (SSE) in the React Native mobile app. Covers connection setup, event handling, reconnection, and integration with the BFF endpoint. Do NOT use for general HTTP calls or WebSocket connections.
---

# SSE en React Native (open-supervisor)

## Endpoint del BFF

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/stream/store/:storeId` | Stream SSE de solicitudes en tiempo real |

Eventos SSE:
- `authorization_request` — nueva solicitud de autorización
- `physical_presence_dispatch` — presencia física enviada

## Patrón de conexión

```typescript
import EventSource from 'react-native-sse';
import Config from 'react-native-config';

const storeId = 'store-123';
const es = new EventSource<'authorization_request' | 'physical_presence_dispatch'>(
  `${Config.BFF_URL}/stream/store/${storeId}`
);

es.addEventListener('authorization_request', (event) => {
  if (event.data == null) return;
  const request = JSON.parse(event.data);
  // manejar solicitud
});

es.addEventListener('physical_presence_dispatch', (event) => {
  if (event.data == null) return;
  const dispatch = JSON.parse(event.data);
  // manejar dispatch
});
```

## Consideraciones importantes

1. **Generic obligatorio**: `EventSource<'authorization_request' | 'physical_presence_dispatch'>` — sin el generic, TypeScript rechaza eventos custom.
2. **Null check**: `event.data` es `string | null` — hacer guard `if (event.data == null) return` antes de `JSON.parse`.
3. **Reconexión**: `react-native-sse` maneja reconexión automática con backoff. Monitorear eventos `'error'` y `'open'` para feedback visual.
4. **Limpieza**: llamar `es.close()` en `useEffect` cleanup o al desmontar el componente.
5. **Carga inicial**: además del SSE, hacer `GET /authorization/store/:storeId/pending` para solicitudes previas.

## Manejo de errores

```typescript
es.addEventListener('error', (event) => {
  if (event.data == null) return;
  console.error('SSE error:', event.data);
  // mostrar indicador de reconexión en UI
});
```
