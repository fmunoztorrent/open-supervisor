import { Injectable, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import { ILogger, LOGGER } from '@open-supervisor/shared-messaging';
import { IEventEmitter } from '../../domain/ports/event-emitter.port';
import { trace, ROOT_CONTEXT } from '@opentelemetry/api';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { W3CTraceContextPropagator } = require('@opentelemetry/core');

const w3cPropagator = new W3CTraceContextPropagator();

function getTextMapSetter(): { set(carrier: Record<string, string>, key: string, value: string): void } {
  return {
    set(carrier: Record<string, string>, key: string, value: string): void {
      carrier[key] = value;
    },
  };
}

@Injectable()
export class RedisPublisherAdapter implements IEventEmitter, OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger: ILogger;

  constructor(
    private readonly config: ConfigService,
    @Inject(LOGGER) logger?: ILogger,
  ) {
    this.client = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    });
    this.logger = logger ?? {
      info: () => {},
      warn: () => {},
      error: console.error,
      debug: () => {},
      setCorrelationId: () => {},
    } as ILogger;

    this.client.on('connect', () => this.logger.info('Redis publisher connected'));
    this.client.on('error', (err) => this.logger.error('Redis publisher error', err));
  }

  async emit(channel: string, payload: unknown): Promise<void> {
    // Build _trace envelope from active OTel span context, or generate new
    const activeSpan = trace.getActiveSpan();
    let spanContext = activeSpan?.spanContext();
    if (!spanContext || !spanContext.traceId) {
      const traceId = randomBytes(16).toString('hex');
      const spanId = randomBytes(8).toString('hex');
      spanContext = { traceId, spanId, traceFlags: 1 };
    }
    const ctx = trace.setSpanContext(ROOT_CONTEXT, spanContext);
    const carrier: Record<string, string> = {};
    w3cPropagator.inject(ctx, carrier, getTextMapSetter());

    const traceEnvelope: Record<string, string> = {};
    if (carrier.traceparent) traceEnvelope.traceparent = carrier.traceparent;
    if (carrier.tracestate) traceEnvelope.tracestate = carrier.tracestate;

    // Merge payload with _trace envelope
    const enriched = {
      ...(payload as Record<string, unknown>),
      _trace: traceEnvelope,
    };

    await this.client.publish(channel, JSON.stringify(enriched));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
