import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Kafka, Producer } from 'kafkajs';
import { IMessagePublisher } from '@open-supervisor/shared-messaging';
import { trace, ROOT_CONTEXT } from '@opentelemetry/api';
// Import via sdk-node re-exports (transitive dep)
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
export class KafkaPublisherAdapter implements IMessagePublisher, OnModuleDestroy {
  private readonly logger = new Logger(KafkaPublisherAdapter.name);
  private producer: Producer;

  constructor(private readonly config: ConfigService) {
    const kafka = new Kafka({
      clientId: config.get<string>('KAFKA_CLIENT_ID', 'authorization-service'),
      brokers: config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(','),
    });
    this.producer = kafka.producer();
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async publish(topic: string, message: unknown): Promise<void> {
    try {
      // Build trace context headers: from active span or generate new
      const activeSpan = trace.getActiveSpan();
      let spanContext = activeSpan?.spanContext();
      if (!spanContext || !spanContext.traceId) {
        // No active span — generate new trace context
        const traceId = randomBytes(16).toString('hex');
        const spanId = randomBytes(8).toString('hex');
        spanContext = { traceId, spanId, traceFlags: 1 };
      }
      const ctx = trace.setSpanContext(ROOT_CONTEXT, spanContext);
      const carrier: Record<string, string> = {};
      w3cPropagator.inject(ctx, carrier, getTextMapSetter());

      const headers: Record<string, string> = {};
      if (carrier.traceparent) headers.traceparent = carrier.traceparent;
      if (carrier.tracestate) headers.tracestate = carrier.tracestate;
      // Ensure tracestate is always present for downstream consumers
      if (!headers.tracestate) {
        headers.tracestate = '';
      }

      await this.producer.send({
        topic,
        messages: [
          {
            value: JSON.stringify(message),
            headers,
          },
        ],
      });
      this.logger.debug(`Published to ${topic}`);
    } catch (error) {
      this.logger.error(
        `Failed to publish to Kafka topic ${topic}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new Error(
        `Kafka publish failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }
}
