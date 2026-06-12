/**
 * US-02: Distributed Tracing — Test 6
 *
 * RED test: verifies that KafkaPublisherAdapter injects trace context headers
 * (traceparent) into published messages.
 *
 * The existing KafkaPublisherAdapter does NOT include headers in producer.send().
 * This test will FAIL because the current implementation omits trace headers.
 *
 * DIP-compliant: we mock kafkajs (the SDK), but validate the PORT's behavior
 * (IMessagePublisher) which should include trace context.
 */

import { ConfigService } from '@nestjs/config';
import { KafkaPublisherAdapter } from '../kafka-publisher.adapter';

// Mock kafkajs at module level to avoid real connections.
// Each makeAdapter() creates fresh mocks; mockProducerSend tracks
// the send() call so tests can assert trace headers.
jest.mock('kafkajs', () => {
  function createMockProducer(sendMock: jest.Mock) {
    return {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      send: sendMock,
    };
  }
  return {
    Kafka: jest.fn().mockImplementation(() => ({
      producer: jest.fn().mockImplementation(() => {
        // Use a module-scoped reference that gets updated per test
        return createMockProducer(currentSendMock);
      }),
    })),
  };
});

import { Kafka } from 'kafkajs';

const MockKafkaClass = Kafka as jest.Mock;
// currentSendMock is updated before each makeAdapter() call
let currentSendMock: jest.Mock;

function makeAdapter(): KafkaPublisherAdapter {
  currentSendMock = jest.fn().mockResolvedValue(undefined);
  MockKafkaClass.mockClear();

  const config = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'KAFKA_BROKERS') return 'localhost:9092';
      if (key === 'KAFKA_CLIENT_ID') return 'auth-service-test';
      return undefined;
    }),
  } as unknown as ConfigService;

  return new KafkaPublisherAdapter(config);
}

// Re-export for test assertions
function getMockProducerSend(): jest.Mock {
  return currentSendMock;
}

describe('KafkaPublisherAdapter — trace context (US-02 — Test 6)', () => {
  let adapter: KafkaPublisherAdapter;

  beforeEach(async () => {
    adapter = makeAdapter();
    await adapter.onModuleInit();
  });

  it('producer.send() includes headers in the message', async () => {
    const payload = {
      store_id: 'store-1',
      correlation_id: 'corr-123',
      type: 'DISCOUNT',
    };

    await adapter.publish('auth.response.store-1', payload);

    const sendMock = getMockProducerSend();
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0]).toHaveProperty('headers');
  });

  it('published message headers contain traceparent', async () => {
    const payload = { store_id: 'store-2', type: 'CANCEL' };

    await adapter.publish('auth.response.store-2', payload);

    const sendMock = getMockProducerSend();
    const call = sendMock.mock.calls[0][0];
    const headers = call.messages[0].headers;

    expect(headers).toBeDefined();
    const headerKeys = Object.keys(headers);
    expect(headerKeys).toContain('traceparent');
  });

  it('published message headers contain tracestate', async () => {
    const payload = { store_id: 'store-3', type: 'SUSPEND' };

    await adapter.publish('auth.response.store-3', payload);

    const sendMock = getMockProducerSend();
    const call = sendMock.mock.calls[0][0];
    const headers = call.messages[0].headers;

    expect(headers).toBeDefined();
    const headerKeys = Object.keys(headers);
    expect(headerKeys).toContain('tracestate');
  });

  it('traceparent follows W3C Trace Context format', async () => {
    const payload = { store_id: 'store-4' };

    await adapter.publish('auth.response.store-4', payload);

    const sendMock = getMockProducerSend();
    const call = sendMock.mock.calls[0][0];
    const traceparent = call.messages[0].headers?.traceparent;

    expect(traceparent).toBeDefined();
    // W3C traceparent format: version-traceId-spanId-flags
    // e.g., "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
    expect(typeof traceparent).toBe('string');
    expect(traceparent).toMatch(/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('message value is unchanged (trace metadata is in headers, not body)', async () => {
    const payload = {
      store_id: 'store-5',
      correlation_id: 'corr-abc',
      decision: 'APPROVED',
    };

    await adapter.publish('auth.response.store-5', payload);

    const sendMock = getMockProducerSend();
    const call = sendMock.mock.calls[0][0];
    const value = JSON.parse(call.messages[0].value as string);
    expect(value).toEqual(payload);
  });
});
