/**
 * 03-decision.test.ts — Suite E2E: Decisión del supervisor (US-05)
 *
 * Cubre:
 *   1. Tap card-corr-1 → detail-type-header visible
 *   2. Tap authorize-button → approve-button-spinner visible → desaparece →
 *      back-button → card-corr-1 ya no visible en lista
 *   3. Tap reject-button (con corr-2) → mismo flujo → card-corr-2 desaparece
 *
 * FASE RED — Razones por las que estos tests DEBEN fallar:
 *   1. `import ... from 'detox'` → MODULE_NOT_FOUND (Detox no instalado).
 *   2. 'card-corr-1' y 'card-corr-2' no existen (testID dinámico no implementado).
 *   3. 'authorize-button' no existe: el Button Autorizar no tiene testID en
 *      AuthorizationDetailScreen.tsx (usa accessibilityLabel pero no testID).
 *   4. 'reject-button' no existe: misma razón.
 *   5. 'back-button' no existe: el Pressable ← Volver en App.tsx/DetailView
 *      no tiene testID todavía.
 */

import { device, element, by, waitFor, expect as detoxExpect } from 'detox';
import { startServer, stopServer } from './mock-server/index';
import {
  loginAsE2ESupervisor,
  seedPendingRequests,
  resetMockServer,
} from './setup/testHelpers';

const TIMEOUT_LOGIN = 15000;
const TIMEOUT_NAVIGATION = 5000;
const TIMEOUT_SPINNER = 5000;

const SEED_TWO_REQUESTS = [
  {
    correlation_id: 'corr-1',
    store_id: 'store-e2e',
    pos_id: 'pos-1',
    type: 'DISCOUNT',
    amount: 1000,
    created_at: '2026-06-10T10:00:00.000Z',
  },
  {
    correlation_id: 'corr-2',
    store_id: 'store-e2e',
    pos_id: 'pos-2',
    type: 'CANCEL',
    created_at: '2026-06-10T10:01:00.000Z',
  },
];

describe('US-05 — Decisión del supervisor', () => {
  beforeAll(async () => {
    await startServer(3001);
  });

  afterAll(async () => {
    await stopServer();
  });

  beforeEach(async () => {
    await resetMockServer();
    // Seed antes de launchApp para que el GET /pending devuelva las solicitudes
    await seedPendingRequests(SEED_TWO_REQUESTS);
    await device.launchApp({ newInstance: true });
  });

  it('tap card-corr-1 → detail-type-header visible en pantalla de detalle', async () => {
    await loginAsE2ESupervisor();

    await waitFor(element(by.id('list-spinner')))
      .not.toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    // FALLA EN FASE RED: 'card-corr-1' no existe (testID fijo 'authorization-card')
    await waitFor(element(by.id('card-corr-1')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('card-corr-1')).tap();

    // detail-type-header SÍ existe en AuthorizationDetailScreen.tsx (testID confirmado)
    await waitFor(element(by.id('detail-type-header')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);
  });

  it('autorizar solicitud corr-1 → spinner → desaparece → volver → card no visible', async () => {
    await loginAsE2ESupervisor();

    await waitFor(element(by.id('list-spinner')))
      .not.toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    // FALLA EN FASE RED: 'card-corr-1' con testID dinámico no existe aún
    await waitFor(element(by.id('card-corr-1')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('card-corr-1')).tap();

    await waitFor(element(by.id('detail-type-header')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    // FALLA EN FASE RED: 'authorize-button' no existe en AuthorizationDetailScreen.tsx
    // El Button Autorizar solo tiene accessibilityLabel, no testID
    await waitFor(element(by.id('authorize-button')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('authorize-button')).tap();

    // El spinner del botón debe aparecer mientras se procesa la decisión
    await waitFor(element(by.id('approve-button-spinner')))
      .toBeVisible()
      .withTimeout(TIMEOUT_SPINNER);

    // El spinner debe desaparecer cuando la decisión es enviada
    await waitFor(element(by.id('approve-button-spinner')))
      .not.toBeVisible()
      .withTimeout(TIMEOUT_SPINNER);

    // FALLA EN FASE RED: 'back-button' no existe en App.tsx/DetailView
    // El Pressable ← Volver no tiene testID
    await waitFor(element(by.id('back-button')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('back-button')).tap();

    // Volvimos a la lista — la card resuelta ya no debe ser visible
    await waitFor(element(by.id('app-safe-area')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    await detoxExpect(element(by.id('card-corr-1'))).not.toBeVisible();
  });

  it('rechazar solicitud corr-2 → spinner → desaparece → volver → card no visible', async () => {
    await loginAsE2ESupervisor();

    await waitFor(element(by.id('list-spinner')))
      .not.toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    // FALLA EN FASE RED: 'card-corr-2' no existe (testID dinámico no implementado)
    await waitFor(element(by.id('card-corr-2')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('card-corr-2')).tap();

    await waitFor(element(by.id('detail-type-header')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    // FALLA EN FASE RED: 'reject-button' no existe en AuthorizationDetailScreen.tsx
    await waitFor(element(by.id('reject-button')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('reject-button')).tap();

    // El Button Rechazar no tiene spinner dedicado (solo Autorizar lo tiene).
    // Esperamos que el botón se deshabilite durante el procesamiento.
    // Cuando la decisión termina, el back-button es la señal de que todo fue bien.

    // FALLA EN FASE RED: 'back-button' no existe en App.tsx
    await waitFor(element(by.id('back-button')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('back-button')).tap();

    await waitFor(element(by.id('app-safe-area')))
      .toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    await detoxExpect(element(by.id('card-corr-2'))).not.toBeVisible();
  });
});
