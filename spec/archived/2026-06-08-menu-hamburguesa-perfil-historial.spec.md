# Spec: Menú Hamburguesa con Perfil, Historial, Badge de Pendientes y Presencia Física

**Fecha:** 2026-06-08
**Stack inferido:** React Native + Gluestack-UI v1 + NestJS BFF
**Estado:** Completed
**Revisión:** 2

---

## Contexto

Actualmente la app móvil del supervisor carece de navegación estructurada: solo existe una vista de lista de solicitudes y una vista de detalle, conmutadas por estado local (`useState`). No hay forma de acceder al perfil del usuario, revisar el historial de decisiones pasadas, ni cerrar sesión explícitamente.

Esta feature agrega un menú hamburguesa (panel lateral deslizable) con opciones de navegación, un badge de solicitudes pendientes, un indicador de alerta para solicitudes de presencia física, vista de perfil, historial de solicitudes resueltas, y cierre de sesión.

**Fuera de scope:** Cambio de contraseña, multi-tienda, notificaciones push, modo oscuro, paginación de historial.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    Los supervisores necesitan acceso rápido a perfil (identidad), historial (auditoría),
    logout explícito (seguridad), y visibilidad inmediata de solicitudes pendientes y
    presencia física (reducción de carga cognitiva y tiempo de respuesta).
  </Rationale>
  <Explanation>
    Panel lateral custom con Animated API + Gluestack-UI, sin dependencias externas.
    Badge de pendientes derivado del stream SSE existente (useSSERequests).
    Badge de presencia física desde evento SSE physical_presence_dispatch (ya fluye
    por el backend pero es ignorado por la app). Historial requiere nuevo endpoint
    REST en BFF → authorization-service. Logout limpia AsyncStorage + SessionContext.
  </Explanation>
  <Assumptions>
    - El JWT contiene storeId, supervisorId y displayName.
    - El supervisor pertenece a una sola tienda.
    - El SSE ya entrega ambos tipos de eventos (authorization_request y physical_presence_dispatch).
    - El authorization-service persiste solicitudes con estado en Postgres.
  </Assumptions>
  <Scrutiny>
    - ¿El panel animado funciona fluido en Android gama baja? → useNativeDriver: true.
    - ¿Qué pasa si AsyncStorage falla en logout? → resetear sesión en finally.
  </Scrutiny>
  <Objections>
    - "Drawer library sería más rápido" → Agrega dependencia; panel custom ~100 líneas.
    - "Badge redundante con la lista" → Visible incluso en vista de detalle/perfil.
  </Objections>
  <Novelty>
    - Primer componente animado con Animated API en la app.
    - Primer badge numérico en header.
    - Primer manejo de physical_presence_dispatch en mobile.
    - Nuevo endpoint REST GET /api/requests/history en BFF.
    - Primer hook de logout.
  </Novelty>
  <Substitutes>
    - @react-navigation/drawer: descartado por dependencia innecesaria.
    - Bottom sheet: descartado, panel lateral más natural para navegación.
    - Modal para perfil: descartado, interrumpe flujo.
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: Panel lateral de navegación `[Must]`

> Como **supervisor**, quiero **abrir un menú lateral desde un ícono ☰ en el header**, para que **pueda navegar a otras secciones sin perder de vista la lista**.

**Criterios de aceptación:**
- [ ] Ícono ☰ en el header abre panel animado (300ms, translateX) desde la izquierda
- [ ] Panel cubre ~75% del ancho, overlay semitransparente en el resto
- [ ] Overlay + swipe cierran el panel
- [ ] Panel muestra displayName del supervisor
- [ ] Opciones: "Mi Perfil", "Historial", "Cerrar sesión"

### US-05: Badge de solicitudes pendientes `[Must]`

> Como **supervisor**, quiero **ver un contador de solicitudes pendientes en el header**, para que **sepa cuántas requieren atención inmediata**.

**Criterios de aceptación:**
- [ ] Ícono 🔔 en el header con badge numérico
- [ ] Conteo = solicitudes sin `resolved` (estado PENDING)
- [ ] Se oculta cuando count = 0
- [ ] Muestra "99+" cuando count > 99

### US-06: Indicador de presencia física `[Must]`

> Como **supervisor**, quiero **ver una alerta cuando se requiere mi presencia física en una caja**, para que **pueda acudir inmediatamente**.

**Criterios de aceptación:**
- [ ] Ícono ⚠️ en el header con badge numérico de solicitudes presenciales
- [ ] Se actualiza vía SSE evento `physical_presence_dispatch`
- [ ] Las solicitudes presenciales aparecen en la lista con fondo ámbar y etiqueta "Presencial"
- [ ] El badge se oculta cuando count = 0
- [ ] Badge con animación de pulso al recibir nueva solicitud

### US-02: Vista de perfil `[Should]`

> Como **supervisor**, quiero **ver mi información de perfil**, para que **confirmar mi identidad y datos de sesión**.

**Criterios de aceptación:**
- [ ] Accesible desde "Mi Perfil" en el menú
- [ ] Muestra displayName, supervisorId, storeId
- [ ] Solo lectura, botón "Volver"

