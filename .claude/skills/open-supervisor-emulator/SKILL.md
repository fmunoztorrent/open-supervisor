---
name: open-supervisor-emulator
description: Experto en validar la app Android de open-supervisor desde terminal usando adb, UIAutomator y Kafka. TRIGGER cuando el usuario menciona: emulador, adb, Android, app, screenshot, captura de pantalla, UIAutomator, taps, botones, Autorizar, Rechazar, port forwarding, adb reverse, com.opensupervisor, AVD, open_supervisor, validar app, verificar app, pantalla, flujo completo, pipeline completo, SSE en app, resolver solicitud, solicitud en app, open-supervisor-emulator.
---

# open-supervisor-emulator

Manual de referencia para validar el comportamiento completo de la app Android de open-supervisor directamente desde terminal. Cubre arranque, port forwarding, UIAutomator, screenshots, validación API y verificación Kafka.

> **Agnóstico de máquina:** este skill **no asume rutas absolutas** ni el serial fijo del emulador. La raíz del repo se obtiene de `git`, el serial del dispositivo se resuelve dinámicamente con `adb devices`, y el AVD `open_supervisor` lo crea `setup-android.sh` (Pixel 8 API 35). Funciona para cualquier desarrollador que clone el proyecto. Para levantar contenedores y servicios backend, ver el skill hermano **`open-supervisor-infra`**.

**Filosofía:** La validación terminal-first es más reproducible que clicks manuales. UIAutomator da coordenadas exactas de los bounds reales — las coordenadas de screenshots escalados NO son confiables para taps. La validación de API via `curl` es el fallback cuando los taps de adb son poco fiables.

---

## Bootstrap (portable — correr una vez por sesión)

```bash
# Raíz del repo (funciona desde cualquier subdirectorio)
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Nombre del AVD: lo crea setup-android.sh; override con la env var AVD_NAME si difiere
AVD_NAME="${AVD_NAME:-open_supervisor}"

# Serial del emulador: NO asumir emulator-5554 — resolverlo dinámicamente
DEVICE="$(adb devices | awk '/emulator-[0-9]+[[:space:]]+device/{print $1; exit}')"
ADB="adb${DEVICE:+ -s $DEVICE}"   # 'adb -s emulator-XXXX' si hay device; 'adb' si aún no

# Verificación rápida
echo "REPO_ROOT=$REPO_ROOT  AVD_NAME=$AVD_NAME  DEVICE=${DEVICE:-<sin emulador>}"
```

**Notas:**
- Usar `$ADB ...` en lugar de `adb ...` para apuntar siempre al emulador correcto (soporta múltiples dispositivos).
- Si `$DEVICE` queda vacío → no hay emulador conectado; ejecutar **[setup]**.
- Los pasos que tocan Kafka/contenedores reutilizan el motor del skill `open-supervisor-infra` (variables `$COMPOSE` / `$ENGINE`). Correr también su bloque de Bootstrap si vas a verificar mensajes en Kafka.

---

## Routing

Parsea `$ARGUMENTS`:

| Argumento | Acción |
|---|---|
| `status` o vacío | **[status]** — estado del emulador y la app |
| `setup` | **[setup]** — configurar port forwarding y lanzar app |
| `screenshot` | **[screenshot]** — capturar pantalla actual |
| `tap <elemento>` | **[tap]** — tocar un elemento por nombre |
| `validate` | **[validate]** — flujo completo de validación end-to-end |
| `resolve <correlationId> <APPROVE\|REJECT>` | **[resolve]** — resolver solicitud via API |
| `inspect` | **[inspect]** — dump UIAutomator y parsear elementos |
| `restart` | **[restart]** — forzar cierre y relanzar la app |

---

## Referencia rápida

| Dato | Valor |
|---|---|
| Package | `com.opensupervisor` |
| Activity principal | `com.opensupervisor/.MainActivity` |
| AVD name | `$AVD_NAME` (default `open_supervisor`, creado por `setup-android.sh`) |
| Device ID | `$DEVICE` (resuelto con `adb devices`; típicamente `emulator-5554`) |
| Puertos BFF / auth / SSE | 3000, 3001, 3002 |

---

## [status] — Estado del emulador y la app

