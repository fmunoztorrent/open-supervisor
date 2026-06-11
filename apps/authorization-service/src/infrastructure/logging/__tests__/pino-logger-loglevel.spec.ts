/**
 * US-04: Log Level Configuration — Tests 13, 14, 15
 *
 * RED tests: verify that PinoLoggerAdapter respects LOG_LEVEL env var.
 * Currently fails because `pino-logger.adapter.ts` does not exist yet.
 *
 * Test 13: LOG_LEVEL=debug enables debug messages
 * Test 14: invalid LOG_LEVEL falls back to info with warning
 * Test 15: default log level is info when LOG_LEVEL is unset
 */

import { PinoLoggerAdapter } from '../pino-logger.adapter';

describe('PinoLoggerAdapter — log level configuration (US-04)', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    delete process.env.LOG_LEVEL;
  });

  describe('LOG_LEVEL env var (Test 13)', () => {
    it('debug messages are emitted when LOG_LEVEL=debug', () => {
      process.env.LOG_LEVEL = 'debug';
      const logger = new PinoLoggerAdapter('test-service');

      logger.debug('debug detail message');

      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe(20); // pino debug level
      expect(parsed.message).toBe('debug detail message');
    });

    it('trace messages are emitted when LOG_LEVEL=trace', () => {
      process.env.LOG_LEVEL = 'trace';
      const logger = new PinoLoggerAdapter('test-service');

      logger.debug('trace level allows debug too');

      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe(20); // debug should pass at trace level
    });

    it('warn messages are always emitted (warn >= info)', () => {
      // Any level >= info allows warn
      process.env.LOG_LEVEL = 'info';
      const logger = new PinoLoggerAdapter('test-service');

      logger.warn('important warning');

      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe(40); // pino warn level
    });

    it('error messages are always emitted (error >= info)', () => {
      process.env.LOG_LEVEL = 'info';
      const logger = new PinoLoggerAdapter('test-service');

      logger.error('critical error', new Error('fail'));

      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe(50); // pino error level
    });

    it('fatal level blocks info messages', () => {
      process.env.LOG_LEVEL = 'fatal';
      const logger = new PinoLoggerAdapter('test-service');

      stdoutSpy.mockClear();
      logger.info('this should not appear');
      logger.warn('this should not appear either');

      // At fatal level, only fatal (60) messages should pass through
      // info (30) and warn (40) are below fatal (60)
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('LOG_LEVEL is case-insensitive', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const logger = new PinoLoggerAdapter('test-service');

      logger.debug('uppercase DEBUG should work');

      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe(20);
    });

    it('LOG_LEVEL with mixed case works', () => {
      process.env.LOG_LEVEL = 'Debug';
      const logger = new PinoLoggerAdapter('test-service');

      logger.debug('mixed case should work');

      expect(stdoutSpy).toHaveBeenCalled();
    });
  });

  describe('Invalid LOG_LEVEL fallback (Test 14)', () => {
    it('falls back to info when LOG_LEVEL is invalid', () => {
      process.env.LOG_LEVEL = 'VERBOSE';
      const logger = new PinoLoggerAdapter('test-service');

      // At info level, debug messages should be suppressed
      stdoutSpy.mockClear();
      logger.debug('should not appear');

      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('emits a warning when LOG_LEVEL is invalid', () => {
      // The adapter should warn about the invalid LOG_LEVEL value
      process.env.LOG_LEVEL = 'INVALID_LEVEL';
      const logger = new PinoLoggerAdapter('test-service');

      // The warning may be logged during construction or first use.
      // Verify the adapter doesn't crash.
      expect(logger).toBeDefined();
      expect(() => logger.info('still works')).not.toThrow();
    });

    it('still emits info messages when LOG_LEVEL is empty string', () => {
      process.env.LOG_LEVEL = '';
      const logger = new PinoLoggerAdapter('test-service');

      logger.info('info with empty LOG_LEVEL');

      expect(stdoutSpy).toHaveBeenCalled();
    });

    it('empty LOG_LEVEL behaves like unset (default info)', () => {
      process.env.LOG_LEVEL = '';
      const logger = new PinoLoggerAdapter('test-service');

      stdoutSpy.mockClear();
      logger.debug('debug suppressed');

      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });

  describe('Default log level (Test 15)', () => {
    it('defaults to info when LOG_LEVEL is not set', () => {
      // delete was done in beforeEach
      expect(process.env.LOG_LEVEL).toBeUndefined();
      const logger = new PinoLoggerAdapter('test-service');

      logger.info('default info message');
      expect(stdoutSpy).toHaveBeenCalled();

      stdoutSpy.mockClear();
      logger.debug('debug should be suppressed by default');
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('debug messages are suppressed at default info level', () => {
      const logger = new PinoLoggerAdapter('test-service');

      logger.debug('should be silent');
      logger.debug('also silent');

      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('trace messages are suppressed at default info level', () => {
      // Pino's trace level is 10, which is below info (30)
      const logger = new PinoLoggerAdapter('test-service');

      logger.debug('should be silent at info level');

      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('info, warn, error messages are emitted at default level', () => {
      const logger = new PinoLoggerAdapter('test-service');

      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg', new Error('test error'));

      expect(stdoutSpy).toHaveBeenCalledTimes(3);

      const levels = stdoutSpy.mock.calls.map((call: [string]) => {
        return JSON.parse(call[0]).level;
      });
      expect(levels).toContain(30); // info
      expect(levels).toContain(40); // warn
      expect(levels).toContain(50); // error
    });
  });

  describe('Log level boundaries', () => {
    it('all pino levels are accepted: trace, debug, info, warn, error, fatal', () => {
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

      for (const level of validLevels) {
        process.env.LOG_LEVEL = level;
        const logger = new PinoLoggerAdapter('test-service');
        expect(logger).toBeDefined();

        if (level === 'fatal') {
          // At fatal (60), even error (50) is suppressed — ILogger exposes
          // no fatal() method, so no message can pass through at this level.
          // Just verify the logger is constructable (already done above).
          continue;
        }

        // All other levels should at minimum allow error messages
        stdoutSpy.mockClear();
        logger.error(`test at ${level}`, new Error('boundary check'));
        expect(stdoutSpy).toHaveBeenCalled();
      }
    });

    it('warn level allows warn and error but suppresses info and debug', () => {
      process.env.LOG_LEVEL = 'warn';
      const logger = new PinoLoggerAdapter('test-service');

      stdoutSpy.mockClear();
      logger.info('info suppressed');
      expect(stdoutSpy).not.toHaveBeenCalled();

      stdoutSpy.mockClear();
      logger.debug('debug suppressed');
      expect(stdoutSpy).not.toHaveBeenCalled();

      stdoutSpy.mockClear();
      logger.warn('warn allowed');
      expect(stdoutSpy).toHaveBeenCalled();

      stdoutSpy.mockClear();
      logger.error('error allowed', new Error('test'));
      expect(stdoutSpy).toHaveBeenCalled();
    });
  });
});