### US-03: Cerrar sesión `[Must]`

> Como **supervisor**, quiero **cerrar sesión explícitamente**, para que **mis credenciales no queden expuestas**.

**Criterios de aceptación:**
- [ ] Accesible desde "Cerrar sesión" en el menú
- [ ] Diálogo de confirmación antes de logout
- [ ] Limpia access_token, refresh_token, expires_at de AsyncStorage
- [ ] Resetea SessionContext → LoginScreen

### US-04: Historial de solicitudes `[Should]`

> Como **supervisor**, quiero **consultar el historial de solicitudes resueltas de mi tienda**, para que **pueda auditar decisiones pasadas**.

**Criterios de aceptación:**
- [ ] Accesible desde "Historial" en el menú
- [ ] Lista de solicitudes APPROVED/REJECTED para la tienda
- [ ] Filtro: Todas, Autorizadas, Rechazadas
- [ ] Mensaje vacío cuando no hay historial
- [ ] Endpoint GET /api/requests/history?storeId=X&status=...

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? | Capa |
|-----|-----------|-----------------|------|
| US-01 | — | sí | 1 |
| US-05 | — | sí | 1 |
| US-06 | — | sí | 1 |
| US-02 | US-01 | sí dentro de capa 2 | 2 |
| US-03 | US-01 | sí dentro de capa 2 | 2 |
| US-04 | US-01 | sí dentro de capa 2 | 2 |

---

## Definition of Done

- [ ] Todos los tests pasan en verde (45 tests)
- [ ] Typecheck limpio en mobile + backend
- [ ] Panel animado ≥30fps en emulador
- [ ] Badges se actualizan en tiempo real vía SSE
- [ ] Logout limpia AsyncStorage y redirige a login
- [ ] Endpoint historial responde correctamente

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | Ninguna nueva |
| Riesgo técnico | Performance Animated.View en Android gama baja → useNativeDriver: true |
| Suposición | authorization-service persiste solicitudes con status → confirmado (tabla auth.authorization_requests) |

---

## Resultado

**Completado:** 2026-06-08

### USTs implementadas

- [x] US-01: Panel lateral de navegación (HamburgerMenu)
- [x] US-05: Badge de solicitudes pendientes (PendingBadge)
- [x] US-06: Indicador de presencia física (PhysicalPresenceBadge + usePhysicalPresenceDispatches)
- [x] US-02: Vista de perfil del usuario (UserProfileScreen)
- [x] US-03: Cerrar sesión (useLogout)
- [x] US-04: Historial de solicitudes (HistoryScreen + useRequestHistory + endpoint backend)

### Desviaciones

- US-03: El SessionContext actual es un mock estático. El logout solo limpia AsyncStorage. Pendiente integrar con auth real (Keycloak JWT).
- US-04: Se usó `ne('PENDING')` en la query Drizzle en lugar de un parámetro de status genérico, siguiendo la convención existente de `findPendingByStore`.

### Tests

| Servicio | Tests | Resultado |
|---|---|---|
| Mobile | 67 | ✅ 6 suites |
| Authorization-service | 92 | ✅ 10 suites |
| BFF | 7 | ✅ 2 suites |
| SSE-server | 8 | ✅ 2 suites |
| **Total** | **174** | ✅ |

### Archivos creados/modificados

| Archivo | Operación |
|---|---|
| `apps/mobile/src/components/HamburgerMenu.tsx` | CREADO |
| `apps/mobile/src/components/PendingBadge.tsx` | CREADO |
| `apps/mobile/src/components/PhysicalPresenceBadge.tsx` | CREADO |
| `apps/mobile/src/components/AuthorizationCard.tsx` | MODIFICADO |
| `apps/mobile/src/components/AuthorizationList.tsx` | MODIFICADO |
| `apps/mobile/src/screens/UserProfileScreen.tsx` | CREADO |
| `apps/mobile/src/screens/HistoryScreen.tsx` | CREADO |
| `apps/mobile/src/hooks/usePhysicalPresenceDispatches.ts` | CREADO |
| `apps/mobile/src/hooks/useLogout.ts` | CREADO |
| `apps/mobile/src/hooks/useRequestHistory.ts` | CREADO |
| `apps/mobile/src/context/SessionContext.tsx` | MODIFICADO |
| `apps/mobile/App.tsx` | MODIFICADO |
| `apps/mobile/jest.config.js` | MODIFICADO |
| `apps/authorization-service/src/domain/ports/authorization-repository.port.ts` | MODIFICADO |
| `apps/authorization-service/src/infrastructure/persistence/drizzle/drizzle-authorization.repository.ts` | MODIFICADO |
| `apps/authorization-service/src/authorization/authorization.controller.ts` | MODIFICADO |
| `apps/bff/src/authorization/authorization.service.ts` | MODIFICADO |
| `apps/bff/src/authorization/authorization.controller.ts` | MODIFICADO |
| `spec/2026-06-08-menu-hamburguesa-perfil-historial.spec.md` | CREADO |