> Requiere el **Bootstrap** ejecutado (`$ADB`).

### Verificar emulador conectado

```bash
adb devices
```

Salida esperada: una línea `emulator-XXXX   device`. Si no aparece → ejecutar **[setup]** (y re-correr el Bootstrap para fijar `$DEVICE`).

### Verificar port forwarding activo

```bash
$ADB reverse --list
```

Salida esperada:
```
(reverse) tcp:3000 tcp:3000
(reverse) tcp:3001 tcp:3001
(reverse) tcp:3002 tcp:3002
```

Si falta alguno → ejecutar **[setup]** paso de port forwarding.

### Verificar app en foreground

```bash
$ADB shell dumpsys window windows | grep -i "mCurrentFocus"
```

Debe mostrar `com.opensupervisor/.MainActivity`.

---

## [setup] — Configurar port forwarding y lanzar app

### Paso 1 — Verificar emulador

```bash
adb devices
```

Si no hay emulador conectado:
```bash
emulator -list-avds            # debe mostrar: open_supervisor (o tu $AVD_NAME)
emulator -avd "$AVD_NAME" &
# Esperar hasta que 'adb devices' muestre: emulator-XXXX   device
# Luego re-correr el Bootstrap para fijar $DEVICE y $ADB
```

> Si el AVD no existe, correr `setup-android.sh` en la raíz del repo (lo crea como Pixel 8 API 35).

### Paso 2 — Port forwarding (CRÍTICO)

Sin este paso, `localhost:3000` dentro del emulador no alcanza el BFF en el host.

```bash
$ADB reverse tcp:3000 tcp:3000 && \
$ADB reverse tcp:3001 tcp:3001 && \
$ADB reverse tcp:3002 tcp:3002
```

Verificar: `$ADB reverse --list`

**IMPORTANTE:** El port forwarding se pierde si el emulador se reinicia. Siempre verificarlo antes de cualquier prueba.

### Paso 3 — Lanzar la app

```bash
$ADB shell am start -n com.opensupervisor/.MainActivity
```

Esperar 2-3s y tomar screenshot para confirmar carga.

---

## [screenshot] — Capturar pantalla

```bash
$ADB shell screencap -p /sdcard/sc.png && \
$ADB pull /sdcard/sc.png /tmp/sc.png
```

**ADVERTENCIA CRÍTICA:** Las coordenadas visibles en el screenshot NO corresponden a las coordenadas de tap. La imagen puede estar escalada por la herramienta de visualización. **Siempre usar UIAutomator para obtener bounds reales antes de hacer taps.**

---

## [tap] — Tocar un elemento por nombre

### Paso 1 — Obtener bounds reales vía UIAutomator (obligatorio)

```bash
$ADB shell uiautomator dump /sdcard/ui.xml && \
$ADB pull /sdcard/ui.xml /tmp/ui.xml
```

### Paso 2 — Parsear elementos por content-desc

```bash
python3 -c "
import xml.etree.ElementTree as ET
tree = ET.parse('/tmp/ui.xml')
targets = ['Autorizar', 'Rechazar', 'Volver']
for n in tree.iter():
    if n.get('content-desc') in targets:
        print(n.get('content-desc'), n.get('bounds'))
"
```

Valores típicos estables en el AVD `open_supervisor` (Pixel 8, 1080x2400):

| Botón | Bounds | Center |
|---|---|---|
| Autorizar | `[42,694][524,799]` | **(283, 746)** |
| Rechazar | `[556,694][1038,799]` | **(797, 746)** |
| Volver | `[42,36][210,93]` | **(126, 64)** |

> Estos bounds aplican al AVD por defecto del proyecto. En otro tamaño de pantalla cambiarán — por eso el dump UIAutomator es obligatorio.

### Paso 3 — Calcular centro

Para bounds `[x1,y1][x2,y2]`: center = `((x1+x2)/2, (y1+y2)/2)`

### Paso 4 — Ejecutar tap

```bash
$ADB shell input tap 283 746   # Autorizar
$ADB shell input tap 797 746   # Rechazar
```

**NEVER:** `$ADB shell input keyevent KEYCODE_BACK` — sale de la app (no hay BackHandler configurado). Ver L-2.

---

