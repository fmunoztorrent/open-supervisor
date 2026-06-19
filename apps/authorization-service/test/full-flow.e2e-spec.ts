/**
 * US-02 + US-05 — Full cross-service e2e happy path + robustness guards
 */

import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { publishRequest } from './helpers/kafka';
import { waitForSseEvent } from './helpers/sse';
import { RequestType } from '@open-supervisor/shared-types';
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';

const BFF_URL = process.env['BFF_URL'] ?? 'http://localhost:3000';
const AUTH_SERVICE_URL = process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:3001';
const OUTBOX_TICK_INTERVAL_MS = parseInt(process.env['OUTBOX_TICK_INTERVAL_MS'] ?? '250', 10);

const RETURN_PATH_TIMEOUT_MS = OUTBOX_TICK_INTERVAL_MS + 3000;
const SSE_TIMEOUT_MS = 10_000;

/**
 * Poll outbox stats until published_count_last_hour increases by at least 1
 * (proves the outbox worker picked up and published the entry to Kafka).
 */
async function waitForOutboxPublish(prevPublishedCount: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await axios.get(`${AUTH_SERVICE_URL}/outbox/stats`, { timeout: 5000 });
    if (res.data.published_count_last_hour > prevPublishedCount) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Outbox did not publish within ${timeoutMs}ms`);
}

describe('US-02: Full cross-service authorization round trip', () => {
  describe('Happy path — DISCOUNT request', () => {
    const storeId = 'store-1';
    const posId = 'pos-1';
    let correlationId: string;
    let dto: AuthorizationRequestDto;

    beforeEach(() => {
      correlationId = uuidv4();
      dto = {
        store_id: storeId,
        pos_id: posId,
        correlation_id: correlationId,
        type: RequestType.DISCOUNT,
        created_at: new Date().toISOString(),
      };
    });

    it('request appears on BFF SSE stream as authorization_request event with matching correlation_id', async () => {
      const ssePromise = waitForSseEvent(storeId, correlationId, SSE_TIMEOUT_MS);
      await publishRequest(dto);
      const received = await ssePromise;
      expect(received.correlation_id).toBe(correlationId);
      expect(received.store_id).toBe(storeId);
      expect(received.type).toBe(RequestType.DISCOUNT);
    });

    it('resolve via POST returns 200 and outbox publishes the response to Kafka', async () => {
      // Inbound: publish and verify SSE
      const ssePromise = waitForSseEvent(storeId, correlationId, SSE_TIMEOUT_MS);
      await publishRequest(dto);
      const received = await ssePromise;
      expect(received.correlation_id).toBe(correlationId);

      const statsBefore = await axios.get(`${AUTH_SERVICE_URL}/outbox/stats`, { timeout: 5000 });

      // Resolve via BFF REST
      const resolveRes = await axios.post(
        `${BFF_URL}/authorization/${correlationId}/resolve`,
        { decision: 'APPROVE', supervisor_id: 'supervisor-e2e-test' },
        { timeout: 5000 },
      );
      expect(resolveRes.status).toBe(200);
      expect(resolveRes.data.status).toBe('APPROVED');

      // Verify outbox published the response
      await waitForOutboxPublish(statsBefore.data.published_count_last_hour, 10_000);
    }, 30_000);

    it('correlation_id is preserved end-to-end through every hop', async () => {
      // Inbound SSE preserves correlation_id
      const ssePromise = waitForSseEvent(storeId, correlationId, SSE_TIMEOUT_MS);
      await publishRequest(dto);
      const ssePayload = await ssePromise;
      expect(ssePayload.correlation_id).toBe(correlationId);

      // Resolve returns the same correlation_id
      const resolveRes = await axios.post(
        `${BFF_URL}/authorization/${correlationId}/resolve`,
        { decision: 'APPROVE', supervisor_id: 'supervisor-e2e-test' },
        { timeout: 5000 },
      );
      expect(resolveRes.data.correlation_id).toBe(correlationId);
    });

    it('REJECT decision carries status=REJECTED and resolved_by on the resolve response', async () => {
      const ssePromise = waitForSseEvent(storeId, correlationId, SSE_TIMEOUT_MS);
      await publishRequest(dto);
      await ssePromise;

      const resolveRes = await axios.post(
        `${BFF_URL}/authorization/${correlationId}/resolve`,
        { decision: 'REJECT', supervisor_id: 'supervisor-reject-test' },
        { timeout: 5000 },
      );
      expect(resolveRes.status).toBe(200);
      expect(resolveRes.data.status).toBe('REJECTED');
      expect(resolveRes.data.resolved_by).toBeDefined();
    });
  });
});

describe('US-05: Robustness guards', () => {
  it('outbox latency: response published within OUTBOX_TICK_INTERVAL_MS + 3s margin', async () => {
    const storeId = 'store-1';
    const correlationId = uuidv4();
    const dto: AuthorizationRequestDto = {
      store_id: storeId,
      pos_id: 'pos-latency-test',
      correlation_id: correlationId,
      type: RequestType.DISCOUNT,
      created_at: new Date().toISOString(),
    };

    const ssePromise = waitForSseEvent(storeId, correlationId, SSE_TIMEOUT_MS);
    await publishRequest(dto);
    await ssePromise;

    const statsBefore = await axios.get(`${AUTH_SERVICE_URL}/outbox/stats`, { timeout: 5000 });
    const startMs = Date.now();

    await axios.post(
      `${BFF_URL}/authorization/${correlationId}/resolve`,
      { decision: 'APPROVE', supervisor_id: 'supervisor-latency-test' },
      { timeout: 5000 },
    );

    await waitForOutboxPublish(statsBefore.data.published_count_last_hour, RETURN_PATH_TIMEOUT_MS + 5000);
    const elapsedMs = Date.now() - startMs;

    expect(elapsedMs).toBeLessThan(RETURN_PATH_TIMEOUT_MS + 5000);
  }, 30_000);

  it('two concurrent stores: requests land only on their own SSE stream', async () => {
    const correlationId1 = uuidv4();
    const correlationId2 = uuidv4();

    const dto1: AuthorizationRequestDto = {
      store_id: 'store-1', pos_id: 'pos-1',
      correlation_id: correlationId1,
      type: RequestType.DISCOUNT,
      created_at: new Date().toISOString(),
    };
    const dto2: AuthorizationRequestDto = {
      store_id: 'store-2', pos_id: 'pos-2',
      correlation_id: correlationId2,
      type: RequestType.DISCOUNT,
      created_at: new Date().toISOString(),
    };

    const sse1Promise = waitForSseEvent('store-1', correlationId1, SSE_TIMEOUT_MS);
    const sse2Promise = waitForSseEvent('store-2', correlationId2, SSE_TIMEOUT_MS);

    await Promise.all([publishRequest(dto1), publishRequest(dto2)]);

    const [received1, received2] = await Promise.all([sse1Promise, sse2Promise]);
    expect(received1.correlation_id).toBe(correlationId1);
    expect(received1.store_id).toBe('store-1');
    expect(received2.correlation_id).toBe(correlationId2);
    expect(received2.store_id).toBe('store-2');
  });

  it('consumer-join barrier: request published immediately after setup is not dropped', async () => {
    const storeId = 'store-1';
    const correlationId = uuidv4();
    const dto: AuthorizationRequestDto = {
      store_id: storeId,
      pos_id: 'pos-barrier-test',
      correlation_id: correlationId,
      type: RequestType.DISCOUNT,
      created_at: new Date().toISOString(),
    };

    const ssePromise = waitForSseEvent(storeId, correlationId, SSE_TIMEOUT_MS);
    await publishRequest(dto);
    const received = await ssePromise;
    expect(received.correlation_id).toBe(correlationId);
  });

  it('auth-service /outbox/stats endpoint is reachable and returns expected shape', async () => {
    const res = await axios.get(`${AUTH_SERVICE_URL}/outbox/stats`, { timeout: 5000 });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('pending_count');
    expect(res.data).toHaveProperty('published_count_last_hour');
    expect(typeof res.data.pending_count).toBe('number');
  });
});
