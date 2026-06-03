import { INotificationSubscriber } from '@open-supervisor/shared-messaging';
import { SseService } from './sse.service';

// ─── helpers ──────────────────────────────────────────────────────────────────

type SubscribeHandler = (message: string) => void;

interface MockSubscriber {
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  // Simula la entrega de mensajes por canal para los tests
  deliverTo: (channel: string, message: string) => void;
}

function makeMockSubscriber(): MockSubscriber {
  const handlers = new Map<string, SubscribeHandler>();

  const subscribe = jest.fn().mockImplementation((channel: string, handler: SubscribeHandler) => {
    handlers.set(channel, handler);
    return Promise.resolve();
  });

  const unsubscribe = jest.fn().mockResolvedValue(undefined);

  const deliverTo = (channel: string, message: string) => {
    const handler = handlers.get(channel);
    if (handler) handler(message);
  };

  return { subscribe, unsubscribe, deliverTo };
}

// ─── mocks ───────────────────────────────────────────────────────────────────

let mockSubscriber: MockSubscriber;
let service: SseService;

beforeEach(() => {
  mockSubscriber = makeMockSubscriber();
  service = new SseService(mockSubscriber as unknown as INotificationSubscriber);
});

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('SseService', () => {
  describe('Suscripciones Redis — segundo canal dispatches', () => {
    it('suscribe store:{id}:dispatches además de store:{id}:requests al obtener el stream', async () => {
      await service.getStoreStream('42');

      const subscribedChannels = (mockSubscriber.subscribe as jest.Mock).mock.calls.map(
        (call: unknown[]) => call[0],
      );

      expect(subscribedChannels).toContain('store:42:requests');
      expect(subscribedChannels).toContain('store:42:dispatches');
    });
  });

  describe('Mapeo de eventos SSE por canal', () => {
    it('mensaje en store:{id}:dispatches genera MessageEvent con type "physical_presence_dispatch"', async () => {
      const observable = await service.getStoreStream('42');

      const receivedEvents: Array<{ data: string; type?: string }> = [];
      observable.subscribe((event) => receivedEvents.push(event));

      const dispatchPayload = JSON.stringify({
        store_id: 'store-42',
        pos_id: 'pos-01',
        correlation_id: 'corr-dispatch',
        product_id: 'prod-999',
        original_price: 1000,
        requested_price: 400,
      });

      mockSubscriber.deliverTo('store:42:dispatches', dispatchPayload);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('physical_presence_dispatch');
      expect(receivedEvents[0].data).toBe(dispatchPayload);
    });

    it('mensaje en store:{id}:requests sigue generando type "authorization_request" (no regresión)', async () => {
      const observable = await service.getStoreStream('42');

      const receivedEvents: Array<{ data: string; type?: string }> = [];
      observable.subscribe((event) => receivedEvents.push(event));

      const requestPayload = JSON.stringify({
        id: 'req-001',
        storeId: 'store-42',
        type: 'DISCOUNT',
      });

      mockSubscriber.deliverTo('store:42:requests', requestPayload);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('authorization_request');
      expect(receivedEvents[0].data).toBe(requestPayload);
    });

    it('evento de requests no llega al canal dispatches y viceversa', async () => {
      const observable = await service.getStoreStream('42');

      const receivedEvents: Array<{ data: string; type?: string }> = [];
      observable.subscribe((event) => receivedEvents.push(event));

      const requestPayload = JSON.stringify({ id: 'req-001', type: 'DISCOUNT' });
      const dispatchPayload = JSON.stringify({ correlation_id: 'corr-001' });

      mockSubscriber.deliverTo('store:42:requests', requestPayload);
      mockSubscriber.deliverTo('store:42:dispatches', dispatchPayload);

      expect(receivedEvents).toHaveLength(2);

      const types = receivedEvents.map((e) => e.type);
      expect(types).toContain('authorization_request');
      expect(types).toContain('physical_presence_dispatch');
    });
  });
});