## [validate] — Flujo completo de validación end-to-end

Confirma que el pipeline POS → Kafka → authorization-service → Redis → SSE → BFF → app → resolución → Kafka response funciona de extremo a extremo.

> Requiere el **Bootstrap** de este skill **y** el del skill `open-supervisor-infra` (para `$COMPOSE` / `$REPO_ROOT`).

### Paso 1 — Verificar precondiciones

- Contenedores corriendo: `cd "$REPO_ROOT" && $COMPOSE ps`
- Servicios en :3000, :3001, :3002: `lsof -i :3000 -i :3001 -i :3002 -P | grep LISTEN`
- Emulador conectado: `adb devices`
- Port forwarding activo: `$ADB reverse --list`

### Paso 2 — Estado inicial

```bash
curl -s http://localhost:3000/authorization/store/store-1/pending
```

Debe retornar `[]`. Tomar screenshot del estado visual de la app.

### Paso 3 — Inyectar solicitud

```bash
cd "$REPO_ROOT"
pnpm inject --type DISCOUNT --store-id store-1 --pos-id pos-test
```

Copiar el `correlation_id` del output.

### Paso 4 — Verificar llegada via SSE (3-4s)

```bash
sleep 4
$ADB shell screencap -p /sdcard/sc.png && $ADB pull /sdcard/sc.png /tmp/sc.png
```

La card debe aparecer al tope de la lista. Si no aparece → verificar banner "Reconectando..." y LAG de Kafka (ver skill `open-supervisor-infra`).

### Paso 5 — Navegar al detalle

```bash
# Tap en la primera card (coordenadas aproximadas de la primera fila)
$ADB shell input tap 540 157
sleep 2

# Verificar con screenshot que abrió el detalle
$ADB shell screencap -p /sdcard/sc_detail.png && $ADB pull /sdcard/sc_detail.png /tmp/sc_detail.png
```

### Paso 6A — Resolver desde la app

```bash
# Obtener bounds exactos
$ADB shell uiautomator dump /sdcard/ui.xml && $ADB pull /sdcard/ui.xml /tmp/ui.xml

# Tap en Autorizar o Rechazar
$ADB shell input tap 283 746   # Autorizar
# o
$ADB shell input tap 797 746   # Rechazar
```

### Paso 6B — Resolver via API (más fiable)

```bash
curl -s -X POST "http://localhost:3000/authorization/<correlationId>/resolve" \
  -H "Content-Type: application/json" \
  -d '{"decision":"APPROVE","supervisor_id":"supervisor-test"}'
```

Respuesta esperada: HTTP 201.

### Paso 7 — Verificar en Kafka

```bash
cd "$REPO_ROOT" && $COMPOSE exec -T kafka \
  kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic auth.response.store-1 \
  --from-beginning --max-messages 10 --timeout-ms 3000
```

Debe aparecer el mensaje con el `correlation_id` y el `status` final.

### Paso 8 — Verificar lista vacía

```bash
curl -s http://localhost:3000/authorization/store/store-1/pending
# Debe retornar: []
```

---

## [resolve] — Resolver solicitud via API

```bash
curl -s -X POST "http://localhost:3000/authorization/<correlationId>/resolve" \
  -H "Content-Type: application/json" \
  -d "{\"decision\":\"<APPROVE|REJECT>\",\"supervisor_id\":\"supervisor-test\"}" \
  -w "\nHTTP: %{http_code}\n"
```

**CRÍTICO:**
- Usar `correlationId` en la URL (el auth-service llama `findByCorrelationId()` internamente)
- Valores válidos de `decision`: `"APPROVE"` o `"REJECT"` — NO "APPROVED"/"REJECTED"
- Obtener el `correlationId` del GET /pending: campo `correlationId` en la respuesta

Respuesta exitosa: HTTP 201 + `{"id": "...", "status": "APPROVED", "resolvedBy": "...", "resolvedAt": "..."}`

Doble resolución: auth-service retorna 409 (el BFF lo surfacea como 500 — ver L-5).

---

## [inspect] — Dump UIAutomator completo

