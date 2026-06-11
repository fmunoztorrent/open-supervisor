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
    // Deshabilitar network idle sync para evitar que el SSE bloquee Detox
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxURLBlacklistRegex: '.*' },
    });
  });

  it('tap card-corr-1 → detail-type-header visible en pantalla de detalle', async () => {
    await loginAsE2ESupervisor();

    // Fabric: 'not.toBeVisible' falla en Spinner compuesto (Gluestack).
    // 'not.toExist' verifica que el nodo fue removido del árbol (Spinner condicional).
    await waitFor(element(by.id('list-spinner')))
      .not.toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    // Fabric: 'toBeVisible' falla en Pressable compuesto (Gluestack, RN New Architecture).
    // Usar 'toExist' que solo verifica presencia en el árbol de render.
    await waitFor(element(by.id('card-corr-1')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    // Fabric: tap() en Pressable puede fallar porque getGlobalVisibleRect retorna 0
    // para vistas compuestas. 'tap({ x, y })' con coordenadas explícitas evita
    // la dependencia del centering vía getGlobalVisibleRect.
    await element(by.id('card-corr-1')).tap({ x: 5, y: 5 });

    // detail-type-header SÍ existe en AuthorizationDetailScreen.tsx (testID confirmado)
    await waitFor(element(by.id('detail-type-header')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);
  });

  it('autorizar solicitud corr-1 → spinner → desaparece → card no visible en lista', async () => {
    await loginAsE2ESupervisor();

    await waitFor(element(by.id('list-spinner')))
      .not.toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    await waitFor(element(by.id('card-corr-1')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('card-corr-1')).tap({ x: 5, y: 5 });

    await waitFor(element(by.id('detail-type-header')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    await waitFor(element(by.id('authorize-button')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('authorize-button')).tap({ x: 5, y: 5 });

    // El spinner del botón debe aparecer mientras se procesa la decisión
    await waitFor(element(by.id('approve-button-spinner')))
      .toExist()
      .withTimeout(TIMEOUT_SPINNER);

    // El spinner debe desaparecer cuando la decisión es enviada
    // Cuando isLoading vuelve a false, onDecisionComplete se ejecuta
    // y navega automáticamente de vuelta a la lista (setCurrentView('list')).
    // El DetailView se desmonta, por lo que back-button ya no existe.
    await waitFor(element(by.id('approve-button-spinner')))
      .not.toExist()
      .withTimeout(TIMEOUT_SPINNER);

    // La app navega automáticamente a la lista vía onDecisionComplete.
    // Esperar que app-safe-area (pantalla de lista) esté visible.
    await waitFor(element(by.id('app-safe-area')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    // La card resuelta ya no debe estar en el árbol (refetch completado).
    // Usar waitFor con not.toExist porque la refetch es asíncrona y
    // puede tardar unos ms en actualizar el estado requests.
    await waitFor(element(by.id('card-corr-1')))
      .not.toExist()
      .withTimeout(TIMEOUT_NAVIGATION);
  });

  it('rechazar solicitud corr-2 → card no visible en lista', async () => {
    await loginAsE2ESupervisor();

    await waitFor(element(by.id('list-spinner')))
      .not.toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    await waitFor(element(by.id('card-corr-2')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('card-corr-2')).tap({ x: 5, y: 5 });

    await waitFor(element(by.id('detail-type-header')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    await waitFor(element(by.id('reject-button')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    await element(by.id('reject-button')).tap({ x: 5, y: 5 });

    // El Button Rechazar no tiene spinner dedicado (solo Autorizar lo tiene).
    // La decision se procesa, y onDecisionComplete navega automáticamente a la lista.
    // Esperar que app-safe-area indique que volvimos a la pantalla de lista.
    await waitFor(element(by.id('app-safe-area')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    // La card resuelta ya no debe estar en el árbol.
    await waitFor(element(by.id('card-corr-2')))
      .not.toExist()
      .withTimeout(TIMEOUT_NAVIGATION);
  });
});
