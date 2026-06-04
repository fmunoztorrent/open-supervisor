/**
 * Tests para StreamService (BFF) — proxy SSE hacia sse-server.
 *
 * Cubre:
 * - (Bug 4) el BFF re-emite eventos `physical_presence_dispatch` además de
 *   `authorization_request`. Antes solo escuchaba un tipo y descartaba el otro.
 *
 * Mockeamos el módulo `eventsource` (que el StreamService carga con
 * `require()`) para inyectar un EventSource sintético.
 */

// ─── Mock del módulo `eventsource` ───────────────────────────────────────────

type SseHandler = (event: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Map<string, SseHandler[]> = new Map();
  closed = false;
  onerror: ((err: unknown) => void) | null = null;
  onopen: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: SseHandler): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(handler);
  }
  removeEventListener(type: string, handler: SseHandler): void {
    const arr = this.listeners.get(type);
    if (arr) {
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: string): void {
    for (const h of this.listeners.get(type) ?? []) h({ data });
  }
}

jest.mock('eventsource', () => MockEventSource, { virtual: false });

import { ConfigService } from '@nestjs/config';
import { StreamService } from './stream.service';

beforeEach(() => {
  MockEventSource.instances = [];
});

describe('StreamService (BFF)', () => {
  describe('Proxy SSE — tipos de eventos (Bug 4)', () => {
    it('re-emite authorization_request al cliente móvil', () => {
      const config = {
        get: jest.fn().mockReturnValue('http://localhost:3002'),
      } as unknown as ConfigService;
      const service = new StreamService(config);

      const received: Array<{ data: string; type?: string }> = [];
      const sub = service.getStoreStream('store-1').subscribe((evt) => received.push(evt));

      const source = MockEventSource.instances[0];
      expect(source).toBeDefined();
      source.emit('authorization_request', '{"correlation_id":"abc"}');

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('authorization_request');
      expect(received[0].data).toBe('{"correlation_id":"abc"}');
      sub.unsubscribe();
    });

    it('re-emite physical_presence_dispatch al cliente móvil (Bug 4)', () => {
      const config = {
        get: jest.fn().mockReturnValue('http://localhost:3002'),
      } as unknown as ConfigService;
      const service = new StreamService(config);

      const received: Array<{ data: string; type?: string }> = [];
      const sub = service.getStoreStream('store-1').subscribe((evt) => received.push(evt));

      const source = MockEventSource.instances[0];
      expect(source).toBeDefined();
      source.emit('physical_presence_dispatch', '{"product_id":"P-1"}');

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('physical_presence_dispatch');
      expect(received[0].data).toBe('{"product_id":"P-1"}');
      sub.unsubscribe();
    });

    it('mezcla ambos tipos en el mismo stream por tienda', () => {
      const config = {
        get: jest.fn().mockReturnValue('http://localhost:3002'),
      } as unknown as ConfigService;
      const service = new StreamService(config);

      const received: Array<{ data: string; type?: string }> = [];
      const sub = service.getStoreStream('store-1').subscribe((evt) => received.push(evt));

      const source = MockEventSource.instances[0];
      expect(source).toBeDefined();
      source.emit('authorization_request', '{"id":"r1"}');
      source.emit('physical_presence_dispatch', '{"id":"d1"}');
      source.emit('authorization_request', '{"id":"r2"}');

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
