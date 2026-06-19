/**
 * US-04 — Negative-path e2e (no false green)
 *
 * Asserts that a request for store-1 does NOT surface on store-2's SSE stream.
 * Proves the suite can detect a broken / over-broad channel wiring.
 *
 * RED PHASE: This test WILL FAIL because the stub globalSetup does not boot
 * any services. The SSE connection is refused; assertNoSseEvent's error
 * handler swallows the connection error and the bounded wait expires normally,
 * so this test will actually PASS in RED if no services are running (the event
 * never arrives because nothing publishes). That is acceptable for the negative
 * path: the test is self-consistent; its real value is catching channel cross-
 * talk regressions once services are running (GREEN phase).
 *
 * NOTE: The companion positive assertion (store-1 event DID arrive on store-1's
 * stream) is covered in full-flow.e2e-spec.ts. The negative test here is purely
 * the isolation guard.
 */

import { v4 as uuidv4 } from 'uuid';
import { publishRequest } from './helpers/kafka';
import { assertNoSseEvent, waitForSseEvent } from './helpers/sse';
import { RequestType } from '@open-supervisor/shared-types';
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';

const SSE_TIMEOUT_MS = 10_000;
const NEGATIVE_WAIT_MS = 4_000;

describe('US-04: Negative path — channel isolation', () => {
  it('a store-1 request does NOT appear on the store-2 SSE stream within bounded wait', async () => {
    const correlationId = uuidv4();
    const dto: AuthorizationRequestDto = {
      store_id: 'store-1',
      pos_id: 'pos-isolation-test',
      correlation_id: correlationId,
      type: RequestType.DISCOUNT,
      created_at: new Date().toISOString(),
    };

    // Subscribe to store-2 BEFORE publishing to store-1
    // assertNoSseEvent will resolve if the event does NOT arrive within NEGATIVE_WAIT_MS
    const noEventPromise = assertNoSseEvent('store-2', correlationId, NEGATIVE_WAIT_MS);

    // Publish to store-1
    await publishRequest(dto);

    // This should resolve without error (event must NOT appear on store-2)
    await expect(noEventPromise).resolves.toBeUndefined();
  });

  it('a store-1 request DOES appear on store-1 SSE stream (positive control)', async () => {
    /**
     * Positive control: ensures the negative test above is not a trivially
     * passing vacuum (i.e. if the whole SSE system is dead, both tests pass).
     * When services are running (GREEN), this must arrive; in RED it times out.
     *
     * RED PHASE: Expected failure — timeout because services not running.
     */
    const correlationId = uuidv4();
    const dto: AuthorizationRequestDto = {
      store_id: 'store-1',
      pos_id: 'pos-positive-control',
      correlation_id: correlationId,
      type: RequestType.DISCOUNT,
      created_at: new Date().toISOString(),
    };

    const ssePromise = waitForSseEvent('store-1', correlationId, SSE_TIMEOUT_MS);
    await publishRequest(dto);
    const received = await ssePromise;
    expect(received.correlation_id).toBe(correlationId);
  });
});
