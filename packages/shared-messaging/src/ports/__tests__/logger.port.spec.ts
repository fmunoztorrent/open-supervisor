/**
 * US-01: Structured JSON Logging — Test 1
 *
 * RED test: verifies that the ILogger port exists with the correct interface.
 * Currently fails because `logger.port.ts` does not exist yet.
 *
 * Once the port is created, this test validates its contract:
 * - info(message, context?)
 * - warn(message, context?)
 * - error(message, error?, context?)
 * - debug(message, context?)
 * - setCorrelationId(correlationId)
 */

import { ILogger } from '../logger.port';

describe('ILogger port (US-01)', () => {
  it('ILogger module should be importable from shared-messaging', () => {
    // If the import above succeeds, the module exists.
    // We can't instantiate an interface, but we can use it as a type.
    const logger: ILogger | null = null;
    expect(logger).toBeNull();
  });

  describe('Interface contract', () => {
    it('ILogger declares info( message, context? ) method', () => {
      // Type-level check: if ILogger doesn't have info(), this won't compile.
      // We use a type assertion to verify the method exists at the type level.
      const impl: ILogger = {
        info: (message: string, context?: Record<string, unknown>) => {},
        warn: (message: string, context?: Record<string, unknown>) => {},
        error: (message: string, error?: Error, context?: Record<string, unknown>) => {},
        debug: (message: string, context?: Record<string, unknown>) => {},
        setCorrelationId: (correlationId: string) => {},
      };
      expect(impl).toBeDefined();
      expect(typeof impl.info).toBe('function');
      expect(typeof impl.warn).toBe('function');
      expect(typeof impl.error).toBe('function');
      expect(typeof impl.debug).toBe('function');
      expect(typeof impl.setCorrelationId).toBe('function');
    });

    it('ILogger declares warn( message, context? ) method', () => {
      const impl: ILogger = mockLogger();
      expect(typeof impl.warn).toBe('function');
    });

    it('ILogger declares error( message, error?, context? ) method', () => {
      const impl: ILogger = mockLogger();
      expect(typeof impl.error).toBe('function');
    });

    it('ILogger declares debug( message, context? ) method', () => {
      const impl: ILogger = mockLogger();
      expect(typeof impl.debug).toBe('function');
    });

    it('ILogger declares setCorrelationId( correlationId ) method', () => {
      const impl: ILogger = mockLogger();
      expect(typeof impl.setCorrelationId).toBe('function');
    });
  });
});

function mockLogger(): ILogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setCorrelationId: jest.fn(),
  };
}
