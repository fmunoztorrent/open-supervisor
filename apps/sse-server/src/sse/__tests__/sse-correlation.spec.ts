/**
 * US-03: Correlation ID Propagation — Test 11
 *
 * RED test: verifies that the SSE service includes correlation_id
 * in the event data sent to SSE clients.
 *
 * The existing SseService passes the raw Redis message string through
 * without extracting or enriching with correlation_id. This test will
 * FAIL because the current implementation does not inject correlation_id
 * into the SSE event data.
 *
 * DIP-compliant: mock INotificationSubscriber (port), not ioredis.
 */

import { Subject } from 'rxjs';
import { SseService, SseEvent } from '../sse.service';
import { INotificationSubscriber } from '@open-supervisor/shared-messaging';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

describe('SseService — correlation_id in SSE events (US-03 — Test 11)', () => {
  let mockSubscriber: jest.Mocked<INotificationSubscriber>;
  let sseService: SseService;

  // Store handlers for each channel to simulate Redis messages
  const channelHandlers = new Map<string, (message: string) => void>();

  beforeEach(() => {
    channelHandlers.clear();
    mockSubscriber = {
      subscribe: jest.fn().mockImplementation(
        async (channel: string, handler: (message: string) => void) => {
          channelHandlers.set(channel, handler);
        },
      ),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
    };
    sseService = new SseService(mockSubscriber);
  });

  it('SSE event data includes correlation_id from Redis message', async () => {
    const streamPromise = firstValueFrom(
      (await sseService.getStoreStream('store-1')).pipe(take(1)),
    );

    // Simulate Redis message arriving with correlation_id
    const redisPayload = JSON.stringify({
      correlation_id: 'C-abc',
      store_id: 'store-1',
      type: 'DISCOUNT',
      amount: 15,
    });

    const requestsHandler = channelHandlers.get('store:store-1:requests');
    expect(requestsHandler).toBeDefined();
    requestsHandler!(redisPayload);

    const event: SseEvent = await streamPromise;

    // The event data should contain the correlation_id
    const eventData = JSON.parse(event.data);
    expect(eventData).toHaveProperty('correlation_id');
    expect(eventData.correlation_id).toBe('C-abc');
  });

  it('SSE event type is authorization_request when correlation_id is present', async () => {
    const streamPromise = firstValueFrom(
      (await sseService.getStoreStream('store-2')).pipe(take(1)),
    );

    const requestsHandler = channelHandlers.get('store:store-2:requests');
    requestsHandler!(
      JSON.stringify({
        correlation_id: 'C-def',
        store_id: 'store-2',
        type: 'EMPLOYEE_BENEFIT',
      }),
    );

    const event: SseEvent = await streamPromise;
    expect(event.type).toBe('authorization_request');

    const eventData = JSON.parse(event.data);
    expect(eventData.correlation_id).toBe('C-def');
  });

  it('SSE event for dispatches also includes correlation_id', async () => {
    const streamPromise = firstValueFrom(
      (await sseService.getStoreStream('store-3')).pipe(take(1)),
    );

    const dispatchesHandler = channelHandlers.get('store:store-3:dispatches');
    expect(dispatchesHandler).toBeDefined();
    dispatchesHandler!(
      JSON.stringify({
        correlation_id: 'C-disp',
        store_id: 'store-3',
        product_id: 'P99',
      }),
    );

    const event: SseEvent = await streamPromise;
    expect(event.type).toBe('physical_presence_dispatch');

    const eventData = JSON.parse(event.data);
    expect(eventData.correlation_id).toBe('C-disp');
  });

  it('SSE event works when correlation_id is absent from Redis message', async () => {
    const streamPromise = firstValueFrom(
      (await sseService.getStoreStream('store-4')).pipe(take(1)),
    );

    const requestsHandler = channelHandlers.get('store:store-4:requests');
    requestsHandler!(
      JSON.stringify({
        store_id: 'store-4',
        type: 'CANCEL',
        // No correlation_id
      }),
    );

    const event: SseEvent = await streamPromise;
    expect(event.type).toBe('authorization_request');
    expect(event.data).toBeDefined();

    // Should not crash; event should still be emitted
    expect(() => JSON.parse(event.data)).not.toThrow();
  });

  it('correlation_id is preserved in event data after serialization', async () => {
    const streamPromise = firstValueFrom(
      (await sseService.getStoreStream('store-5')).pipe(take(1)),
    );

    const correlationId = 'C-special-!@#-123';
    const requestsHandler = channelHandlers.get('store:store-5:requests');
    requestsHandler!(
      JSON.stringify({
        correlation_id: correlationId,
        store_id: 'store-5',
        type: 'SUSPEND',
      }),
    );

    const event: SseEvent = await streamPromise;
    const eventData = JSON.parse(event.data);
    expect(eventData.correlation_id).toBe(correlationId);
  });
});
