/**
 * testHelpers.ts
 *
 * Helpers reutilizables para las suites Detox E2E de open-supervisor.
 * Encapsulan patrones repetidos: login, seed de datos, emisión SSE y reset.
 *
 * NOTA FASE RED: Este archivo fallará al importar 'detox' porque el paquete
 * no está instalado. Esa es la razón de fallo esperada en FASE RED.
 */

import { device, element, by, waitFor } from 'detox';

const MOCK_SERVER_BASE_URL = 'http://localhost:3001';
const E2E_EMPLOYEE_ID = 'e2e-supervisor';
const E2E_PASSWORD = 'test1234';

// Timeout constants — centralizados para modificarlos en un solo lugar
const TIMEOUT_LOGIN = 15000;
const TIMEOUT_NAVIGATION = 5000;

/**
 * Realiza el flujo de login completo con las credenciales E2E válidas.
 * Espera a que `app-safe-area` sea visible como señal de que el login fue exitoso
 * y la lista de solicitudes está renderizada.
 *
 * Pre-condición: la app debe estar lanzada (device.launchApp ya ejecutado).
 */
export async function loginAsE2ESupervisor(): Promise<void> {
  await waitFor(element(by.id('rut-input')))
    .toBeVisible()
    .withTimeout(TIMEOUT_LOGIN);

  await element(by.id('rut-input')).replaceText(E2E_EMPLOYEE_ID);
  await element(by.id('password-input')).replaceText(E2E_PASSWORD);
  // New Architecture Fabric: tapReturnKey() en password field activa onSubmitEditing
  await element(by.id('password-input')).tapReturnKey();

  await waitFor(element(by.id('app-safe-area')))
    .toExist()
    .withTimeout(TIMEOUT_LOGIN);
}

/**
 * Reemplaza las solicitudes pendientes del mock server con el array provisto.
 * Llama a POST /test/seed antes de que la app se lance para que el
 * GET /authorization/store/:storeId/pending devuelva los datos inyectados.
 */
export async function seedPendingRequests(requests: object[]): Promise<void> {
  const response = await fetch(`${MOCK_SERVER_BASE_URL}/test/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
  });

  if (!response.ok) {
    throw new Error(
      `[testHelpers] seedPendingRequests falló: ${response.status}`,
    );
  }
}

/**
 * Emite un evento SSE a todos los clientes conectados del store del request.
 * El hook useSSERequests en la app escucha exactamente el evento 'authorization_request'.
 *
 * Usar después de que la app esté autenticada y la conexión SSE esté activa.
 */
export async function emitSSERequest(request: object): Promise<void> {
  const response = await fetch(`${MOCK_SERVER_BASE_URL}/test/emit-sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(
      `[testHelpers] emitSSERequest falló: ${response.status}`,
    );
  }
}

/**
 * Vacía currentPending y cierra todas las conexiones SSE activas.
 * Llamar en beforeEach para garantizar estado limpio entre tests.
 */
export async function resetMockServer(): Promise<void> {
  const response = await fetch(`${MOCK_SERVER_BASE_URL}/test/reset`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(
      `[testHelpers] resetMockServer falló: ${response.status}`,
    );
  }
}
