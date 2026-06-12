import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { Writable } from 'stream';
import pino from 'pino';
import { ILogger } from '@open-supervisor/shared-messaging';
import { trace } from '@opentelemetry/api';

type LogContext = { correlationId?: string };

const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

function resolveLogLevel(): string {
  const envLevel = process.env.LOG_LEVEL;
  if (!envLevel || envLevel.trim() === '') return 'info';
  const normalized = envLevel.toLowerCase().trim();
  if ((VALID_LOG_LEVELS as readonly string[]).includes(normalized)) return normalized;
  // Invalid level falls back to info
  return 'info';
}

@Injectable()
export class PinoLoggerAdapter implements ILogger {
  private readonly pino: pino.Logger;
  private readonly als = new AsyncLocalStorage<LogContext>();
  private readonly stream: Writable;

  constructor(private readonly serviceName: string) {
    // Use a writable stream that delegates to process.stdout.write
    // so tests can spy on process.stdout.write (pino v10 uses sonic-boom
    // internally which bypasses process.stdout.write otherwise).
    // The callback must be called synchronously for pino to work correctly.
    this.stream = new Writable({
      write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
        process.stdout.write(chunk);
        callback();
      },
    });

    this.pino = pino(
      {
        level: resolveLogLevel(),
        name: serviceName,
        messageKey: 'message',
        base: { service: serviceName },
        timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
        serializers: {
          err: pino.stdSerializers.err,
        },
      },
      this.stream,
    );
  }

  setCorrelationId(correlationId: string): void {
    const store = this.als.getStore();
    if (store) {
      store.correlationId = correlationId;
    } else {
      this.als.enterWith({ correlationId });
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.pino.info(this.enrichContext(context), message);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.pino.warn(this.enrichContext(context), message);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const enriched = this.enrichContext(context);
    if (error) {
      enriched.err = error;
    }
    this.pino.error(enriched, message);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.pino.debug(this.enrichContext(context), message);
  }

  private enrichContext(context?: Record<string, unknown>): Record<string, unknown> {
    const base: Record<string, unknown> = { ...context };

    // Add correlation_id from AsyncLocalStorage if present
    const store = this.als.getStore();
    if (store?.correlationId) {
      base.correlation_id = store.correlationId;
    }

    // Extract trace_id and span_id from active OTel span context
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      const spanContext = activeSpan.spanContext();
      base.trace_id = spanContext.traceId;
      base.span_id = spanContext.spanId;
    }

    return base;
  }
}
