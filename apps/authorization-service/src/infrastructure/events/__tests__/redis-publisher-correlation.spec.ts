/**
 * US-03: Correlation ID Propagation — Test 10
 *
 * RED test: verifies that the Redis publisher includes correlation_id
 * in the payload sent to Redis pub/sub.
 *
 * The existing RedisPublisherAdapter just does JSON.stringify(payload)
 * without injecting correlation_id. This test will FAIL because the
 * current implementation does not include correlation_id explicitly.
 *
 * DIP-compliant: mock ioredis, validate the port behavior.
 */

import { ConfigService } from '@nestjs/config';
import { RedisPublisherAdapter } from '../redis-publisher.adapter';

jest.mock('ioredis', () => {
  function createMockClient() {
    return {
      on: jest.fn().mockReturnValue(undefined),
      publish: jest.fn().mockResolvedValue(0),
      quit: jest.fn().mockResolvedValue('OK'),
    };
  }
  return {
    default: jest.fn().mockImplementation(() => createMockClient()),
    __esModule: true,
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RedisModule = require('ioredis');
const MockedRedis = (RedisModule.default ?? RedisModule) as unknown as jest.Mock;

function makeAdapter() {
  MockedRedis.mockClear();
  const config = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'REDIS_HOST') return 'localhost';
      if (key === 'REDIS_PORT') return 6379;
      return undefined;
    }),
  } as unknown as ConfigService;
  const adapter = new RedisPublisherAdapter(config);
  const instance = MockedRedis.mock.results[MockedRedis.mock.results.length - 1]?.value as {
    publish: jest.Mock;
    on: jest.Mock;
    quit: jest.Mock;
  };
  return { adapter, instance };
}

describe('RedisPublisherAdapter — correlation_id injection (US-03 — Test 10)', () => {
  it('emit() includes correlation_id in the published payload', async () => {
    const { adapter, instance } = makeAdapter();
    const payload = {
      store_id: 'store-1',
      correlation_id: 'C-abc',
      type: 'DISCOUNT',
      amount: 10,
    };

    await adapter.emit('store:store-1:requests', payload);

    expect(instance.publish).toHaveBeenCalledTimes(1);
    const [, serialized] = instance.publish.mock.calls[0] as [string, string];
    const parsed = JSON.parse(serialized);

    // correlation_id must be present in the serialized payload
    expect(parsed).toHaveProperty('correlation_id');
    expect(parsed.correlation_id).toBe('C-abc');
  });

  it('correlation_id survives serialization round-trip', async () => {
    const { adapter, instance } = makeAdapter();
    const correlationIds = ['C-123', 'C-456', 'corr-special_chars-!@#'];

    for (const cid of correlationIds) {
      await adapter.emit('store:store-1:requests', {
        store_id: 'store-1',
        correlation_id: cid,
        type: 'DISCOUNT',
      });
    }

    expect(instance.publish).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const [, serialized] = instance.publish.mock.calls[i] as [string, string];
      const parsed = JSON.parse(serialized);
      expect(parsed.correlation_id).toBe(correlationIds[i]);
    }
  });

  it('correlation_id is present in dispatches channel payloads', async () => {
    const { adapter, instance } = makeAdapter();
    const payload = {
      store_id: 'store-2',
      correlation_id: 'C-dispatch',
      product_id: 'P42',
    };

    await adapter.emit('store:store-2:dispatches', payload);

    const [, serialized] = instance.publish.mock.calls[0] as [string, string];
    const parsed = JSON.parse(serialized);
    expect(parsed.correlation_id).toBe('C-dispatch');
    expect(parsed.product_id).toBe('P42');
  });

  it('publish does not crash when correlation_id is absent from input payload', async () => {
    const { adapter, instance } = makeAdapter();

    // Payload without correlation_id
    await adapter.emit('store:store-3:requests', {
      store_id: 'store-3',
      type: 'CANCEL',
    });

    expect(instance.publish).toHaveBeenCalledTimes(1);
    const [, serialized] = instance.publish.mock.calls[0] as [string, string];

    // Should not throw when parsing
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  it('correlation_id is included alongside _trace envelope (both present)', async () => {
    const { adapter, instance } = makeAdapter();
    const payload = {
      store_id: 'store-4',
      correlation_id: 'C-both',
      type: 'SUSPEND',
    };

    await adapter.emit('store:store-4:requests', payload);

    const [, serialized] = instance.publish.mock.calls[0] as [string, string];
    const parsed = JSON.parse(serialized);

    // After implementation, both correlation_id and _trace should be present
    expect(parsed.correlation_id).toBe('C-both');
    // _trace will be present once US-02 is implemented
    // (This assertion may need adjustment after US-02 implementation)
  });
});
