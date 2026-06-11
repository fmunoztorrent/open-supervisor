/**
 * 01-login.test.ts — Suite E2E: Login del supervisor (US-03)
 *
 * Cubre:
 *   1. Happy path: credenciales válidas → app-safe-area visible
 *   2. Credenciales inválidas → login-error visible
 *   3. Login exitoso + lista vacía → empty-list-text visible
 *
 * FASE RED — Razones por las que estos tests DEBEN fallar:
 *   1. `import { device, element, by, waitFor, expect as detoxExpect } from 'detox'`
 *      lanzará MODULE_NOT_FOUND porque Detox no está instalado en apps/mobile.
 *   2. El testID 'empty-list-text' no existe en AuthorizationList.tsx
 *      (el Text "Sin solicitudes pendientes" no tiene testID aún).
 *   3. Las dependencias del mock server (express, jsonwebtoken) tampoco están instaladas.
 */

import { device, element, by, waitFor, expect as detoxExpect } from 'detox';
import { startServer, stopServer } from './mock-server/index';
import { resetMockServer, seedPendingRequests } from './setup/testHelpers';

const TIMEOUT_LOGIN = 15000;
const TIMEOUT_NAVIGATION = 5000;

describe('US-03 — Login del supervisor', () => {
  beforeAll(async () => {
    // El mock server se inicia UNA VEZ para toda la suite.
    // Detox ya garantizó que el emulador está corriendo antes de llegar acá.
    await startServer(3001);
  });

  afterAll(async () => {
    await stopServer();
  });

  beforeEach(async () => {
    // Reset del estado del servidor y app nueva por cada test.
    await resetMockServer();
    // Deshabilitar network idle sync para evitar que el SSE bloquee Detox
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxURLBlacklistRegex: '.*' },
    });
  });

  it('login exitoso — app-safe-area visible tras credenciales válidas', async () => {
    // El mock server tiene lista vacía por defecto (reset en beforeEach)
    await waitFor(element(by.id('rut-input')))
      .toBeVisible()
      .withTimeout(TIMEOUT_LOGIN);

    await element(by.id('rut-input')).replaceText('e2e-supervisor');
    await element(by.id('password-input')).replaceText('test1234');
    await element(by.id('password-input')).tapReturnKey();

    // La pantalla de lista debe aparecer dentro de 15s
    // New Architecture Fabric: toExist() en vez de toBeVisible() por el umbral 75%
    await waitFor(element(by.id('app-safe-area')))
      .toExist()
      .withTimeout(TIMEOUT_LOGIN);

    // El LoginScreen ya no debe ser visible
    await detoxExpect(element(by.id('rut-input'))).not.toExist();
  });

  it('credenciales inválidas — login-error visible', async () => {
    await waitFor(element(by.id('rut-input')))
      .toBeVisible()
      .withTimeout(TIMEOUT_LOGIN);

    await element(by.id('rut-input')).replaceText('supervisor-invalido');
    await element(by.id('password-input')).replaceText('wrongpass');
    await element(by.id('password-input')).tapReturnKey();

    // El error debe mostrarse después
    await waitFor(element(by.id('login-error')))
      .toExist()
      .withTimeout(TIMEOUT_LOGIN);

    // El usuario sigue en la pantalla de login
    await detoxExpect(element(by.id('rut-input'))).toExist();
  });

  it('login exitoso con lista vacía — empty-list-text visible', async () => {
    // Lista vacía ya está garantizada por resetMockServer en beforeEach
    await seedPendingRequests([]);

    await waitFor(element(by.id('rut-input')))
      .toBeVisible()
      .withTimeout(TIMEOUT_LOGIN);

    await element(by.id('rut-input')).replaceText('e2e-supervisor');
    await element(by.id('password-input')).replaceText('test1234');
    await element(by.id('password-input')).tapReturnKey();

    // Esperar que la lista cargue (app-safe-area existe = login exitoso)
    await waitFor(element(by.id('app-safe-area')))
      .toExist()
      .withTimeout(TIMEOUT_LOGIN);

    // Esperar que el spinner de carga desaparezca
    // Fabric: 'not.toBeVisible' puede fallar — usar 'not.toExist' que verifica
    // que el nodo fue removido del árbol de render (Spinner condicional).
    await waitFor(element(by.id('list-spinner')))
      .not.toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    // empty-list-text debería ser visible
    await waitFor(element(by.id('empty-list-text')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);
  });
});
