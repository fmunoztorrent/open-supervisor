/**
 * Tests para RedisNotificationSubscriberAdapter.
 *
 * Estrategia: mockeamos el módulo `ioredis` a nivel Jest para evitar
 * abrir una conexión real en cada test. Verificamos que el adapter
 * mantiene UN solo listener `message` (no acumula por cada subscribe)
 * y que el handler correcto se invoca por canal.
 *
 * Ver bugfix `e2e-outbox-fixes` (2026-06-04) — Bug 3.
 */

// Mock ioredis — solo necesitamos un EventEmitter mínimo con la API
// que usa el adapter: subscribe, unsubscribe, on, quit.
// Se exporta como `default` para que `import Redis from 'ioredis'` lo tome.
jest.mock('ioredis', () => {
  const factory = jest.fn().mockImplementation(() => {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    return {
      status: 'ready',
      subscribe: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
        return undefined;
      }),
      quit: jest.fn().mockResolvedValue('OK'),
      /** Helper para los tests: simula un mensaje entrante */
      __emitMessage: (channel: string, message: string) => {
        for (const cb of listeners['message'] ?? []) cb(channel, message);
      },
      __listenerCount: () => (listeners['message'] ?? []).length,
    };
  });
  return { default: factory, __esModule: true };
});

import { ConfigService } from '@nestjs/config';
import { RedisNotificationSubscriberAdapter } from './redis-notification-subscriber.adapter';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RedisModule = require('ioredis');
const MockedRedis = (RedisModule.default ?? RedisModule) as unknown as jest.Mock;

interface MockInstance {
  status: string;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  on: jest.Mock;
  quit: jest.Mock;
  __emitMessage: (channel: string, message: string) => void;
  __listenerCount: () => number;
}

function makeAdapter(): { adapter: RedisNotificationSubscriberAdapter; instance: MockInstance } {
  MockedRedis.mockClear();
  const config = {
    get: jest.fn().mockImplementation((k: string) => {
      if (k === 'REDIS_HOST') return 'localhost';
      if (k === 'REDIS_PORT') return 6379;
      return undefined;
    }),
  } as unknown as ConfigService;
  const adapter = new RedisNotificationSubscriberAdapter(config);
  const instance = MockedRedis.mock.results[MockedRedis.mock.results.length - 1].value as MockInstance;
  return { adapter, instance };
}

beforeEach(() => {
  MockedRedis.mockClear();
});

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('RedisNotificationSubscriberAdapter', () => {
  describe('Listeners — bug 3 (no acumular listeners)', () => {
    it('registra exactamente UN listener `message` en el cliente, sin importar cuántas veces se llame subscribe()', async () => {
      const { adapter, instance } = makeAdapter();
      // El constructor ya agrega 1 listener message (más los de connect/error)
      const initialCount = instance.__listenerCount();
      expect(initialCount).toBe(1);

      await adapter.subscribe('store:1:requests', jest.fn());
      await adapter.subscribe('store:1:dispatches', jest.fn());
      await adapter.subscribe('store:2:requests', jest.fn());
      await adapter.subscribe('store:2:dispatches', jest.fn());

      // No debe haber crecido — sigue habiendo UN solo listener
      expect(instance.__listenerCount()).toBe(1);
    });

    it('cada canal invoca SOLO a su handler cuando llega un mensaje', async () => {
      const { adapter, instance } = makeAdapter();
      const reqHandler = jest.fn();
      const dispHandler = jest.fn();

      await adapter.subscribe('store:1:requests', reqHandler);
      await adapter.subscribe('store:1:dispatches', dispHandler);

      reqHandler.mockClear();
      dispHandler.mockClear();

      instance.__emitMessage('store:1:requests', 'req-msg');
      instance.__emitMessage('store:1:dispatches', 'disp-msg');

      expect(reqHandler).toHaveBeenCalledTimes(1);
      expect(reqHandler).toHaveBeenCalledWith('req-msg');
      expect(dispHandler).toHaveBeenCalledTimes(1);
      expect(dispHandler).toHaveBeenCalledWith('disp-msg');
    });

    it('N llamadas a subscribe() no invocan el handler previo N veces por mensaje (no leak)', async () => {
      const { adapter, instance } = makeAdapter();
      const handler = jest.fn();

      // Suscribe el mismo canal 5 veces — la última gana
      await adapter.subscribe('store:1:requests', jest.fn());
      await adapter.subscribe('store:1:requests', jest.fn());
      await adapter.subscribe('store:1:requests', jest.fn());
      await adapter.subscribe('store:1:requests', jest.fn());
      await adapter.subscribe('store:1:requests', handler);

      instance.__emitMessage('store:1:requests', 'msg');

      // Si hubiera leak, el handler sería invocado múltiples veces
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Unsubscribe', () => {
    it('remueve el handler al hacer unsubscribe, mensajes tardíos no se entregan', async () => {
      const { adapter, instance } = makeAdapter();
      const handler = jest.fn();

      await adapter.subscribe('store:1:requests', handler);
      await adapter.unsubscribe('store:1:requests');
      handler.mockClear();

      instance.__emitMessage('store:1:requests', 'late-msg');

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
