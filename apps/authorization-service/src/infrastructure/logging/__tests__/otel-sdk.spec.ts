/**
 * US-02: Distributed Tracing — Test 5
 *
 * RED test: verifies that the OpenTelemetry SDK module exists and exports
 * an initialization function. Currently fails because `otel-sdk.ts` does
 * not exist yet.
 */

import { initOtel } from '../otel-sdk';

describe('OpenTelemetry SDK (US-02 — Test 5)', () => {
  it('otel-sdk module should be importable', () => {
    // The import above verifies the module exists.
    // If it doesn't, this test fails at module resolution time.
    expect(true).toBe(true);
  });

  it('exports an initOtel() function', () => {
    expect(typeof initOtel).toBe('function');
  });

  it('initOtel() accepts optional configuration', () => {
    // Should not throw when called without args
    expect(() => initOtel()).not.toThrow();
  });

  it('initOtel() can be called with custom config', () => {
    expect(() =>
      initOtel({
        serviceName: 'authorization-service',
        exporterEndpoint: 'http://localhost:4318/v1/traces',
      }),
    ).not.toThrow();
  });

  it('initOtel() returns a shutdown function', () => {
    const shutdown = initOtel();
    expect(typeof shutdown).toBe('function');
    // shutdown should be callable
    expect(() => shutdown()).not.toThrow();
  });
});
