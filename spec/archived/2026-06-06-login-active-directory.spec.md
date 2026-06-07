# Spec: Login con Keycloak federado a Active Directory simulado

**Fecha:** 2026-06-06  
**Stack inferido:** Node.js / NestJS + React Native (monorepo pnpm) + Keycloak 26 + OpenLDAP  
**Estado:** Completed  

---

## Contexto

Actualmente la app móvil usa una sesión hardcodeada (`storeId: 'store-1'`, `supervisorId: 'supervisor-1'`) en `SessionContext.tsx`. Esto impide cualquier despliegue productivo. Cada supervisor debe autenticarse con sus credenciales corporativas antes de acceder al listado de solicitudes.

Este spec cubre el flujo completo de login con Keycloak como identity broker OIDC, federado a un **Active Directory simulado** basado en OpenLDAP para el entorno de desarrollo. El BFF actúa como OIDC relying party usando el grant ROPC (Resource Owner Password Credentials). Keycloak emite los tokens JWT; el BFF los valida contra el endpoint JWKS de Keycloak.

El AD simulado (OpenLDAP) contiene usuarios precargados vía `.ldif` versionado en el repositorio. Keycloak se configura vía `realm-export.json` también versionado, lo que hace el entorno de desarrollo 100% reproducible con `make infra`.

**Queda fuera de scope:** logout explícito (se implementará en spec separado), MFA, bloqueo por intentos fallidos, gestión de roles/perfiles en Keycloak, y registro de nuevos usuarios.

**Ambigüedades resueltas:**
- El flujo OIDC será **ROPC (grant_type=password)** — la app envía credenciales al BFF, el BFF las reenvía a Keycloak. No hay redirects ni WebView.
- El `storeId` es un atributo LDAP custom mapeado al JWT por Keycloak. La pantalla de selección de tienda (US-07) existe solo como fallback.
- Keycloak se configura vía **import de realm en startup** (`--import-realm`), con archivo JSON versionado en `.docker/keycloak/`.
- OpenLDAP expone 10 usuarios simulados con los mismos campos del contrato AD actual: `employeeId` (RUT), `displayName`, `jobTitle`, `department`, `storeId`, `accountEnabled`.
- Las variables de entorno del BFF cambian: ya no usa `JWT_SECRET` propio sino `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    Reemplazar la sesión hardcodeada por autenticación real es prerequisito para
    cualquier despliegue productivo. Usar Keycloak como identity broker federado
    con AD evita acoplar la aplicación a un proveedor de identidad específico y
    permite simular el entorno completo en desarrollo con OpenLDAP.
  </Rationale>
  <Explanation>
    Keycloak actúa como OIDC provider. El BFF es un relying party que usa ROPC
    para autenticar al supervisor sin redirects (la app es first-party). Keycloak
    federa contra OpenLDAP (que simula el AD real) y emite JWTs firmados con RS256.
    El BFF valida los tokens contra el JWKS endpoint de Keycloak, eliminando la
    necesidad de compartir secretos. En producción, solo cambia el backend LDAP
    de Keycloak — el BFF y la app no se modifican.
  </Explanation>
  <Assumptions>
    - Keycloak 26 corre en el mismo docker-compose que el resto de la infra.
    - OpenLDAP (osixia/openldap) es suficiente para simular el AD real.
    - El AD real en producción también se accede vía LDAP(S), por lo que la
      federación LDAP de Keycloak funciona igual en prod cambiando solo la URL.
    - Los supervisores conocen su RUT y contraseña corporativa.
    - ROPC es aceptable para una app first-party (confidencial) como esta.
  </Assumptions>
  <Scrutiny>
    ¿Por qué ROPC y no Authorization Code + PKCE? Porque ROPC evita la complejidad
    de un browser/WebView en React Native. El BFF es un client confidencial que
    nunca expone el client_secret. El riesgo de ROPC (exponer credenciales al BFF)
    es aceptable porque el BFF es parte del mismo sistema.
    ¿Por qué no usar el AD real en desarrollo? Porque requeriría conectividad a la
    red corporativa. OpenLDAP simulado permite desarrollar offline.
  </Scrutiny>
  <Objections>
    - "ROPC está deprecated en OAuth 2.1": cierto, pero Keycloak lo soporta y es
      la opción más práctica para app first-party sin browser flow. Migrar a
      Auth Code + PKCE en el futuro si el estándar lo exige.
    - "JWKS validation agrega latencia": Keycloak corre en localhost, latencia
      despreciable. En prod se puede cachear la JWKS response.
  </Objections>
  <Novelty>
    Introduce Keycloak + OpenLDAP en la infraestructura de desarrollo, un módulo
    de auth en el BFF con OIDC ROPC y validación JWKS, y la primera pantalla
    pre-login de la app móvil. Es la primera vez que el proyecto tiene un flujo
    de autenticación real (no hardcodeado).
  </Novelty>
  <Substitutes>
    Alternativa descartada: BFF llama directo al AD y emite JWT propio. Rechazada
    porque acopla el BFF a un protocolo de autenticación específico y requiere
    gestionar secretos JWT. Con Keycloak, el BFF solo valida tokens estándar.
    Alternativa descartada: OAuth2 con Azure AD directamente. Rechazada porque
    la empresa usa AD on-premises, no Azure AD.
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: OpenLDAP simulado con usuarios AD precargados `[Must]`

> Como **desarrollador**, quiero **un contenedor OpenLDAP con usuarios simulados que repliquen el contrato del AD real**, para que **pueda desarrollar y testear el login sin depender del AD corporativo**.

**Criterios de aceptación:**
- [ ] Contenedor `openldap` en `docker-compose.yml` con imagen `osixia/openldap:latest`.
- [ ] 10 usuarios precargados vía `.ldif` con atributos: `uid` (RUT), `cn` (displayName), `sn`, `givenName`, `userPassword`, `employeeType` (jobTitle), `departmentNumber` (department), `carLicense` (storeId), y un atributo booleano para `accountEnabled`.
- [ ] Al menos 1 usuario con `accountEnabled: false` para testear el caso de cuenta deshabilitada.
- [ ] `make infra` levanta OpenLDAP junto con el resto de la infraestructura.
- [ ] Se puede consultar un usuario con `ldapsearch -x -H ldap://localhost:389 -b "dc=opensupervisor,dc=local" "(uid=12345678-9)"`.

