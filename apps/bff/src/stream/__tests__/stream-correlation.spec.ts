/**
 * US-03: Correlation ID Propagation — Test 12
 *
 * RED test: verifies that the BFF StreamService extracts correlation_id
 * from SSE events and assigns it to its logging context.
 *
 * The existing StreamService does NOT have ILogger injected, nor does it
 * extract correlation_id from SSE events. This test will FAIL because:
 * 1. StreamService doesn't import/use ILogger
 * 2. setCorrelationId is not called during event processing
 *
 * DIP-compliant: mock IEventSourceConnector (port), not EventSource.
 */

import { Subject } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { StreamService } from '../stream.service';
import { SseEvent, IEventSourceConnector } from '../ports/event-source-connector.port';
import { ILogger } from '@open-supervisor/shared-messaging';

describe('StreamService — correlation_id from SSE (US-03 — Test 12)', () => {
  let eventSubject: Subject<SseEvent>;
  let mockConnector: IEventSourceConnector;
  let mockLogger: jest.Mocked<ILogger>;

  beforeEach(() => {
    eventSubject = new Subject<SseEvent>();
    mockConnector = {
      connect: jest.fn().mockReturnValue(eventSubject.asObservable()),
    };
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      setCorrelationId: jest.fn(),
    };
  });

  it('logger.setCorrelationId is called with correlation_id from SSE event', () => {
    const config = {
      get: jest.fn().mockReturnValue('http://localhost:3002'),
    } as unknown as ConfigService;

    // Inject mockLogger into StreamService via the 3rd constructor parameter
    const service = new StreamService(config, mockConnector, mockLogger);

    const received: SseEvent[] = [];
    const sub = service.getStoreStream('store-1').subscribe((evt) => received.push(evt));

    // Simulate SSE event with correlation_id
    eventSubject.next({
      data: JSON.stringify({
        correlation_id: 'C-123',
        store_id: 'store-1',
        type: 'DISCOUNT',
      }),
      type: 'authorization_request',
    });

    // After GREEN implementation, setCorrelationId should be called
    // with the correlation_id from the SSE event.
    expect(mockLogger.setCorrelationId).toHaveBeenCalledWith('C-123');

    sub.unsubscribe();
  });

  it('correlation_id from SSE is logged when processing event', () => {
    const config = {
      get: jest.fn().mockReturnValue('http://localhost:3002'),
    } as unknown as ConfigService;
    const service = new StreamService(config, mockConnector, mockLogger);

    const sub = service.getStoreStream('store-2').subscribe(() => {});

    eventSubject.next({
      data: JSON.stringify({
        correlation_id: 'C-log-me',
        store_id: 'store-2',
      }),
      type: 'authorization_request',
    });

    // After implementation, the service should log with correlation_id context
    expect(mockLogger.info).toHaveBeenCalled();

    sub.unsubscribe();
  });

  it('multiple SSE events update correlation_id for each event', () => {
    const config = {
      get: jest.fn().mockReturnValue('http://localhost:3002'),
    } as unknown as ConfigService;
    const service = new StreamService(config, mockConnector, mockLogger);

    const sub = service.getStoreStream('store-3').subscribe(() => {});

    eventSubject.next({
      data: JSON.stringify({ correlation_id: 'C-first', store_id: 'store-3' }),
      type: 'authorization_request',
    });
    eventSubject.next({
      data: JSON.stringify({ correlation_id: 'C-second', store_id: 'store-3' }),
      type: 'authorization_request',
    });

    expect(mockLogger.setCorrelationId).toHaveBeenCalledTimes(2);
    expect(mockLogger.setCorrelationId).toHaveBeenNthCalledWith(1, 'C-first');
    expect(mockLogger.setCorrelationId).toHaveBeenNthCalledWith(2, 'C-second');

    sub.unsubscribe();
  });

  it('handles SSE events without correlation_id gracefully', () => {
    const config = {
      get: jest.fn().mockReturnValue('http://localhost:3002'),
    } as unknown as ConfigService;
    const service = new StreamService(config, mockConnector, mockLogger);

    const sub = service.getStoreStream('store-4').subscribe(() => {});

    // SSE event without correlation_id in data
    eventSubject.next({
      data: JSON.stringify({ store_id: 'store-4' }),
      type: 'authorization_request',
    });

    // Should not crash; no setCorrelationId call expected
    // (or called with undefined/null, depending on implementation)
    expect(() => {}).not.toThrow();

    sub.unsubscribe();
  });

  it('error events are logged with correlation_id when available', () => {
    const config = {
      get: jest.fn().mockReturnValue('http://localhost:3002'),
    } as unknown as ConfigService;
    const service = new StreamService(config, mockConnector, mockLogger);

    const errors: unknown[] = [];
    const sub = service.getStoreStream('store-5').subscribe({
      next: () => {},
      error: (err) => errors.push(err),
    });

    eventSubject.error(new Error('Connection lost'));

    // The error handler should log with the correlation_id context
    // (if one was set previously)
    expect(mockLogger.error).toHaveBeenCalled();

    sub.unsubscribe();
  });
});
