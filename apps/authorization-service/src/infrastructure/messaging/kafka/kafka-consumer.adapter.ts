import { Injectable, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer } from 'kafkajs';
import { IMessageConsumer, ILogger, LOGGER } from '@open-supervisor/shared-messaging';

@Injectable()
export class KafkaConsumerAdapter implements IMessageConsumer, OnModuleDestroy {
  private consumer: Consumer | null = null;
  private readonly kafka: Kafka;
  private readonly logger: ILogger;

  constructor(
    private readonly config: ConfigService,
    @Inject(LOGGER) logger?: ILogger,
  ) {
    this.kafka = new Kafka({
      clientId: config.get<string>('KAFKA_CLIENT_ID', 'authorization-service'),
      brokers: config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(','),
    });
    this.logger = logger ?? {
      info: () => {},
      warn: () => {},
      error: console.error,
      debug: () => {},
      setCorrelationId: () => {},
    } as ILogger;
  }

  async subscribe(
    topics: string[],
    groupId: string,
    handler: (topic: string, message: unknown) => Promise<void>,
  ): Promise<void> {
    this.consumer = this.kafka.consumer({ groupId });
    await this.consumer.connect();

    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }

    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;
        try {
          const payload = JSON.parse(message.value.toString()) as unknown;
          const payloadObj = payload as Record<string, unknown>;

          // Extract correlation_id from message payload and set on logger context
          if (payloadObj?.correlation_id && typeof payloadObj.correlation_id === 'string') {
            this.logger.setCorrelationId(payloadObj.correlation_id);
          }

          await handler(topic, payload);
        } catch (err) {
          this.logger.error(`Failed to process message from ${topic}`, err as Error);
        }
      },
    });

    this.logger.info(`Subscribed to topics: ${topics.join(', ')} (group: ${groupId})`);
  }

  async disconnect(): Promise<void> {
    await this.consumer?.disconnect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }
}