**Notas:** El `.ldif` se versiona en `.docker/openldap/bootstrap.ldif`. La estructura DIT es `dc=opensupervisor,dc=local` con `ou=users` para los usuarios. Las contraseñas se hashean con SSHA. El puerto 389 se expone solo en localhost.

---

### US-02: Keycloak con realm, client y LDAP federation `[Must]`

> Como **desarrollador**, quiero **un contenedor Keycloak preconfigurado con realm `open-supervisor`, client `bff` y federación LDAP hacia OpenLDAP**, para que **el flujo de login OIDC funcione sin configuración manual**.

**Criterios de aceptación:**
- [ ] Contenedor `keycloak` en `docker-compose.yml` con imagen `quay.io/keycloak/keycloak:26`.
- [ ] Keycloak arranca con `start --import-realm` y carga `realm-export.json` desde un volume.
- [ ] Realm `open-supervisor` con client `bff` (confidencial, ROPC/Direct Access Grants habilitado).
- [ ] LDAP user federation configurada apuntando a `ldap://openldap:389` con bind DN y credenciales.
- [ ] Mapeo de atributos LDAP → claims JWT: `uid` → `preferred_username`, `carLicense` → `storeId`, `cn` → `displayName`, `employeeType` → `jobTitle`, `departmentNumber` → `department`.
- [ ] `make infra` levanta Keycloak y está listo para aceptar ROPC requests en <30s después del arranque.
- [ ] Healthcheck de Keycloak en docker-compose verifica que el realm está cargado.

**Notas:** El `realm-export.json` se versiona en `.docker/keycloak/realm-export.json`. No se usa el Admin REST API para configurar — todo está en el JSON de import. El client secret del client `bff` es fijo y conocido (para desarrollo).

---

### US-03: Endpoint `POST /auth/login` en BFF con OIDC ROPC `[Must]`

> Como **app móvil**, quiero **enviar RUT y contraseña a `POST /auth/login` y recibir un access_token de Keycloak**, para que **el supervisor pueda autenticarse con sus credenciales corporativas**.

