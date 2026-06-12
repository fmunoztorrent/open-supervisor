/**
 * US-01: Structured JSON Logging — Tests 2 & 3
 *
 * RED tests: PinoLoggerAdapter implements ILogger and emits valid JSON.
 * Currently fails because `pino-logger.adapter.ts` does not exist yet.
 *
 * Test 2: logs are valid JSON with required keys (level, message, timestamp, service)
 * Test 3: setCorrelationId() includes correlation_id in subsequent log entries
 */

import { PinoLoggerAdapter } from '../pino-logger.adapter';
import { ILogger } from '@open-supervisor/shared-messaging';

describe('PinoLoggerAdapter (US-01)', () => {
  let logger: PinoLoggerAdapter;

  beforeEach(() => {
    logger = new PinoLoggerAdapter('test-service');
  });

  describe('Contract — implements ILogger', () => {
    it('is an instance of ILogger', () => {
      expect(logger).toBeDefined();
      // PinoLoggerAdapter must satisfy the ILogger interface
      const asPort: ILogger = logger;
      expect(asPort).toBe(logger);
    });

    it('exposes info(), warn(), error(), debug() methods', () => {
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('exposes setCorrelationId() method', () => {
      expect(typeof logger.setCorrelationId).toBe('function');
    });
  });

  describe('JSON output — valid structure (Test 2)', () => {
    it('info() emits a valid JSON string with required keys', () => {
      // Capture stdout
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      logger.info('test message');

      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0] as string;
      expect(() => JSON.parse(output)).not.toThrow();

      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('level');
      expect(parsed).toHaveProperty('message');
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('service');
      expect(parsed.service).toBe('test-service');
      expect(parsed.message).toBe('test message');
      expect(parsed.level).toBe(30); // pino info level

      stdoutSpy.mockRestore();
    });

    it('warn() emits valid JSON with level 40', () => {
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      logger.warn('warning message');

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe(40); // pino warn level
      expect(parsed.message).toBe('warning message');

      stdoutSpy.mockRestore();
    });

    it('error() emits valid JSON with level 50 and error details', () => {
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const err = new Error('something broke');

      logger.error('error message', err);

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe(50); // pino error level
      expect(parsed.message).toBe('error message');
      // Pino serializes Error as err field
      expect(parsed).toHaveProperty('err');
      expect(parsed.err).toHaveProperty('message');
      expect(parsed.err.message).toBe('something broke');

      stdoutSpy.mockRestore();
    });

    it('debug() emits valid JSON with level 20', () => {
      // debug messages are suppressed at default info level (pino level 20 < 30).
      // Set LOG_LEVEL=debug so the debug() call produces output we can validate.
      process.env.LOG_LEVEL = 'debug';
      const debugLogger = new PinoLoggerAdapter('test-service');
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      debugLogger.debug('debug detail');

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe(20); // pino debug level

      stdoutSpy.mockRestore();
      delete process.env.LOG_LEVEL;
    });

    it('each log line is a single JSON object (newline-delimited JSON)', () => {
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      logger.info('first');
      logger.info('second');

      expect(stdoutSpy).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 2; i++) {
        const output = stdoutSpy.mock.calls[i][0] as string;
        expect(() => JSON.parse(output)).not.toThrow();
      }

      stdoutSpy.mockRestore();
    });
  });

  describe('correlation_id propagation (Test 3)', () => {
    it('setCorrelationId() causes subsequent logs to include correlation_id', () => {
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      logger.setCorrelationId('C-123');
      logger.info('request processed');

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('correlation_id');
      expect(parsed.correlation_id).toBe('C-123');

      stdoutSpy.mockRestore();
    });

    it('correlation_id persists across multiple log calls after setCorrelationId()', () => {
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      logger.setCorrelationId('C-456');
      logger.info('step 1');
      logger.warn('step 2');
      logger.error('step 3', new Error('fail'));

      expect(stdoutSpy).toHaveBeenCalledTimes(3);
      for (let i = 0; i < 3; i++) {
        const output = stdoutSpy.mock.calls[i][0] as string;
        const parsed = JSON.parse(output);
        expect(parsed.correlation_id).toBe('C-456');
      }

      stdoutSpy.mockRestore();
    });

    it('correlation_id is absent when setCorrelationId() has not been called', () => {
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      logger.info('startup message');

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).not.toHaveProperty('correlation_id');

      stdoutSpy.mockRestore();
    });

    it('context in info() merges with correlation_id', () => {
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      logger.setCorrelationId('C-789');
      logger.info('enriched', { store_id: 'store-1', pos_id: 'pos-5' });

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.correlation_id).toBe('C-789');
      expect(parsed.store_id).toBe('store-1');
      expect(parsed.pos_id).toBe('pos-5');

      stdoutSpy.mockRestore();
    });
  });

  describe('Service name in logs', () => {
    it('service field comes from constructor parameter', () => {
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      logger.info('hello');

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.service).toBe('test-service');

      stdoutSpy.mockRestore();
    });
  });
});
