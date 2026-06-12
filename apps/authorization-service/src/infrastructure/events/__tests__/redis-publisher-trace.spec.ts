/**
 * US-02: Distributed Tracing — Test 7
 *
 * RED test: verifies that RedisPublisherAdapter injects a `_trace` envelope
 * containing traceparent into Redis pub/sub payloads.
 *
 * The existing RedisPublisherAdapter does NOT inject _trace.
 * This test will FAIL because the current implementation omits trace context.
 *
 * DIP-compliant: we mock ioredis (the SDK), but validate the PORT's behavior
 * (IEventEmitter) which should include trace context in the payload.
 */

import { ConfigService } from '@nestjs/config';
import { RedisPublisherAdapter } from '../redis-publisher.adapter';

// Mock ioredis — intercept publish() to inspect payload.
// Each makeAdapter() creates a fresh mockClient so tests are isolated.
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
  // Get the mock client instance created by the constructor
  const instance = MockedRedis.mock.results[MockedRedis.mock.results.length - 1]?.value as {
    publish: jest.Mock;
    on: jest.Mock;
    quit: jest.Mock;
  };
  return { adapter, instance };
}

describe('RedisPublisherAdapter — trace context (US-02 — Test 7)', () => {
  it('emit() injects _trace object into the published payload', async () => {
    const { adapter, instance } = makeAdapter();
    const payload = {
      store_id: 'store-1',
      type: 'DISCOUNT',
      amount: 15,
    };

    await adapter.emit('store:store-1:requests', payload);

    expect(instance.publish).toHaveBeenCalledTimes(1);
    const [, serialized] = instance.publish.mock.calls[0] as [string, string];
    const parsed = JSON.parse(serialized);

    expect(parsed).toHaveProperty('_trace');
    expect(typeof parsed._trace).toBe('object');
    expect(parsed._trace).not.toBeNull();
  });

  it('_trace object contains traceparent', async () => {
    const { adapter, instance } = makeAdapter();

    await adapter.emit('store:store-1:requests', { store_id: 'store-2' });

    const [, serialized] = instance.publish.mock.calls[0] as [string, string];
    const parsed = JSON.parse(serialized);

    expect(parsed._trace).toHaveProperty('traceparent');
    expect(typeof parsed._trace.traceparent).toBe('string');
  });

  it('traceparent in _trace follows W3C Trace Context format', async () => {
    const { adapter, instance } = makeAdapter();

    await adapter.emit('store:store-1:dispatches', { store_id: 'store-3', product_id: 'P42' });

    const [, serialized] = instance.publish.mock.calls[0] as [string, string];
    const parsed = JSON.parse(serialized);
    const { traceparent } = parsed._trace;

    expect(traceparent).toMatch(/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('original payload fields are preserved alongside _trace', async () => {
    const { adapter, instance } = makeAdapter();
    const original = {
      store_id: 'store-4',
      correlation_id: 'corr-def',
      type: 'EMPLOYEE_BENEFIT',
      employee_id: '12345678-9',
    };

    await adapter.emit('store:store-4:requests', original);

    const [, serialized] = instance.publish.mock.calls[0] as [string, string];
    const parsed = JSON.parse(serialized);

    expect(parsed.store_id).toBe('store-4');
    expect(parsed.correlation_id).toBe('corr-def');
    expect(parsed.type).toBe('EMPLOYEE_BENEFIT');
    expect(parsed.employee_id).toBe('12345678-9');
    expect(parsed._trace).toBeDefined();
  });

  it('_trace is always present even for empty payloads', async () => {
    const { adapter, instance } = makeAdapter();

    await adapter.emit('store:store-5:requests', {});

    const [, serialized] = instance.publish.mock.calls[0] as [string, string];
    const parsed = JSON.parse(serialized);
    expect(parsed).toHaveProperty('_trace');
    expect(parsed._trace).toHaveProperty('traceparent');
  });
});
