/**
 * 02-list.test.ts — Suite E2E: Lista de solicitudes + SSE en tiempo real (US-04)
 *
 * Cubre:
 *   1. Login con seed de 2 solicitudes → card-corr-1 y card-corr-2 visibles
 *   2. Login con lista vacía → emitir SSE (corr-sse-1) → card aparece en ≤8s
 *
 * FASE RED — Razones por las que estos tests DEBEN fallar:
 *   1. `import ... from 'detox'` → MODULE_NOT_FOUND (Detox no instalado).
 *   2. El testID 'card-corr-1' no existe: AuthorizationCard.tsx usa
 *      testID fijo 'authorization-card' para solicitudes normales (no presencia física).
 *      El implementador debe cambiar a `card-${request.correlation_id}`.
 *   3. 'empty-list-text' tampoco tiene testID en AuthorizationList.tsx.
 */

import { device, element, by, waitFor } from 'detox';
import { startServer, stopServer } from './mock-server/index';
import {
  loginAsE2ESupervisor,
  seedPendingRequests,
  emitSSERequest,
  resetMockServer,
} from './setup/testHelpers';

const TIMEOUT_LOGIN = 15000;
const TIMEOUT_SSE = 8000;
const TIMEOUT_NAVIGATION = 5000;

describe('US-04 — Lista de solicitudes y SSE', () => {
  beforeAll(async () => {
    await startServer(3001);
  });

  afterAll(async () => {
    await stopServer();
  });

  beforeEach(async () => {
    await resetMockServer();
    // Deshabilitar network idle sync para evitar que el SSE bloquee Detox
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxURLBlacklistRegex: '.*' },
    });
  });

  it('lista con 2 solicitudes pre-existentes — ambas cards visibles', async () => {
    // Seed ANTES de lanzar la app para que el GET /pending las devuelva
    await seedPendingRequests([
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
    ]);

    await loginAsE2ESupervisor();

    // Esperar que el spinner de carga desaparezca
    await waitFor(element(by.id('list-spinner')))
      .not.toBeVisible()
      .withTimeout(TIMEOUT_NAVIGATION);

    await waitFor(element(by.id('card-corr-1')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    await waitFor(element(by.id('card-corr-2')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);
  });

  it('lista vacía → SSE emite corr-sse-1 → card aparece en ≤8s', async () => {
    // Lista vacía garantizada por resetMockServer en beforeEach
    await loginAsE2ESupervisor();

    // Esperar spinner de carga inicial
    // Fabric: el Spinner condicional de Gluestack se remueve del árbol cuando
    // isLoading=false. 'not.toExist' es más fiable que 'not.toBeVisible'.
    await waitFor(element(by.id('list-spinner')))
      .not.toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    await waitFor(element(by.id('empty-list-text')))
      .toExist()
      .withTimeout(TIMEOUT_NAVIGATION);

    // Emitir la solicitud vía SSE desde el mock server
    await emitSSERequest({
      correlation_id: 'corr-sse-1',
      store_id: 'store-e2e',
      pos_id: 'pos-3',
      type: 'DISCOUNT',
      amount: 500,
      created_at: new Date().toISOString(),
    });

    // La card debe aparecer en ≤8s gracias al listener SSE del hook useSSERequests.
    // El hook escucha exactamente el evento 'authorization_request'.
    // FALLA EN FASE RED: 'card-corr-sse-1' no existe (mismo problema de testID dinámico).
    await waitFor(element(by.id('card-corr-sse-1')))
      .toExist()
      .withTimeout(TIMEOUT_SSE);
  });
});