**Criterios de aceptación:**
- [ ] `POST /auth/login` recibe body `{ employeeId: string, password: string }` validado con DTO.
- [ ] El BFF hace ROPC grant a Keycloak: `POST {KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/token` con `grant_type=password`, `client_id`, `client_secret`, `username`, `password`.
- [ ] Si Keycloak responde 200, el BFF extrae `access_token`, `refresh_token`, `expires_in` y los retorna con HTTP 200.
- [ ] Si Keycloak responde 401 (invalid_grant), el BFF retorna HTTP 401 con `{ message: "Credenciales inválidas" }`.
- [ ] Si Keycloak responde 403 (account disabled), el BFF retorna HTTP 403 con `{ message: "Cuenta deshabilitada" }`.
- [ ] Si Keycloak no responde (timeout/5xx), el BFF retorna HTTP 503 con `{ message: "Servicio de autenticación no disponible" }`.

**Notas:** El BFF no emite tokens — solo actúa como proxy OIDC. La lógica sigue el patrón hexagonal: port `IAuthenticationPort.authenticate(employeeId, password): Promise<AuthResult>`, adapter `KeycloakAuthenticationAdapter` con `HttpService`. Variables de entorno: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`.

---

### US-04: Pantalla de login en la app móvil `[Must]`

> Como **supervisor**, quiero **ver una pantalla de login donde ingresar mi RUT y contraseña**, para que **pueda autenticarme antes de acceder a las solicitudes**.

**Criterios de aceptación:**
- [ ] La app muestra `LoginScreen` con campos: "RUT" y "Contraseña" (input seguro), y botón "Ingresar".
- [ ] Al presionar "Ingresar", se llama a `bffClient.post('/auth/login', { employeeId, password })`.
- [ ] Campos vacíos → mensaje de validación "RUT y contraseña son obligatorios" sin llamar al BFF.
- [ ] `isLoading=true` → botón deshabilitado con `ButtonSpinner`.
- [ ] Login exitoso → almacenar `access_token` + `refresh_token` en AsyncStorage, navegar a pantalla principal.
- [ ] Login fallido (401/403) → mostrar mensaje de error debajo del botón, campos editables.
- [ ] Login fallido (503/red) → mostrar "Servicio no disponible. Intente más tarde."

**Notas:** La pantalla usa `@gluestack-ui/themed`. El hook `useLogin` encapsula la llamada al BFF y el estado. Se instala `@react-native-async-storage/async-storage`.

---

### US-05: SessionContext con datos reales del token Keycloak `[Must]`

> Como **app móvil**, quiero **que el SessionContext se alimente con los claims del JWT de Keycloak**, para que **los requests subsiguientes usen la identidad real del supervisor**.

**Criterios de aceptación:**
- [ ] `SessionContext` expone `storeId`, `supervisorId` (sub del JWT), `displayName` y `isAuthenticated`.
- [ ] Al iniciar la app, si existe `access_token` en AsyncStorage, se decodifica con `jwt-decode` y se inyecta en el contexto.
- [ ] Si no existe token, `isAuthenticated=false` → se muestra `LoginScreen`.
- [ ] Si el token expiró (verificado con `exp`), se limpia AsyncStorage y se muestra `LoginScreen`.
- [ ] `useSSERequests` y `useDecision` leen `supervisorId` del contexto (ya no hardcodeado).
- [ ] `bffClient` agrega header `Authorization: Bearer <access_token>` a todos los requests.

**Notas:** `jwt-decode` solo decodifica (no verifica firma). El `SessionProvider` se vuelve asíncrono con estado `isInitializing` para splash mientras carga AsyncStorage.

---

### US-06: Guard JWT en BFF validando tokens Keycloak (JWKS) `[Should]`

> Como **BFF**, quiero **validar el access_token de Keycloak en cada request a endpoints protegidos**, para que **solo supervisores autenticados accedan a las solicitudes**.

**Criterios de aceptación:**
- [ ] `JwtAuthGuard` extrae el token del header `Authorization: Bearer <token>`.
- [ ] Valida la firma del token usando la JWKS de Keycloak (`/realms/{REALM}/protocol/openid-connect/certs`).
- [ ] Verifica que el token no haya expirado (`exp`) y que el issuer sea Keycloak (`iss`).
- [ ] Si el token es inválido/ausente/expirado → HTTP 401.
- [ ] `StoreOwnershipGuard`: verifica que `storeId` del token coincida con `:storeId` de la URL → si no, HTTP 403.
- [ ] `@CurrentUser()` decorator extrae claims del token para uso del controller.

**Notas:** Se usa `passport-jwt` con `jwks-rsa`. `JwtAuthGuard` se aplica globalmente excepto en `/auth/login` (público vía `@Public()` decorator).

---

### US-07: Pantalla de selección de tienda post-login `[Should]`

> Como **supervisor** cuyo AD no tiene `storeId` asignado, quiero **seleccionar la tienda que estoy supervisando después de autenticarme**, para que **pueda acceder a las solicitudes aunque mi perfil AD no tenga tienda configurada**.

**Criterios de aceptación:**
- [ ] Si login exitoso pero JWT no contiene claim `storeId`, la app muestra `StoreSelectionScreen`.
- [ ] La pantalla obtiene listado de tiendas de `GET /stores` (nuevo endpoint en BFF).
- [ ] Al seleccionar una tienda, se persiste el `storeId` en AsyncStorage y se completa el `SessionContext`.
- [ ] El `GET /stores` retorna `{ storeId: string, name: string }[]`.

**Notas:** `Should` porque el AD simulado siempre incluye `storeId`. El endpoint `GET /stores` puede empezar con mock estático.

---

### US-08: Renovación silenciosa de token (refresh token) `[Could]`

> Como **supervisor**, quiero **que mi sesión se mantenga activa sin tener que volver a ingresar mis credenciales**, para que **no se interrumpa mi trabajo durante el turno**.

**Criterios de aceptación:**
- [ ] Cuando el `access_token` está por expirar (últimos 5 min), la app usa el `refresh_token` para obtener uno nuevo.
- [ ] La renovación se hace en background (sin UI de carga).
- [ ] Si el refresh falla, se redirige a `LoginScreen`.
- [ ] Nuevos tokens se persisten en AsyncStorage.

**Notas:** `useTokenRefresh` se monta en `SessionProvider` con `setInterval`. El endpoint de refresh es el mismo de Keycloak con `grant_type=refresh_token`.

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|-----|-----------|-----------------|
| US-01 | — | sí (capa 1) |
| US-02 | US-01 | no (capa 2 — necesita LDAP corriendo para verificar federación) |
| US-03 | US-02 | sí dentro de capa 3 |
| US-06 | US-02 | sí dentro de capa 3 |
| US-04 | US-03 | no (capa 4) |
| US-05 | US-04 | no (capa 5) |
| US-07 | US-03 | sí dentro de capa 4 |
| US-08 | US-03 | sí dentro de capa 4 |

---

## Escenarios BDD

~~~gherkin
Feature: Autenticación OIDC vía Keycloak federado a AD simulado — US-03
  Como app móvil
  Quiero enviar RUT y contraseña y recibir un token de Keycloak
  Para que el supervisor pueda autenticarse con su cuenta corporativa

  Background:
    Given Keycloak está corriendo con realm "open-supervisor" y client "bff"
    And Keycloak está federado con OpenLDAP (dc=opensupervisor,dc=local)

  Scenario: Credenciales válidas — login exitoso con token Keycloak
    Given OpenLDAP tiene usuario uid="12345678-9" con password "correcta"
    When BFF envía ROPC grant a Keycloak con username="12345678-9" password="correcta"
    Then Keycloak valida contra LDAP y retorna access_token + refresh_token
    And el access_token contiene claims: sub, preferred_username, storeId, displayName, jobTitle, department
    And BFF retorna 200 con { access_token, refresh_token, expires_in }

  Scenario: Contraseña incorrecta — 401
    Given OpenLDAP tiene usuario uid="12345678-9"
    When BFF envía ROPC grant con password="incorrecta"
    Then Keycloak retorna 401 con error "invalid_grant"
    And BFF retorna 401 con { message: "Credenciales inválidas" }

  Scenario: Cuenta deshabilitada — 403
    Given OpenLDAP tiene usuario uid="99999999-0" con cuenta deshabilitada
    When BFF envía ROPC grant con credenciales correctas
    Then Keycloak rechaza por account disabled
    And BFF retorna 403 con { message: "Cuenta deshabilitada" }

  Scenario: Keycloak no disponible — 503
    Given Keycloak está caído
    When BFF intenta ROPC grant
    Then BFF retorna 503 con { message: "Servicio de autenticación no disponible" }
~~~

~~~gherkin
Feature: Pantalla de login en la app móvil — US-04
  Como supervisor
  Quiero ver una pantalla para ingresar mis credenciales
  Para autenticarme y acceder a las solicitudes

  Scenario: Login exitoso navega a la pantalla principal
    Given la app muestra LoginScreen
    When ingreso RUT "12345678-9" y contraseña "correcta"
    And presiono "Ingresar"
    Then el botón muestra spinner y se deshabilita
    And la app llama a POST /auth/login con las credenciales
    And el BFF responde 200 con tokens
    And los tokens se persisten en AsyncStorage
    And la app navega a la pantalla de listado de solicitudes

  Scenario: Campos vacíos — validación local
    Given la app muestra LoginScreen
    When presiono "Ingresar" sin llenar los campos
    Then la app muestra "RUT y contraseña son obligatorios"
    And no se llama al BFF

  Scenario: Credenciales inválidas — muestra error
    Given la app muestra LoginScreen
    When ingreso credenciales incorrectas y presiono "Ingresar"
    Then el BFF responde 401
    And la app muestra "Credenciales inválidas" debajo del botón

  Scenario: Servicio no disponible — muestra error genérico
    Given la app muestra LoginScreen
    When ingreso credenciales y el BFF responde 503
    Then la app muestra "Servicio no disponible. Intente más tarde."
~~~

~~~gherkin
Feature: Sesión persistente — US-05
  Como supervisor
  Quiero que la app recuerde mi sesión
  Para no hacer login cada vez que abro la app

  Scenario: Token válido al iniciar — va directo al listado
    Given existe un access_token válido en AsyncStorage
    When abro la app
    Then la app decodifica el token
    And inyecta storeId, supervisorId y displayName en SessionContext
    And muestra directamente la pantalla de listado

  Scenario: Sin token — redirige a login
    Given no existe token en AsyncStorage
    When abro la app
    Then la app muestra LoginScreen

  Scenario: Token expirado — redirige a login
    Given existe un access_token expirado en AsyncStorage
    When abro la app
    Then la app detecta expiración
    And limpia AsyncStorage
    And muestra LoginScreen
~~~

~~~gherkin
Feature: Endpoints protegidos con JWT — US-06
  Como BFF
  Quiero rechazar requests sin token válido de Keycloak
  Para que solo supervisores autenticados accedan a datos sensibles

  Scenario: Request sin token — 401
    Given un request a GET /authorization/store/s1/pending sin header Authorization
    When el JwtAuthGuard procesa el request
    Then retorna 401

  Scenario: Token de otro store — 403
    Given un request a GET /authorization/store/s1/pending
    And el token JWT tiene claim storeId="s2"
    When el StoreOwnershipGuard procesa el request
    Then retorna 403
~~~

---

## Plan de Tests TDD

### US-01 — OpenLDAP simulado

**Integración**
- [ ] [RED]   `ldapsearch` contra `localhost:389` retorna los 10 usuarios del `.ldif`.
- [ ] [GREEN] Contenedor OpenLDAP corriendo con `.ldif` cargado.
- [ ] [RED]   Usuario "99999999-0" tiene atributo `accountEnabled: false`.
- [ ] [GREEN] Verificar en el `.ldif` que al menos un usuario tiene cuenta deshabilitada.

---

### US-02 — Keycloak con realm y LDAP federation

**Integración**
- [ ] [RED]   `curl` ROPC grant a Keycloak con credenciales de un usuario LDAP → 200 con access_token.
- [ ] [GREEN] Keycloak corriendo con realm importado y LDAP federation activa.
- [ ] [RED]   Token decodificado contiene claims `storeId`, `displayName`, `jobTitle`, `department`.
- [ ] [GREEN] Mapeo de atributos LDAP configurado en `realm-export.json`.
- [ ] [RED]   Usuario con `accountEnabled: false` → ROPC grant retorna 401.
- [ ] [GREEN] Keycloak respeta account status del LDAP.

---

### US-03 — Endpoint `POST /auth/login` en BFF

**Unitarios**
- [ ] [RED]   `AuthService.login(employeeId, password)`: llama al port `IAuthenticationPort.authenticate(employeeId, password)`.
- [ ] [GREEN] Implementar `AuthService` que delega en el port.
- [ ] [RED]   `AuthService.login`: si el port retorna `AuthResult` exitoso, retorna `{ access_token, refresh_token, expires_in }`.
- [ ] [GREEN] Mapeo de `AuthResult` a DTO de respuesta.
- [ ] [RED]   `AuthService.login`: si el port lanza `InvalidCredentialsException`, se mapea a HTTP 401.
- [ ] [GREEN] Try/catch con mapeo de excepciones de dominio a HTTP.
- [ ] [RED]   `AuthService.login`: si el port lanza `AccountDisabledException`, se mapea a HTTP 403.
- [ ] [GREEN] Rama de account disabled.
- [ ] [RED]   `AuthService.login`: si el port lanza `AuthenticationUnavailableException`, se mapea a HTTP 503.
- [ ] [GREEN] Rama de infraestructura caída.

**Integración**
- [ ] `KeycloakAuthenticationAdapter`: POST a Keycloak token endpoint con ROPC → mapea respuesta a `AuthResult`.
- [ ] `KeycloakAuthenticationAdapter`: Keycloak responde 401 invalid_grant → lanza `InvalidCredentialsException`.
- [ ] `KeycloakAuthenticationAdapter`: timeout/5xx → lanza `AuthenticationUnavailableException`.

**E2E**
- [ ] `POST /auth/login` con credenciales válidas → 200 + tokens.
- [ ] `POST /auth/login` con credenciales inválidas → 401.

---

### US-04 — Pantalla de login en app móvil

**Unitarios**
- [ ] [RED]   `LoginScreen`: renderiza campos RUT, contraseña y botón Ingresar.
- [ ] [GREEN] Componente con Gluestack UI.
- [ ] [RED]   `LoginScreen`: campos vacíos + presionar Ingresar → mensaje de validación.
- [ ] [GREEN] Validación local antes de llamar al hook.
- [ ] [RED]   `useLogin`: estado `isLoading=true` durante la request.
- [ ] [GREEN] Hook con estado de carga.
- [ ] [RED]   `useLogin`: login exitoso → almacena tokens en AsyncStorage.
- [ ] [GREEN] Persistencia post-login.
- [ ] [RED]   `useLogin`: error 401 → `error` = "Credenciales inválidas".
- [ ] [GREEN] Mapeo de códigos HTTP a mensajes.
- [ ] [RED]   `LoginScreen`: botón deshabilitado + spinner cuando `isLoading=true`.
- [ ] [GREEN] UI de carga en botón.

**Edge cases**
- [ ] Doble tap rápido → solo una request enviada.
- [ ] Error de red → mensaje "Error de conexión".

---

### US-05 — SessionContext con token Keycloak

**Unitarios**
- [ ] [RED]   `SessionProvider`: al montar con token en AsyncStorage, decodifica y setea `storeId`, `supervisorId`, `displayName`, `isAuthenticated=true`.
- [ ] [GREEN] Inicialización asíncrona del provider.
- [ ] [RED]   `SessionProvider`: sin token → `isAuthenticated=false`.
- [ ] [GREEN] Estado no autenticado.
- [ ] [RED]   `useDecision`: envía `supervisor_id` del contexto en el body.
- [ ] [GREEN] Hook lee del contexto real.

---

### US-06 — Guard JWT en BFF

**Unitarios**
- [ ] [RED]   `JwtAuthGuard`: request sin header Authorization → 401.
- [ ] [GREEN] Guard que verifica presencia del header.
- [ ] [RED]   `JwtAuthGuard`: token con firma inválida → 401.
- [ ] [GREEN] Validación con `jwks-rsa` contra Keycloak.
- [ ] [RED]   `StoreOwnershipGuard`: token storeId ≠ URL storeId → 403.
- [ ] [GREEN] Comparación de claims con params.
- [ ] [RED]   `@CurrentUser()` decorator: inyecta claims en el request.
- [ ] [GREEN] Decorator paramétrico.

**E2E**
- [ ] `GET /authorization/store/s1/pending` sin token → 401.
- [ ] `GET /authorization/store/s1/pending` con token de store "s2" → 403.

---

## Definition of Done

- [ ] Todos los escenarios BDD pasan en CI
- [ ] Cobertura de tests unitarios ≥ 80%
- [ ] `make infra` levanta OpenLDAP + Keycloak con realm listo para ROPC
- [ ] `POST /auth/login` del BFF funciona contra Keycloak local
- [ ] App móvil carga sin pantalla roja post-login en emulador Android
- [ ] Flujo E2E completo: login → listado → detalle → decisión (con `supervisor_id` real del token)
- [ ] `SessionContext` no contiene valores hardcodeados
- [ ] Endpoints del BFF rechazan requests sin token (401) o con storeId incorrecto (403)
- [ ] `.docker/keycloak/realm-export.json` y `.docker/openldap/bootstrap.ldif` versionados
- [ ] Variables de entorno documentadas en `.env.example` de BFF y root

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | `osixia/openldap` y `quay.io/keycloak/keycloak:26` — imágenes de contenedores públicas |
| Dependencia externa | `@react-native-async-storage/async-storage` + `jwt-decode` (mobile) |
| Dependencia externa | `@nestjs/jwt`, `passport`, `passport-jwt`, `jwks-rsa` (BFF) |
| Riesgo técnico | Keycloak 26 puede tener breaking changes en el formato de `realm-export.json` |
| Riesgo técnico | El `realm-export.json` incluye secrets. En prod se debe rotar y no versionar el secreto real |
| Riesgo técnico | ROPC está deprecated en OAuth 2.1. Si Keycloak lo remueve, migrar a Auth Code + PKCE |
| Suposición a validar | OpenLDAP con esquema custom es suficiente para simular el AD real |
| Suposición a validar | El AD real en producción también se accede vía LDAP(S) |
| Suposición a validar | Los supervisores conocen su RUT y contraseña corporativa |

---

## Resultado

**Fecha de finalización:** 2026-06-06

### Implementado

- [x] **US-01:** OpenLDAP simulado con 10 usuarios — `.docker/openldap/bootstrap.ldif` + contenedor en `docker-compose.yml`
- [x] **US-02:** Keycloak con realm `open-supervisor`, client `bff`, LDAP federation — `.docker/keycloak/realm-export.json` + contenedor
- [x] **US-03:** `POST /auth/login` en BFF con OIDC ROPC — módulo `auth/` con `KeycloakAuthenticationAdapter`, `AuthService`, `AuthController`
- [x] **US-04:** Pantalla de login en app móvil — `LoginScreen.tsx` + hook `useLogin.ts`
- [x] **US-05:** `SessionContext` con token Keycloak real — decodificación JWT, persistencia AsyncStorage, `bffClient` con header `Authorization`

### No implementado / Desviaciones

- **US-06** (Guard JWT en BFF): Diferido como `[Should]`. El endpoint `/auth/login` funciona sin guard; los endpoints existentes (`authorization/*`, `stream/*`) no requieren auth aún.
- **US-07** (Selección de tienda): Diferido como `[Should]`. El AD simulado siempre incluye `storeId`.
- **US-08** (Renovación de token): Diferido como `[Could]`.
- La infraestructura (OpenLDAP + Keycloak) está definida en `docker-compose.yml` y lista para ser levantada con `make infra`, pero no fue probada end-to-end con contenedores corriendo.

### Tests

- **BFF auth module:** 3 suites, 20 tests — unitarios de `AuthService`, `KeycloakAuthenticationAdapter`, `AuthController`
- **Mobile:** `App.test.tsx` adaptado para mock de sesión autenticada
- **Suite completa monorepo:** 21 suites, 182 tests, 0 fallos
- **Typecheck:** 6/6 proyectos OK
