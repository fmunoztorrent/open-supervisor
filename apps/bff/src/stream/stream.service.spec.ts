/**
 * Tests para StreamService (BFF) — proxy SSE hacia sse-server.
 *
 * Cubre:
 * - (Bug 4) el BFF re-emite eventos `physical_presence_dispatch` además de
 *   `authorization_request`. Antes solo escuchaba un tipo y descartaba el otro.
 *
 * Se usa un mock de IEventSourceConnector en lugar de mockear el módulo
 * `eventsource`.
 */

import { Subject } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { StreamService } from './stream.service';
import { SseEvent, IEventSourceConnector } from './ports/event-source-connector.port';

describe('StreamService (BFF)', () => {
  let eventSubject: Subject<SseEvent>;
  let mockConnector: IEventSourceConnector;

  beforeEach(() => {
    eventSubject = new Subject<SseEvent>();
    mockConnector = {
      connect: jest.fn().mockReturnValue(eventSubject.asObservable()),
    };
  });

  describe('Proxy SSE — tipos de eventos (Bug 4)', () => {
    it('re-emite authorization_request al cliente móvil', () => {
      const config = {
        get: jest.fn().mockReturnValue('http://localhost:3002'),
      } as unknown as ConfigService;
      const service = new StreamService(config, mockConnector);

      const received: SseEvent[] = [];
      const sub = service.getStoreStream('store-1').subscribe((evt) => received.push(evt));

      expect(mockConnector.connect).toHaveBeenCalledWith(
        'http://localhost:3002/events/store/store-1',
      );

      eventSubject.next({ data: '{"correlation_id":"abc"}', type: 'authorization_request' });

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('authorization_request');
      expect(received[0].data).toBe('{"correlation_id":"abc"}');
      sub.unsubscribe();
    });

    it('re-emite physical_presence_dispatch al cliente móvil (Bug 4)', () => {
      const config = {
        get: jest.fn().mockReturnValue('http://localhost:3002'),
      } as unknown as ConfigService;
      const service = new StreamService(config, mockConnector);

      const received: SseEvent[] = [];
      const sub = service.getStoreStream('store-1').subscribe((evt) => received.push(evt));

      eventSubject.next({ data: '{"product_id":"P-1"}', type: 'physical_presence_dispatch' });

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('physical_presence_dispatch');
      expect(received[0].data).toBe('{"product_id":"P-1"}');
      sub.unsubscribe();
    });

    it('mezcla ambos tipos en el mismo stream por tienda', () => {
      const config = {
        get: jest.fn().mockReturnValue('http://localhost:3002'),
      } as unknown as ConfigService;
      const service = new StreamService(config, mockConnector);

      const received: SseEvent[] = [];
      const sub = service.getStoreStream('store-1').subscribe((evt) => received.push(evt));

      eventSubject.next({ data: '{"id":"r1"}', type: 'authorization_request' });
      eventSubject.next({ data: '{"id":"d1"}', type: 'physical_presence_dispatch' });
      eventSubject.next({ data: '{"id":"r2"}', type: 'authorization_request' });

      expect(received).toHaveLength(3);
      const types = received.map((e) => e.type);
      expect(types).toEqual([
        'authorization_request',
        'physical_presence_dispatch',
        'authorization_request',
      ]);
      sub.unsubscribe();
    });
  });
});