```bash
$ADB shell uiautomator dump /sdcard/ui.xml && \
$ADB pull /sdcard/ui.xml /tmp/ui.xml

python3 -c "
import xml.etree.ElementTree as ET
tree = ET.parse('/tmp/ui.xml')
for n in tree.iter():
    desc = n.get('content-desc', '')
    text = n.get('text', '')
    bounds = n.get('bounds', '')
    if desc or text:
        print(f'desc={repr(desc)} text={repr(text)} bounds={bounds}')
"
```

---

## [restart] — Forzar cierre y relanzar

```bash
$ADB shell am force-stop com.opensupervisor && \
sleep 1 && \
$ADB shell am start -n com.opensupervisor/.MainActivity
```

Esperar 2-3s. La app hace GET inicial de solicitudes pendientes al montar.

**Útil cuando:**
- La app está en estado inconsistente
- Items resueltos siguen apareciendo (el estado local no se refresca — ver L-3)
- El botón Volver no responde a taps de adb (ver L-2)

---

## Limitaciones y errores conocidos

### L-1: App corre desde JS bundleado — sin hot-reload

Cambios a `.tsx`/`.ts` no se reflejan sin reinstalar el APK:

```bash
cd "$REPO_ROOT/apps/mobile"
pnpm android   # requiere Metro corriendo y emulador activo
```

---

### L-2: Botón Volver no responde a taps de adb

**Causa:** Gesture responder del componente `TouchableOpacity` no activable con `adb input tap` desde el JS bundleado.

**NEVER:** `$ADB shell input keyevent KEYCODE_BACK` — cierra la app (no hay BackHandler).

**Workaround:**
```bash
$ADB shell am force-stop com.opensupervisor && \
sleep 1 && \
$ADB shell am start -n com.opensupervisor/.MainActivity
```

---

### L-3: Items resueltos permanecen en la lista

**Causa:** `useSSERequests` acumula items recibidos pero no los elimina al resolver. El estado persiste hasta el siguiente restart.

**Workaround:** Reiniciar la app con **[restart]**.

---

### L-4: SSE muestra "Reconectando..."

**Diagnóstico:**
1. Verificar BFF: `lsof -i :3000 -P | grep LISTEN`
2. Verificar port forwarding: `$ADB reverse --list`

**Solución:**
- Si el BFF no está corriendo → relanzarlo (ver skill `open-supervisor-infra`)
- Si el port forwarding se perdió → `$ADB reverse tcp:3000 tcp:3000` (y los demás)
- La app reconecta sola en ~5s

---

### L-5: Doble resolución retorna 500 desde BFF

**Causa (bug conocido H-1):** El BFF no mapea el 409 del auth-service y lo surfacea como 500.

El request ya estaba resuelto — el 500 es falso positivo del BFF. Verificar estado real con GET /pending o Kafka console.

---

### L-6: Coordenadas de screenshot no sirven para taps

**Causa:** El screenshot puede estar escalado. Los bounds del emulador (1080x2400) no corresponden a las coordenadas de la imagen visualizada.

**Solución:** Siempre UIAutomator dump para bounds reales.

---

## Checklist de validación completa

- [ ] `adb devices` → `emulator-XXXX   device`
- [ ] `$ADB reverse --list` → tres puertos activos
- [ ] `curl http://localhost:3000/authorization/store/store-1/pending` → `[]`
- [ ] Kafka LAG = 0 para `authorization-service-group` (ver skill `open-supervisor-infra`)
- [ ] Screenshot app → lista correcta
- [ ] Inyectar solicitud → card aparece en app en < 5s
- [ ] Resolver via app o API → HTTP 201
- [ ] `kafka-console-consumer --topic auth.response.store-1` → mensaje con status correcto

---

## Referencia de bounds UIAutomator (valores típicos — AVD open_supervisor, Pixel 8)

| Elemento | content-desc | Bounds | Center para tap |
|---|---|---|---|
| Botón Autorizar | `Autorizar` | `[42,694][524,799]` | **(283, 746)** |
| Botón Rechazar | `Rechazar` | `[556,694][1038,799]` | **(797, 746)** |
| Botón Volver | `Volver` | `[42,36][210,93]` | (126, 64) — poco fiable vía adb |

Pueden variar si el layout o el tamaño de pantalla cambia. Siempre verificar con **[inspect]** si hay dudas.
